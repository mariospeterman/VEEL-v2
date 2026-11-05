import {
  decryptSecret,
  parseAes256GcmKey,
  validateWebPushSubscription,
  type EncryptedSecret,
  type WebPushDnsResolver,
  type WebPushResolvedAddress
} from "@veel/config";
import { request as httpsRequest } from "node:https";
import type { IncomingMessage } from "node:http";
import type { LookupFunction } from "node:net";
import postgres from "postgres";
import webPush from "web-push";

const WEB_PUSH_RESPONSE_LIMIT_BYTES = 8 * 1_024;
const WEB_PUSH_DEFAULT_TIMEOUT_MS = 10_000;
const WEB_PUSH_DEFAULT_CONCURRENCY = 5;

export type NotificationDeliveryOutcome =
  | { state: "delivered" }
  | { state: "failed"; failureCode: string; retryAt: Date }
  | { state: "revoked"; failureCode: string };

export interface LeasedNotificationDelivery {
  attemptId: string;
  leaseToken: string;
  attemptCount: number;
  notificationId: string;
  deviceId: string;
  deviceSubscriptionGeneration: number;
  userId: string;
  provider: "web_push";
}

export interface DueNotificationDelivery extends LeasedNotificationDelivery {
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
  }): Promise<LeasedNotificationDelivery[]>;
  prepareDeliveryForDispatch(
    input: LeasedNotificationDelivery
  ): Promise<DueNotificationDelivery | null>;
  recordDeliveryOutcome(input: {
    attemptId: string;
    deviceId: string;
    deviceSubscriptionGeneration: number;
    userId: string;
    leaseToken: string;
    maxAttempts: number;
    outcome: NotificationDeliveryOutcome;
  }): Promise<void>;
  close?(): Promise<void>;
}

export interface NotificationDeliveryProvider {
  deliver(input: DueNotificationDelivery): Promise<NotificationDeliveryOutcome>;
}

export interface WebPushRequestInput {
  subscription: Pick<DueNotificationDelivery, "endpoint" | "p256dh" | "auth">;
  payload: string;
  vapidSubject: string;
  vapidPublicKey: string;
  vapidPrivateKey: string;
  ttlSeconds: number;
  timeoutMs: number;
  resolver?: WebPushDnsResolver | undefined;
}

export type WebPushRequestSender = (input: WebPushRequestInput) => Promise<void>;

export interface WebPushNotificationDeliveryProviderOptions {
  vapidSubject: string;
  vapidPublicKey: string;
  vapidPrivateKey: string;
  ttlSeconds?: number | undefined;
  timeoutMs?: number | undefined;
  resolver?: WebPushDnsResolver | undefined;
  requestSender?: WebPushRequestSender | undefined;
}

export interface ProcessNotificationDeliveriesResult {
  enqueued: number;
  leased: number;
  delivered: number;
  failed: number;
  revoked: number;
  skipped: number;
}

export async function processNotificationDeliveries(input: {
  repository: NotificationDeliveryRepository;
  provider: NotificationDeliveryProvider;
  now?: Date;
  limit?: number;
  leaseDurationMs?: number;
  maxAttempts?: number;
  concurrency?: number;
}): Promise<ProcessNotificationDeliveriesResult> {
  const now = input.now ?? new Date();
  const limit = Math.min(input.limit ?? 20, 20);
  const leaseDurationMs = input.leaseDurationMs ?? 5 * 60 * 1_000;
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
    revoked: 0,
    skipped: 0
  };

  await runWithConcurrency(
    deliveries,
    input.concurrency ?? WEB_PUSH_DEFAULT_CONCURRENCY,
    async (lease) => {
      const delivery = await input.repository.prepareDeliveryForDispatch(lease);
      if (!delivery) {
        result.skipped += 1;
        return;
      }

      const outcome = await input.provider.deliver(delivery);
      await input.repository.recordDeliveryOutcome({
        attemptId: delivery.attemptId,
        deviceId: delivery.deviceId,
        deviceSubscriptionGeneration: delivery.deviceSubscriptionGeneration,
        userId: delivery.userId,
        leaseToken: delivery.leaseToken,
        maxAttempts,
        outcome
      });

      if (outcome.state === "delivered") result.delivered += 1;
      else if (outcome.state === "revoked") result.revoked += 1;
      else result.failed += 1;
    }
  );

  return result;
}

