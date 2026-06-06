import { decryptSecret, parseAes256GcmKey, type EncryptedSecret } from "@veel/config";
import postgres from "postgres";

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
  leaseDueDeliveries(input: { now: Date; limit: number }): Promise<DueNotificationDelivery[]>;
  recordDeliveryOutcome(input: {
    attemptId: string;
    deviceId: string;
    outcome: NotificationDeliveryOutcome;
  }): Promise<void>;
  close?(): Promise<void>;
}

export interface NotificationDeliveryProvider {
  deliver(input: DueNotificationDelivery): Promise<NotificationDeliveryOutcome>;
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
}): Promise<ProcessNotificationDeliveriesResult> {
  const now = input.now ?? new Date();
  const limit = input.limit ?? 50;
  const enqueued = await input.repository.enqueueDueDeliveries({ now, limit });
  const deliveries = await input.repository.leaseDueDeliveries({ now, limit });
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
        const rows = await transaction<DeliveryLeaseRow[]>`
          update notification_delivery_attempts attempt
          set
            state = 'leased',
            leased_at = now(),
            attempt_count = attempt.attempt_count + 1,
            updated_at = now()
          where attempt.id in (
            select due.id
            from notification_delivery_attempts due
            join notification_devices device on device.id = due.device_id
            where due.state in ('queued', 'failed')
              and due.next_attempt_at <= ${input.now}
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
              updated_at = now()
            where id = ${input.attemptId}
          `;
          return;
        }

        if (input.outcome.state === "revoked") {
          await transaction`
            update notification_delivery_attempts
            set
              state = 'revoked',
              failure_code = ${input.outcome.failureCode},
              updated_at = now()
            where id = ${input.attemptId}
          `;
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
            state = 'failed',
            failure_code = ${input.outcome.failureCode},
            next_attempt_at = ${input.outcome.retryAt},
            updated_at = now()
          where id = ${input.attemptId}
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
