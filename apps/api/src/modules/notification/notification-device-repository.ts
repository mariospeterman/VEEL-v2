import { createHash, randomUUID } from "node:crypto";
import { encryptSecret } from "@veel/config";
import type postgres from "postgres";
import {
  NotificationIdempotencyConflictError,
  NotificationRepositoryConfigurationError
} from "./notification-errors.js";
import { toDevice } from "./notification-repository-mappers.js";
import type { DeviceRow } from "./notification-repository-rows.js";
import type { NotificationDevice, NotificationRepository } from "./types.js";

interface StoredDeviceRow extends DeviceRow {
  user_id: string;
  p256dh_hash: string;
  auth_hash: string;
  subscription_generation: number;
}

interface DeviceReceiptRow<T> {
  action: string;
  request_hash: string;
  response_body: T;
}

export function createNotificationDeviceRepositoryMethods(
  sql: postgres.Sql,
  encryptionKey: Buffer | null
): Pick<NotificationRepository, "registerDevice" | "deleteDevice"> {
  return {
    async registerDevice(input) {
      const endpointHash = sha256(input.body.endpoint);
      const p256dhHash = sha256(input.body.p256dh);
      const authHash = sha256(input.body.auth);
      const requestHash = hashDeviceAction("notification.device.register", {
        provider: input.body.provider,
        platform: input.body.platform,
        endpointHash,
        p256dhHash,
        authHash,
        userAgent: input.body.userAgent ?? null
      });
      const encryptedEndpoint = encryptionKey ? encryptSecret(input.body.endpoint, encryptionKey) : null;
      const encryptedP256dh = encryptionKey ? encryptSecret(input.body.p256dh, encryptionKey) : null;
      const encryptedAuth = encryptionKey ? encryptSecret(input.body.auth, encryptionKey) : null;

      return sql.begin(async (transaction) => {
        const actorUserId = await lockDeviceActor(transaction, input.supabaseUserId);
        if (!actorUserId) throw new NotificationRepositoryConfigurationError();

        const replay = await readDeviceReceipt<NotificationDevice>(
          transaction,
          actorUserId,
          input.idempotencyKey
        );
        if (replay) {
          assertDeviceReceipt(replay, "notification.device.register", requestHash);
          return replay.response_body;
        }

        // Serialize registrations for the same opaque endpoint across accounts,
        // including the initial insert where no row exists to lock yet.
        await transaction`
          select pg_advisory_xact_lock(hashtextextended(${endpointHash}, 0))
        `;

        const existingRows = await transaction<StoredDeviceRow[]>`
          select
            id,
            user_id,
            provider,
            platform,
            state,
            p256dh_hash,
            auth_hash,
            subscription_generation::integer as subscription_generation,
            created_at,
            last_seen_at
          from notification_devices
          where provider = ${input.body.provider}
            and endpoint_hash = ${endpointHash}
          limit 1
          for update
        `;
        const existing = existingRows[0];
        const generationChanged = Boolean(
          existing &&
            (existing.user_id !== actorUserId ||
              existing.p256dh_hash !== p256dhHash ||
              existing.auth_hash !== authHash ||
              existing.state !== "active")
        );
        const nextGeneration = existing
          ? existing.subscription_generation + (generationChanged ? 1 : 0)
          : 1;

        const rows = existing
          ? await transaction<DeviceRow[]>`
              update notification_devices
              set
                user_id = ${actorUserId},
                platform = ${input.body.platform},
                p256dh_hash = ${p256dhHash},
                auth_hash = ${authHash},
                endpoint_ciphertext = ${encryptedEndpoint?.ciphertext ?? null},
                endpoint_iv = ${encryptedEndpoint?.iv ?? null},
                endpoint_tag = ${encryptedEndpoint?.tag ?? null},
                p256dh_ciphertext = ${encryptedP256dh?.ciphertext ?? null},
                p256dh_iv = ${encryptedP256dh?.iv ?? null},
                p256dh_tag = ${encryptedP256dh?.tag ?? null},
                auth_ciphertext = ${encryptedAuth?.ciphertext ?? null},
                auth_iv = ${encryptedAuth?.iv ?? null},
                auth_tag = ${encryptedAuth?.tag ?? null},
                user_agent = ${input.body.userAgent ?? null},
                state = 'active',
                subscription_generation = ${nextGeneration},
                last_seen_at = now(),
                idempotency_key = ${input.idempotencyKey},
                updated_at = now()
              where id = ${existing.id}
              returning id, provider, platform, state, created_at, last_seen_at
            `
          : await transaction<DeviceRow[]>`
              insert into notification_devices (
                id,
                user_id,
                provider,
                platform,
                endpoint_hash,
                p256dh_hash,
                auth_hash,
                endpoint_ciphertext,
                endpoint_iv,
                endpoint_tag,
                p256dh_ciphertext,
                p256dh_iv,
                p256dh_tag,
                auth_ciphertext,
                auth_iv,
                auth_tag,
                user_agent,
                state,
                subscription_generation,
                last_seen_at,
                idempotency_key,
                updated_at
              ) values (
                ${randomUUID()},
                ${actorUserId},
                ${input.body.provider},
                ${input.body.platform},
                ${endpointHash},
                ${p256dhHash},
                ${authHash},
                ${encryptedEndpoint?.ciphertext ?? null},
                ${encryptedEndpoint?.iv ?? null},
                ${encryptedEndpoint?.tag ?? null},
                ${encryptedP256dh?.ciphertext ?? null},
                ${encryptedP256dh?.iv ?? null},
                ${encryptedP256dh?.tag ?? null},
                ${encryptedAuth?.ciphertext ?? null},
                ${encryptedAuth?.iv ?? null},
                ${encryptedAuth?.tag ?? null},
                ${input.body.userAgent ?? null},
                'active',
                1,
                now(),
                ${input.idempotencyKey},
                now()
              )
              returning id, provider, platform, state, created_at, last_seen_at
            `;

        const row = rows[0];
        if (!row) throw new NotificationRepositoryConfigurationError();

        if (existing && generationChanged) {
          await transaction`
            update notification_delivery_attempts
            set
              state = 'skipped',
              failure_code = 'push_subscription_generation_superseded',
              lease_token = null,
              leased_until = null,
              updated_at = now()
            where device_id = ${existing.id}
              and state in ('queued', 'leased', 'failed')
              and (
                device_subscription_generation <> ${nextGeneration}
                or user_id <> ${actorUserId}
              )
          `;
        }

        const response = toDevice(row);
        await recordDeviceReceipt(
          transaction,
          actorUserId,
          input.idempotencyKey,
          "notification.device.register",
          requestHash,
          response
        );
        return response;
      });
    },

    async deleteDevice(input) {
      const requestHash = hashDeviceAction("notification.device.revoke", {
        notificationDeviceId: input.notificationDeviceId
      });

      return sql.begin(async (transaction) => {
        const actorUserId = await lockDeviceActor(transaction, input.supabaseUserId);
        if (!actorUserId) return false;

        const replay = await readDeviceReceipt<{ deleted: boolean }>(
          transaction,
          actorUserId,
          input.idempotencyKey
        );
        if (replay) {
          assertDeviceReceipt(replay, "notification.device.revoke", requestHash);
          return replay.response_body.deleted;
        }

        const rows = await transaction<{ id: string; subscription_generation: number }[]>`
          select id, subscription_generation::integer as subscription_generation
          from notification_devices
          where id = ${input.notificationDeviceId}
            and user_id = ${actorUserId}
          limit 1
          for update
        `;
        const device = rows[0];
        if (!device) return false;

        await transaction`
          update notification_devices
          set state = 'revoked', updated_at = now()
          where id = ${device.id}
            and user_id = ${actorUserId}
        `;
        await transaction`
          update notification_delivery_attempts
          set
            state = 'skipped',
            failure_code = 'push_subscription_revoked',
            lease_token = null,
            leased_until = null,
            updated_at = now()
          where device_id = ${device.id}
            and user_id = ${actorUserId}
            and device_subscription_generation = ${device.subscription_generation}
            and state in ('queued', 'leased', 'failed')
        `;

        await recordDeviceReceipt(
          transaction,
          actorUserId,
          input.idempotencyKey,
          "notification.device.revoke",
          requestHash,
          { deleted: true }
        );
        return true;
      });
    }
  };
}