export function createUnconfiguredNotificationDeliveryProvider(): NotificationDeliveryProvider {
  return {
    async deliver() {
      return {
        state: "failed",
        failureCode: "notification_delivery_provider_not_configured",
        retryAt: new Date(Date.now() + 5 * 60 * 1_000)
      };
    }
  };
}

export function createWebPushNotificationDeliveryProvider(
  options: WebPushNotificationDeliveryProviderOptions
): NotificationDeliveryProvider {
  const requestSender = options.requestSender ?? sendBoundedWebPushRequest;

  return {
    async deliver(input) {
      // Push transports receive no account, notification, payment, message, or
      // navigation content.  The service worker opens the authenticated inbox,
      // which fetches the current server-authorized projection.
      const payload = JSON.stringify({ type: "notification_refresh", version: 1 });

      try {
        await requestSender({
          subscription: {
            endpoint: input.endpoint,
            p256dh: input.p256dh,
            auth: input.auth
          },
          payload,
          vapidSubject: options.vapidSubject,
          vapidPublicKey: options.vapidPublicKey,
          vapidPrivateKey: options.vapidPrivateKey,
          ttlSeconds: options.ttlSeconds ?? 3_600,
          timeoutMs: options.timeoutMs ?? WEB_PUSH_DEFAULT_TIMEOUT_MS,
          ...(options.resolver ? { resolver: options.resolver } : {})
        });
        return { state: "delivered" };
      } catch (error) {
        const statusCode = getWebPushStatusCode(error);
        if (statusCode === 404 || statusCode === 410) {
          return { state: "revoked", failureCode: "push_subscription_gone" };
        }

        return {
          state: "failed",
          failureCode: statusCode ? `web_push_http_${statusCode}` : "web_push_delivery_failed",
          retryAt: new Date(Date.now() + 5 * 60 * 1_000)
        };
      }
    }
  };
}

export async function sendBoundedWebPushRequest(
  input: WebPushRequestInput,
  dependencies: { requestFactory?: typeof httpsRequest } = {}
): Promise<void> {
  const deadlineAt = Date.now() + input.timeoutMs;
  const resolutionBudget = Math.min(2_000, remainingDeadlineMs(deadlineAt));
  const validated = await validateWebPushSubscription(input.subscription, {
    ...(input.resolver ? { resolver: input.resolver } : {}),
    timeoutMs: resolutionBudget
  });
  const requestDetails = webPush.generateRequestDetails(
    {
      endpoint: validated.endpoint,
      keys: { p256dh: validated.p256dh, auth: validated.auth }
    },
    input.payload,
    {
      TTL: input.ttlSeconds,
      urgency: "normal",
      vapidDetails: {
        subject: input.vapidSubject,
        publicKey: input.vapidPublicKey,
        privateKey: input.vapidPrivateKey
      }
    }
  );
  const endpoint = new URL(requestDetails.endpoint);
  const statusCode = await performPinnedHttpsRequest({
    endpoint,
    addresses: validated.addresses,
    method: requestDetails.method,
    headers: requestDetails.headers,
    body: requestDetails.body,
    timeoutMs: remainingDeadlineMs(deadlineAt),
    requestFactory: dependencies.requestFactory ?? httpsRequest
  });

  if (statusCode < 200 || statusCode > 299) {
    throw new WebPushHttpStatusError(statusCode);
  }
}

