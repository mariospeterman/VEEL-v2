import { decryptSecret, parseAes256GcmKey, type EncryptedSecret } from "@veel/config";
import postgres from "postgres";
import webPush from "web-push";

export type NotificationDeliveryOutcome =
  | {
      state: "delivered";
    }
  | {
      state: "failed";
      failureCode: string;
      retryAt: Date;
    }
  | {
      state: "revoked";
      failureCode: string;
    };

export interface DueNotificationDelivery {
  attemptId: string;
  leaseToken: string;
  attemptCount: number;
  notificationId: string;
  deviceId: string;
  userId: string;
  provider: "web_push";
  title: string;
  body: string | null;
  actionUrl: string | null;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface NotificationDeliveryRepository {
  enqueueDueDeliveries(input: { now: Date; limit: number }): Promise<number>;
  leaseDueDeliveries(input: {
    now: Date;
    limit: number;
    leaseDurationMs: number;
    maxAttempts: number;
  }): Promise<DueNotificationDelivery[]>;
  recordDeliveryOutcome(input: {
    attemptId: string;
    deviceId: string;
    leaseToken: string;
    maxAttempts: number;
    outcome: NotificationDeliveryOutcome;
  }): Promise<void>;
  close?(): Promise<void>;
}

export interface NotificationDeliveryProvider {
  deliver(input: DueNotificationDelivery): Promise<NotificationDeliveryOutcome>;
}

export interface WebPushNotificationDeliveryProviderOptions {
  vapidSubject: string;
  vapidPublicKey: string;
  vapidPrivateKey: string;
  ttlSeconds?: number | undefined;
  timeoutMs?: number | undefined;
}

export interface ProcessNotificationDeliveriesResult {
  enqueued: number;
  leased: number;
  delivered: number;
  failed: number;
  revoked: number;
}

export async function processNotificationDeliveries(input: {
  repository: NotificationDeliveryRepository;
  provider: NotificationDeliveryProvider;
  now?: Date;
  limit?: number;
  leaseDurationMs?: number;
  maxAttempts?: number;
}): Promise<ProcessNotificationDeliveriesResult> {
  const now = input.now ?? new Date();
  const limit = input.limit ?? 50;
  const leaseDurationMs = input.leaseDurationMs ?? 5 * 60 * 1000;
  const maxAttempts = input.maxAttempts ?? 8;
  const enqueued = await input.repository.enqueueDueDeliveries({ now, limit });
  const deliveries = await input.repository.leaseDueDeliveries({
    now,
    limit,
    leaseDurationMs,
    maxAttempts
  });
  const result: ProcessNotificationDeliveriesResult = {
    enqueued,
    leased: deliveries.length,
    delivered: 0,
    failed: 0,
    revoked: 0
  };

  for (const delivery of deliveries) {
    const outcome = await input.provider.deliver(delivery);
    await input.repository.recordDeliveryOutcome({
      attemptId: delivery.attemptId,
      deviceId: delivery.deviceId,
      leaseToken: delivery.leaseToken,
      maxAttempts,
      outcome
    });

    if (outcome.state === "delivered") result.delivered += 1;
    else if (outcome.state === "revoked") result.revoked += 1;
    else result.failed += 1;
  }

  return result;
}

export function createUnconfiguredNotificationDeliveryProvider(): NotificationDeliveryProvider {
  return {
    async deliver() {
      return {
        state: "failed",
        failureCode: "notification_delivery_provider_not_configured",
        retryAt: new Date(Date.now() + 5 * 60 * 1000)
      };
    }
  };
}

export function createWebPushNotificationDeliveryProvider(
  options: WebPushNotificationDeliveryProviderOptions
): NotificationDeliveryProvider {
  return {
    async deliver(input) {
      const payload = JSON.stringify({
        notificationId: input.notificationId,
        title: input.title,
        body: input.body,
        actionUrl: input.actionUrl
      });

      try {
        await webPush.sendNotification(
          {
            endpoint: input.endpoint,
            keys: {
              p256dh: input.p256dh,
              auth: input.auth
            }
          },
          payload,
          {
            TTL: options.ttlSeconds ?? 3600,
            timeout: options.timeoutMs ?? 10_000,
            urgency: "normal",
            vapidDetails: {
              subject: options.vapidSubject,
              publicKey: options.vapidPublicKey,
              privateKey: options.vapidPrivateKey
            }
          }
        );

        return { state: "delivered" };
      } catch (error) {
        const statusCode = getWebPushStatusCode(error);
        if (statusCode === 404 || statusCode === 410) {
          return {
            state: "revoked",
            failureCode: "push_subscription_gone"
          };
        }

        return {
          state: "failed",
          failureCode: statusCode ? `web_push_http_${statusCode}` : "web_push_delivery_failed",
          retryAt: new Date(Date.now() + 5 * 60 * 1000)
        };
      }
    }
  };
}

export function createPostgresNotificationDeliveryRepository(input: {
  databaseUrl?: string | undefined;
  encryptionKey?: string | undefined;
}): NotificationDeliveryRepository {
  if (!input.databaseUrl) {
    return {
      async enqueueDueDeliveries() {
        return 0;
      },
      async leaseDueDeliveries() {
        return [];
      },
      async recordDeliveryOutcome() {
        return;
      }
    };
  }

  const encryptionKey = parseAes256GcmKey(input.encryptionKey);
  const sql = postgres(input.databaseUrl, {
    max: 3,
    idle_timeout: 20,
    prepare: false
  });

  return {
    async enqueueDueDeliveries(input) {
      const rows = await sql<{ id: string }[]>`
        insert into notification_delivery_attempts (
          id,
          notification_id,
          device_id,
          user_id,
          provider,
          state,
          next_attempt_at
        )
        select
          gen_random_uuid(),
          n.id,
          nd.id,
          n.user_id,
          nd.provider,
          'queued',
          ${input.now}
        from notifications n
        join notification_devices nd on nd.user_id = n.user_id and nd.state = 'active'
        join notification_preferences np on np.user_id = n.user_id and np.push_enabled = true
        where n.state = 'unread'
          and case n.kind
            when 'message' then np.messages_enabled
            when 'engagement' then np.engagement_enabled
            when 'live' then np.live_enabled
            when 'payment' then np.payments_enabled
            when 'membership' then np.memberships_enabled
            when 'event_access' then np.event_access_enabled
            when 'mutuals' then np.mutuals_enabled
            when 'safety' then np.safety_enabled
            when 'wallet_action_required' then np.wallet_enabled
            when 'creator_setup' then np.creator_setup_enabled
            when 'studio_setup' then np.studio_setup_enabled
            else true
          end
        order by n.created_at asc
        limit ${input.limit}
        on conflict (notification_id, device_id) do nothing
        returning id
      `;

      return rows.length;
    },
    async leaseDueDeliveries(input) {
      if (!encryptionKey) return [];

      return sql.begin(async (transaction) => {
        await transaction`
          update notification_delivery_attempts
          set
            state = 'dead_letter',
            failure_code = coalesce(failure_code, 'notification_attempt_limit_exceeded'),
            lease_token = null,
            leased_until = null,
            updated_at = now()
          where state in ('queued', 'failed', 'leased')
            and attempt_count >= ${input.maxAttempts}
            and (state <> 'leased' or leased_until is null or leased_until <= ${input.now})
        `;

        const rows = await transaction<DeliveryLeaseRow[]>`
          update notification_delivery_attempts attempt
          set
            state = 'leased',
            leased_at = now(),
            lease_token = gen_random_uuid(),
            leased_until = ${new Date(input.now.getTime() + input.leaseDurationMs)},
            attempt_count = attempt.attempt_count + 1,
            updated_at = now()
          where attempt.id in (
            select due.id
            from notification_delivery_attempts due
            join notification_devices device on device.id = due.device_id
            where (
                (due.state in ('queued', 'failed') and due.next_attempt_at <= ${input.now})
                or (due.state = 'leased' and (due.leased_until is null or due.leased_until <= ${input.now}))
              )
              and due.attempt_count < ${input.maxAttempts}
              and device.state = 'active'
              and device.endpoint_ciphertext is not null
              and device.endpoint_iv is not null
              and device.endpoint_tag is not null
              and device.p256dh_ciphertext is not null
              and device.p256dh_iv is not null
              and device.p256dh_tag is not null
              and device.auth_ciphertext is not null
              and device.auth_iv is not null
              and device.auth_tag is not null
            order by due.next_attempt_at asc, due.created_at asc
            limit ${input.limit}
            for update skip locked
          )
          returning
            attempt.id as attempt_id,
            attempt.lease_token,
            attempt.attempt_count,
            attempt.notification_id,
            attempt.device_id,
            attempt.user_id,
            attempt.provider,
            (select title from notifications where id = attempt.notification_id) as title,
            (select body from notifications where id = attempt.notification_id) as body,
            (select action_url from notifications where id = attempt.notification_id) as action_url,
            (select endpoint_ciphertext from notification_devices where id = attempt.device_id) as endpoint_ciphertext,
            (select endpoint_iv from notification_devices where id = attempt.device_id) as endpoint_iv,
            (select endpoint_tag from notification_devices where id = attempt.device_id) as endpoint_tag,
            (select p256dh_ciphertext from notification_devices where id = attempt.device_id) as p256dh_ciphertext,
            (select p256dh_iv from notification_devices where id = attempt.device_id) as p256dh_iv,
            (select p256dh_tag from notification_devices where id = attempt.device_id) as p256dh_tag,
            (select auth_ciphertext from notification_devices where id = attempt.device_id) as auth_ciphertext,
            (select auth_iv from notification_devices where id = attempt.device_id) as auth_iv,
            (select auth_tag from notification_devices where id = attempt.device_id) as auth_tag
        `;

        return rows.map((row) => toDueDelivery(row, encryptionKey));
      });
    },
    async recordDeliveryOutcome(input) {
      await sql.begin(async (transaction) => {
        if (input.outcome.state === "delivered") {
          await transaction`
            update notification_delivery_attempts
            set
              state = 'delivered',
              failure_code = null,
              delivered_at = now(),
              lease_token = null,
              leased_until = null,
              updated_at = now()
            where id = ${input.attemptId}
              and state = 'leased'
              and lease_token = ${input.leaseToken}
          `;
          return;
        }

        if (input.outcome.state === "revoked") {
          const rows = await transaction<{ id: string }[]>`
            update notification_delivery_attempts
            set
              state = 'revoked',
              failure_code = ${input.outcome.failureCode},
              lease_token = null,
              leased_until = null,
              updated_at = now()
            where id = ${input.attemptId}
              and state = 'leased'
              and lease_token = ${input.leaseToken}
            returning id
          `;
          if (rows.length === 0) return;
          await transaction`
            update notification_devices
            set state = 'revoked', updated_at = now()
            where id = ${input.deviceId}
          `;
          return;
        }

        await transaction`
          update notification_delivery_attempts
          set
            state = case when attempt_count >= ${input.maxAttempts} then 'dead_letter' else 'failed' end,
            failure_code = ${input.outcome.failureCode},
            next_attempt_at = ${input.outcome.retryAt},
            lease_token = null,
            leased_until = null,
            updated_at = now()
          where id = ${input.attemptId}
            and state = 'leased'
            and lease_token = ${input.leaseToken}
        `;
      });
    },
    async close() {
      await sql.end({ timeout: 5 });
    }
  };
}

interface DeliveryLeaseRow {
  attempt_id: string;
  lease_token: string;
  attempt_count: number;
  notification_id: string;
  device_id: string;
  user_id: string;
  provider: DueNotificationDelivery["provider"];
  title: string;
  body: string | null;
  action_url: string | null;
  endpoint_ciphertext: string;
  endpoint_iv: string;
  endpoint_tag: string;
  p256dh_ciphertext: string;
  p256dh_iv: string;
  p256dh_tag: string;
  auth_ciphertext: string;
  auth_iv: string;
  auth_tag: string;
}

function toDueDelivery(row: DeliveryLeaseRow, key: Buffer): DueNotificationDelivery {
  return {
    attemptId: row.attempt_id,
    leaseToken: row.lease_token,
    attemptCount: row.attempt_count,
    notificationId: row.notification_id,
    deviceId: row.device_id,
    userId: row.user_id,
    provider: row.provider,
    title: row.title,
    body: row.body,
    actionUrl: row.action_url,
    endpoint: decrypt(row.endpoint_ciphertext, row.endpoint_iv, row.endpoint_tag, key),
    p256dh: decrypt(row.p256dh_ciphertext, row.p256dh_iv, row.p256dh_tag, key),
    auth: decrypt(row.auth_ciphertext, row.auth_iv, row.auth_tag, key)
  };
}

function decrypt(ciphertext: string, iv: string, tag: string, key: Buffer): string {
  return decryptSecret({ ciphertext, iv, tag } satisfies EncryptedSecret, key);
}

function getWebPushStatusCode(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;

  const statusCode = (error as { statusCode?: unknown }).statusCode;
  if (typeof statusCode === "number") return statusCode;

  return null;
}
