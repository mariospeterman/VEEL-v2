import { createHash, randomUUID } from "node:crypto";
import { encryptSecret } from "@veel/config";
import type postgres from "postgres";
import type { NotificationRepository } from "./types.js";
import { NotificationRepositoryConfigurationError } from "./notification-errors.js";
import { toDevice } from "./notification-repository-mappers.js";
import type { DeviceRow } from "./notification-repository-rows.js";

export function createNotificationDeviceRepositoryMethods(
  sql: postgres.Sql,
  encryptionKey: Buffer | null
): Pick<NotificationRepository, "registerDevice" | "deleteDevice"> {
  return {
    async registerDevice(input) {
      const endpointHash = sha256(input.body.endpoint);
      const p256dhHash = sha256(input.body.p256dh);
      const authHash = sha256(input.body.auth);
      const encryptedEndpoint = encryptionKey ? encryptSecret(input.body.endpoint, encryptionKey) : null;
      const encryptedP256dh = encryptionKey ? encryptSecret(input.body.p256dh, encryptionKey) : null;
      const encryptedAuth = encryptionKey ? encryptSecret(input.body.auth, encryptionKey) : null;
      const rows = await sql<DeviceRow[]>`
        with target_user as (
          select id
          from users
          where supabase_user_id = ${input.supabaseUserId}
          limit 1
        ),
        upserted as (
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
            last_seen_at,
            idempotency_key,
            updated_at
          )
          select
            ${randomUUID()},
            target_user.id,
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
            now(),
            ${input.idempotencyKey},
            now()
          from target_user
          on conflict (provider, endpoint_hash) do update
          set
            user_id = excluded.user_id,
            platform = excluded.platform,
            p256dh_hash = excluded.p256dh_hash,
            auth_hash = excluded.auth_hash,
            endpoint_ciphertext = excluded.endpoint_ciphertext,
            endpoint_iv = excluded.endpoint_iv,
            endpoint_tag = excluded.endpoint_tag,
            p256dh_ciphertext = excluded.p256dh_ciphertext,
            p256dh_iv = excluded.p256dh_iv,
            p256dh_tag = excluded.p256dh_tag,
            auth_ciphertext = excluded.auth_ciphertext,
            auth_iv = excluded.auth_iv,
            auth_tag = excluded.auth_tag,
            user_agent = excluded.user_agent,
            state = 'active',
            last_seen_at = now(),
            updated_at = now()
          returning id, provider, platform, state, created_at, last_seen_at
        )
        select * from upserted
      `;

      const row = rows[0];
      if (!row) throw new NotificationRepositoryConfigurationError();
      return toDevice(row);
    },
    async deleteDevice(input) {
      const rows = await sql<{ id: string }[]>`
        with target_user as (
          select id
          from users
          where supabase_user_id = ${input.supabaseUserId}
          limit 1
        )
        update notification_devices nd
        set state = 'revoked', updated_at = now()
        from target_user tu
        where nd.id = ${input.notificationDeviceId}
          and nd.user_id = tu.id
        returning nd.id
      `;

      return rows.length > 0;
    }
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