export function createPostgresNotificationDeliveryRepository(input: {
  databaseUrl?: string | undefined;
  encryptionKey?: string | undefined;
  sql?: postgres.Sql | undefined;
}): NotificationDeliveryRepository {
  if (!input.databaseUrl && !input.sql) {
    return {
      async enqueueDueDeliveries() {
        return 0;
      },
      async leaseDueDeliveries() {
        return [];
      },
      async prepareDeliveryForDispatch() {
        return null;
      },
      async recordDeliveryOutcome() {
        return;
      }
    };
  }

  const encryptionKey = parseAes256GcmKey(input.encryptionKey);
  const ownsSql = !input.sql;
  const sql = input.sql ?? postgres(input.databaseUrl as string, {
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
          device_subscription_generation,
          user_id,
          provider,
          state,
          next_attempt_at
        )
        select
          gen_random_uuid(),
          notification.id,
          device.id,
          device.subscription_generation,
          notification.user_id,
          device.provider,
          'queued',
          ${input.now}
        from notifications notification
        join notification_devices device
          on device.user_id = notification.user_id
          and device.state = 'active'
        join notification_preferences preference
          on preference.user_id = notification.user_id
          and preference.push_enabled = true
        where notification.state = 'unread'
          and case notification.kind
            when 'message' then preference.messages_enabled
            when 'engagement' then preference.engagement_enabled
            when 'live' then preference.live_enabled
            when 'payment' then preference.payments_enabled
            when 'membership' then preference.memberships_enabled
            when 'event_access' then preference.event_access_enabled
            when 'mutuals' then preference.mutuals_enabled
            when 'safety' then preference.safety_enabled
            when 'wallet_action_required' then preference.wallet_enabled
            when 'creator_setup' then preference.creator_setup_enabled
            when 'studio_setup' then preference.studio_setup_enabled
            else true
          end
          and not exists (
            select 1
            from notification_delivery_attempts existing
            where existing.notification_id = notification.id
              and existing.device_id = device.id
              and existing.device_subscription_generation = device.subscription_generation
          )
        order by notification.created_at asc, notification.id asc, device.created_at asc, device.id asc
        limit ${input.limit}
        on conflict (notification_id, device_id, device_subscription_generation) do nothing
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

        return transaction<LeasedDeliveryRow[]>`
          update notification_delivery_attempts attempt
          set
            state = 'leased',
            leased_at = now(),
            dispatch_started_at = null,
            lease_token = gen_random_uuid(),
            leased_until = ${new Date(input.now.getTime() + input.leaseDurationMs)},
            attempt_count = attempt.attempt_count + 1,
            updated_at = now()
          where attempt.id in (
            select due.id
            from notification_delivery_attempts due
            where (
                (due.state in ('queued', 'failed') and due.next_attempt_at <= ${input.now})
                or (due.state = 'leased' and (due.leased_until is null or due.leased_until <= ${input.now}))
              )
              and due.attempt_count < ${input.maxAttempts}
            order by due.next_attempt_at asc, due.created_at asc, due.id asc
            limit ${input.limit}
            for update skip locked
          )
          returning
            attempt.id as attempt_id,
            attempt.lease_token,
            attempt.attempt_count,
            attempt.notification_id,
            attempt.device_id,
            attempt.device_subscription_generation::integer as device_subscription_generation,
            attempt.user_id,
            attempt.provider
        `.then((rows) => rows.map(toLeasedDelivery));
      });
    },

    async prepareDeliveryForDispatch(input) {
      if (!encryptionKey) return null;

      return sql.begin(async (transaction) => {
        const deviceRows = await transaction<DispatchDeviceRow[]>`
          select
            id,
            user_id,
            provider,
            state,
            subscription_generation::integer as subscription_generation,
            endpoint_ciphertext,
            endpoint_iv,
            endpoint_tag,
            p256dh_ciphertext,
            p256dh_iv,
            p256dh_tag,
            auth_ciphertext,
            auth_iv,
            auth_tag
          from notification_devices
          where id = ${input.deviceId}
          limit 1
          for update
        `;
        const device = deviceRows[0];
        if (!device) return null;

        const attemptRows = await transaction<DispatchAttemptRow[]>`
          select
            attempt.id,
            attempt.state,
            attempt.lease_token,
            attempt.notification_id,
            attempt.device_id,
            attempt.device_subscription_generation::integer as device_subscription_generation,
            attempt.user_id,
            attempt.provider,
            notification.user_id as notification_user_id,
            notification.state as notification_state,
            notification.kind as notification_kind,
            app_user.state as user_state,
            coalesce(preference.push_enabled, false) as push_enabled,
            coalesce(preference.messages_enabled, false) as messages_enabled,
            coalesce(preference.engagement_enabled, false) as engagement_enabled,
            coalesce(preference.live_enabled, false) as live_enabled,
            coalesce(preference.payments_enabled, false) as payments_enabled,
            coalesce(preference.memberships_enabled, false) as memberships_enabled,
            coalesce(preference.event_access_enabled, false) as event_access_enabled,
            coalesce(preference.mutuals_enabled, false) as mutuals_enabled,
            coalesce(preference.safety_enabled, false) as safety_enabled,
            coalesce(preference.wallet_enabled, false) as wallet_enabled,
            coalesce(preference.creator_setup_enabled, false) as creator_setup_enabled,
            coalesce(preference.studio_setup_enabled, false) as studio_setup_enabled
          from notification_delivery_attempts attempt
          join notifications notification on notification.id = attempt.notification_id
          join users app_user on app_user.id = attempt.user_id
          left join notification_preferences preference on preference.user_id = attempt.user_id
          where attempt.id = ${input.attemptId}
          limit 1
          for update of attempt
        `;
        const attempt = attemptRows[0];
        if (!attempt) return null;

        const failureCode = dispatchRejectionCode(input, attempt, device);
        if (failureCode) {
          await skipLeasedAttempt(transaction, input, failureCode);
          return null;
        }

        let subscription: Pick<DueNotificationDelivery, "endpoint" | "p256dh" | "auth">;
        try {
          subscription = {
            endpoint: decryptRequired(
              device.endpoint_ciphertext,
              device.endpoint_iv,
              device.endpoint_tag,
              encryptionKey
            ),
            p256dh: decryptRequired(
              device.p256dh_ciphertext,
              device.p256dh_iv,
              device.p256dh_tag,
              encryptionKey
            ),
            auth: decryptRequired(
              device.auth_ciphertext,
              device.auth_iv,
              device.auth_tag,
              encryptionKey
            )
          };
        } catch {
          await skipLeasedAttempt(transaction, input, "push_subscription_material_invalid");
          return null;
        }

        const updated = await transaction<{ id: string }[]>`
          update notification_delivery_attempts
          set dispatch_started_at = now(), updated_at = now()
          where id = ${input.attemptId}
            and state = 'leased'
            and lease_token = ${input.leaseToken}
            and user_id = ${input.userId}
            and device_id = ${input.deviceId}
            and device_subscription_generation = ${input.deviceSubscriptionGeneration}
          returning id
        `;
        if (updated.length === 0) return null;

        return { ...input, ...subscription };
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
              and user_id = ${input.userId}
              and device_id = ${input.deviceId}
              and device_subscription_generation = ${input.deviceSubscriptionGeneration}
          `;
          return;
        }

        if (input.outcome.state === "revoked") {
          await transaction`
            select id
            from notification_devices
            where id = ${input.deviceId}
            limit 1
            for update
          `;
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
              and user_id = ${input.userId}
              and device_id = ${input.deviceId}
              and device_subscription_generation = ${input.deviceSubscriptionGeneration}
            returning id
          `;
          if (rows.length === 0) return;
          await transaction`
            update notification_devices
            set state = 'revoked', updated_at = now()
            where id = ${input.deviceId}
              and user_id = ${input.userId}
              and subscription_generation = ${input.deviceSubscriptionGeneration}
              and state = 'active'
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
            and user_id = ${input.userId}
            and device_id = ${input.deviceId}
            and device_subscription_generation = ${input.deviceSubscriptionGeneration}
        `;
      });
    },

    async close() {
      if (ownsSql) await sql.end({ timeout: 5 });
    }
  };
}