async function lockDeviceActor(
  transaction: postgres.TransactionSql,
  supabaseUserId: string
): Promise<string | null> {
  const rows = await transaction<{ id: string }[]>`
    select id
    from users
    where supabase_user_id = ${supabaseUserId}
    limit 1
    for update
  `;
  return rows[0]?.id ?? null;
}

async function readDeviceReceipt<T>(
  transaction: postgres.TransactionSql,
  actorUserId: string,
  idempotencyKey: string
): Promise<DeviceReceiptRow<T> | null> {
  const rows = await transaction<DeviceReceiptRow<T>[]>`
    select action, request_hash, response_body
    from notification_action_receipts
    where actor_user_id = ${actorUserId}
      and idempotency_key = ${idempotencyKey}
    limit 1
  `;
  return rows[0] ?? null;
}

function assertDeviceReceipt<T>(
  receipt: DeviceReceiptRow<T>,
  action: string,
  requestHash: string
): void {
  if (receipt.action !== action || receipt.request_hash !== requestHash) {
    throw new NotificationIdempotencyConflictError();
  }
}

async function recordDeviceReceipt(
  transaction: postgres.TransactionSql,
  actorUserId: string,
  idempotencyKey: string,
  action: string,
  requestHash: string,
  response: NotificationDevice | { deleted: boolean }
): Promise<void> {
  await transaction`
    insert into notification_action_receipts (
      actor_user_id, idempotency_key, action, request_hash, response_body
    ) values (
      ${actorUserId},
      ${idempotencyKey},
      ${action},
      ${requestHash},
      ${transaction.json(response)}
    )
  `;
}

function hashDeviceAction(action: string, body: Record<string, unknown>): string {
  const normalized = Object.fromEntries(
    Object.entries(body).sort(([left], [right]) => left.localeCompare(right))
  );
  return createHash("sha256")
    .update(JSON.stringify({ action, body: normalized }))
    .digest("hex");
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