interface LeasedDeliveryRow {
  attempt_id: string;
  lease_token: string;
  attempt_count: number;
  notification_id: string;
  device_id: string;
  device_subscription_generation: number;
  user_id: string;
  provider: DueNotificationDelivery["provider"];
}

interface DispatchDeviceRow {
  id: string;
  user_id: string;
  provider: DueNotificationDelivery["provider"];
  state: "active" | "revoked";
  subscription_generation: number;
  endpoint_ciphertext: string | null;
  endpoint_iv: string | null;
  endpoint_tag: string | null;
  p256dh_ciphertext: string | null;
  p256dh_iv: string | null;
  p256dh_tag: string | null;
  auth_ciphertext: string | null;
  auth_iv: string | null;
  auth_tag: string | null;
}

interface DispatchAttemptRow {
  id: string;
  state: string;
  lease_token: string | null;
  notification_id: string;
  device_id: string;
  device_subscription_generation: number;
  user_id: string;
  provider: DueNotificationDelivery["provider"];
  notification_user_id: string;
  notification_state: string;
  notification_kind: string;
  user_state: string;
  push_enabled: boolean;
  messages_enabled: boolean;
  engagement_enabled: boolean;
  live_enabled: boolean;
  payments_enabled: boolean;
  memberships_enabled: boolean;
  event_access_enabled: boolean;
  mutuals_enabled: boolean;
  safety_enabled: boolean;
  wallet_enabled: boolean;
  creator_setup_enabled: boolean;
  studio_setup_enabled: boolean;
}

function toLeasedDelivery(row: LeasedDeliveryRow): LeasedNotificationDelivery {
  return {
    attemptId: row.attempt_id,
    leaseToken: row.lease_token,
    attemptCount: row.attempt_count,
    notificationId: row.notification_id,
    deviceId: row.device_id,
    deviceSubscriptionGeneration: row.device_subscription_generation,
    userId: row.user_id,
    provider: row.provider
  };
}

function dispatchRejectionCode(
  lease: LeasedNotificationDelivery,
  attempt: DispatchAttemptRow,
  device: DispatchDeviceRow
): string | null {
  if (
    attempt.state !== "leased" ||
    attempt.lease_token !== lease.leaseToken ||
    attempt.id !== lease.attemptId
  ) return "push_delivery_lease_superseded";
  if (
    attempt.user_id !== lease.userId ||
    attempt.device_id !== lease.deviceId ||
    attempt.device_subscription_generation !== lease.deviceSubscriptionGeneration
  ) return "push_delivery_identity_mismatch";
  if (
    device.state !== "active" ||
    device.user_id !== attempt.user_id ||
    device.subscription_generation !== attempt.device_subscription_generation ||
    device.provider !== attempt.provider
  ) return "push_subscription_superseded";
  if (
    attempt.notification_user_id !== attempt.user_id ||
    attempt.notification_state !== "unread" ||
    attempt.user_state !== "active"
  ) return "push_notification_no_longer_deliverable";
  if (!attempt.push_enabled || !preferenceAllowsKind(attempt)) {
    return "push_preference_disabled";
  }
  return null;
}

function preferenceAllowsKind(attempt: DispatchAttemptRow): boolean {
  switch (attempt.notification_kind) {
    case "message": return attempt.messages_enabled;
    case "engagement": return attempt.engagement_enabled;
    case "live": return attempt.live_enabled;
    case "payment": return attempt.payments_enabled;
    case "membership": return attempt.memberships_enabled;
    case "event_access": return attempt.event_access_enabled;
    case "mutuals": return attempt.mutuals_enabled;
    case "safety": return attempt.safety_enabled;
    case "wallet_action_required": return attempt.wallet_enabled;
    case "creator_setup": return attempt.creator_setup_enabled;
    case "studio_setup": return attempt.studio_setup_enabled;
    default: return true;
  }
}

async function skipLeasedAttempt(
  transaction: postgres.TransactionSql,
  input: LeasedNotificationDelivery,
  failureCode: string
): Promise<void> {
  await transaction`
    update notification_delivery_attempts
    set
      state = 'skipped',
      failure_code = ${failureCode},
      lease_token = null,
      leased_until = null,
      updated_at = now()
    where id = ${input.attemptId}
      and state = 'leased'
      and lease_token = ${input.leaseToken}
      and user_id = ${input.userId}
      and device_id = ${input.deviceId}
      and device_subscription_generation = ${input.deviceSubscriptionGeneration}
  `;
}

function decryptRequired(
  ciphertext: string | null,
  iv: string | null,
  tag: string | null,
  key: Buffer
): string {
  if (!ciphertext || !iv || !tag) throw new Error("missing encrypted push material");
  return decryptSecret({ ciphertext, iv, tag } satisfies EncryptedSecret, key);
}

async function runWithConcurrency<T>(
  values: readonly T[],
  concurrency: number,
  handler: (value: T) => Promise<void>
): Promise<void> {
  const bounded = Math.max(1, Math.min(values.length || 1, Math.floor(concurrency)));
  let nextIndex = 0;
  await Promise.all(
    Array.from({ length: bounded }, async () => {
      while (nextIndex < values.length) {
        const value = values[nextIndex];
        nextIndex += 1;
        if (value !== undefined) await handler(value);
      }
    })
  );
}

async function performPinnedHttpsRequest(input: {
  endpoint: URL;
  addresses: WebPushResolvedAddress[];
  method: "POST";
  headers: webPush.Headers;
  body: Buffer | null;
  timeoutMs: number;
  requestFactory: typeof httpsRequest;
}): Promise<number> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let responseBytes = 0;
    const timerRef: { current?: NodeJS.Timeout } = {};
    const finish = (error: Error | null, statusCode?: number) => {
      if (settled) return;
      settled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      if (error) reject(error);
      else resolve(statusCode ?? 0);
    };
    const request = input.requestFactory(
      {
        protocol: "https:",
        hostname: input.endpoint.hostname,
        port: 443,
        path: `${input.endpoint.pathname}${input.endpoint.search}`,
        method: input.method,
        headers: input.headers,
        servername: input.endpoint.hostname,
        agent: false,
        lookup: createPinnedLookup(input.addresses),
        maxHeaderSize: WEB_PUSH_RESPONSE_LIMIT_BYTES
      },
      (response: IncomingMessage) => {
        response.on("data", (chunk: Buffer | string) => {
          responseBytes += Buffer.byteLength(chunk);
          if (responseBytes > WEB_PUSH_RESPONSE_LIMIT_BYTES) {
            const error = new Error("web_push_response_too_large");
            response.destroy(error);
            request.destroy(error);
          }
        });
        response.on("end", () => finish(null, response.statusCode));
        response.on("error", (error) => finish(error));
      }
    );
    timerRef.current = setTimeout(() => {
      request.destroy(new Error("web_push_total_deadline_exceeded"));
    }, input.timeoutMs);
    timerRef.current.unref?.();
    request.on("error", (error) => finish(error));
    if (input.body) request.write(input.body);
    request.end();
  });
}

function createPinnedLookup(addresses: WebPushResolvedAddress[]): LookupFunction {
  return (_hostname, options, callback) => {
    const requestedFamily = options.family === 4 || options.family === 6
      ? options.family
      : 0;
    const candidates = requestedFamily === 0
      ? addresses
      : addresses.filter((entry) => entry.family === requestedFamily);
    if (candidates.length === 0) {
      const error = Object.assign(new Error("No approved push service address"), {
        code: "ENOTFOUND"
      });
      callback(error, "", 0);
      return;
    }
    if (options.all) {
      callback(null, candidates);
      return;
    }
    const selected = candidates[0] as WebPushResolvedAddress;
    callback(null, selected.address, selected.family);
  };
}

function remainingDeadlineMs(deadlineAt: number): number {
  const remaining = deadlineAt - Date.now();
  if (remaining <= 0) throw new Error("web_push_total_deadline_exceeded");
  return remaining;
}

class WebPushHttpStatusError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number) {
    super("web_push_http_error");
    this.name = "WebPushHttpStatusError";
    this.statusCode = statusCode;
  }
}

function getWebPushStatusCode(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const statusCode = (error as { statusCode?: unknown }).statusCode;
  return typeof statusCode === "number" ? statusCode : null;
}
