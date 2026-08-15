import { createHash } from "node:crypto";
import { parseAes256GcmKey } from "@veel/config";
import { resolvePostgresClient, type PostgresSql } from "../../shared/postgres.js";
import { createNotificationDeviceRepositoryMethods } from "./notification-device-repository.js";
import {
  NotificationIdempotencyConflictError,
  NotificationRepositoryConfigurationError
} from "./notification-errors.js";
import { toNotification, toNotificationPage, toPreferences } from "./notification-repository-mappers.js";
import type { NotificationRow, PreferenceRow } from "./notification-repository-rows.js";
import type { Notification, NotificationPreferences, NotificationRepository } from "./types.js";

export { NotificationIdempotencyConflictError, NotificationRepositoryConfigurationError } from "./notification-errors.js";

interface NotificationRepositoryOptions {
  encryptionKey?: string | undefined;
}

export function createPostgresNotificationRepository(
  database?: string | PostgresSql,
  options: NotificationRepositoryOptions = {}
): NotificationRepository {
  if (!database) {
    return createUnavailableNotificationRepository();
  }

  const { sql, ownsClient } = resolvePostgresClient(database);
  const encryptionKey = parseAes256GcmKey(options.encryptionKey);

  return {
    async listNotifications(input) {
      const rows = await sql<NotificationRow[]>`
        with target_user as (
          select id
          from users
          where supabase_user_id = ${input.supabaseUserId}
          limit 1
        )
        select
          n.id,
          n.kind,
          n.title,
          n.body,
          n.action_url,
          n.state,
          n.related_resource_type,
          n.related_resource_id::text as related_resource_id,
          n.created_at,
          n.read_at
        from notifications n
        join target_user tu on tu.id = n.user_id
        where (${input.cursor ?? null}::timestamptz is null or n.created_at < ${input.cursor ?? null}::timestamptz)
        order by n.created_at desc
        limit ${input.limit + 1}
      `;

      return toNotificationPage(rows, input.limit);
    },
    async markRead(input) {
      return sql.begin(async (transaction) => {
        const actor = await lockNotificationActor(transaction, input.supabaseUserId);
        if (!actor) return null;
        const requestHash = hashNotificationAction("notification.read", { notificationId: input.notificationId });
        const replay = await readNotificationReceipt<Notification>(transaction, actor, input.idempotencyKey);
        if (replay) {
          assertNotificationReceipt(replay, "notification.read", requestHash);
          return replay.response_body;
        }

        const rows = await transaction<NotificationRow[]>`
          update notifications n
          set state = 'read', read_at = coalesce(n.read_at, now())
          where n.id = ${input.notificationId}
            and n.user_id = ${actor}
          returning n.id, n.kind, n.title, n.body, n.action_url, n.state, n.related_resource_type, n.related_resource_id::text as related_resource_id, n.created_at, n.read_at
        `;
        const row = rows[0];
        if (!row) return null;
        const response = toNotification(row);
        await recordNotificationReceipt(transaction, actor, input.idempotencyKey, "notification.read", requestHash, response);
        return response;
      });
    },
    async getPreferences(input) {
      const rows = await sql<PreferenceRow[]>`
        with target_user as (
          select id
          from users
          where supabase_user_id = ${input.supabaseUserId}
          limit 1
        ),
        inserted as (
          insert into notification_preferences (user_id)
          select id
          from target_user
          on conflict (user_id) do nothing
          returning *
        )
        select
          messages_enabled,
          engagement_enabled,
          live_enabled,
          payments_enabled,
          memberships_enabled,
          event_access_enabled,
          mutuals_enabled,
          safety_enabled,
          wallet_enabled,
          creator_setup_enabled,
          studio_setup_enabled,
          push_enabled,
          updated_at
        from inserted
        union all
        select
          np.messages_enabled,
          np.engagement_enabled,
          np.live_enabled,
          np.payments_enabled,
          np.memberships_enabled,
          np.event_access_enabled,
          np.mutuals_enabled,
          np.safety_enabled,
          np.wallet_enabled,
          np.creator_setup_enabled,
          np.studio_setup_enabled,
          np.push_enabled,
          np.updated_at
        from notification_preferences np
        join target_user tu on tu.id = np.user_id
        limit 1
      `;

      return toPreferences(rows[0]);
    },
    async updatePreferences(input) {
      return sql.begin(async (transaction) => {
        const actor = await lockNotificationActor(transaction, input.supabaseUserId);
        if (!actor) return toPreferences(undefined);
        const requestHash = hashNotificationAction("notification.preferences.update", input.body);
        const replay = await readNotificationReceipt<NotificationPreferences>(transaction, actor, input.idempotencyKey);
        if (replay) {
          assertNotificationReceipt(replay, "notification.preferences.update", requestHash);
          return replay.response_body;
        }

        const rows = await transaction<PreferenceRow[]>`
          insert into notification_preferences (
            user_id,
            messages_enabled,
            engagement_enabled,
            live_enabled,
            payments_enabled,
            memberships_enabled,
            event_access_enabled,
            mutuals_enabled,
            safety_enabled,
            wallet_enabled,
            creator_setup_enabled,
            studio_setup_enabled,
            push_enabled,
            updated_at
          )
          values (
            ${actor},
            coalesce(${input.body.messagesEnabled ?? null}, true),
            coalesce(${input.body.engagementEnabled ?? null}, true),
            coalesce(${input.body.liveEnabled ?? null}, true),
            coalesce(${input.body.paymentsEnabled ?? null}, true),
            coalesce(${input.body.membershipsEnabled ?? null}, true),
            coalesce(${input.body.eventAccessEnabled ?? null}, true),
            coalesce(${input.body.mutualsEnabled ?? null}, true),
            coalesce(${input.body.safetyEnabled ?? null}, true),
            coalesce(${input.body.walletEnabled ?? null}, true),
            coalesce(${input.body.creatorSetupEnabled ?? null}, true),
            coalesce(${input.body.studioSetupEnabled ?? null}, true),
            coalesce(${input.body.pushEnabled ?? null}, false),
            now()
          )
          on conflict (user_id) do update
          set
            messages_enabled = coalesce(${input.body.messagesEnabled ?? null}, notification_preferences.messages_enabled),
            engagement_enabled = coalesce(${input.body.engagementEnabled ?? null}, notification_preferences.engagement_enabled),
            live_enabled = coalesce(${input.body.liveEnabled ?? null}, notification_preferences.live_enabled),
            payments_enabled = coalesce(${input.body.paymentsEnabled ?? null}, notification_preferences.payments_enabled),
            memberships_enabled = coalesce(${input.body.membershipsEnabled ?? null}, notification_preferences.memberships_enabled),
            event_access_enabled = coalesce(${input.body.eventAccessEnabled ?? null}, notification_preferences.event_access_enabled),
            mutuals_enabled = coalesce(${input.body.mutualsEnabled ?? null}, notification_preferences.mutuals_enabled),
            safety_enabled = coalesce(${input.body.safetyEnabled ?? null}, notification_preferences.safety_enabled),
            wallet_enabled = coalesce(${input.body.walletEnabled ?? null}, notification_preferences.wallet_enabled),
            creator_setup_enabled = coalesce(${input.body.creatorSetupEnabled ?? null}, notification_preferences.creator_setup_enabled),
            studio_setup_enabled = coalesce(${input.body.studioSetupEnabled ?? null}, notification_preferences.studio_setup_enabled),
            push_enabled = coalesce(${input.body.pushEnabled ?? null}, notification_preferences.push_enabled),
            updated_at = now()
          returning
          messages_enabled,
          engagement_enabled,
          live_enabled,
          payments_enabled,
          memberships_enabled,
          event_access_enabled,
          mutuals_enabled,
          safety_enabled,
          wallet_enabled,
          creator_setup_enabled,
          studio_setup_enabled,
          push_enabled,
          updated_at
        `;

        const response = toPreferences(rows[0]);
        await recordNotificationReceipt(
          transaction,
          actor,
          input.idempotencyKey,
          "notification.preferences.update",
          requestHash,
          response
        );
        return response;
      });
    },
    ...createNotificationDeviceRepositoryMethods(sql, encryptionKey),
    async close() {
      if (ownsClient) {
        await sql.end({ timeout: 5 });
      }
    }
  };
}

interface NotificationReceiptRow<T> {
  action: string;
  request_hash: string;
  response_body: T;
}

async function lockNotificationActor(
  transaction: import("postgres").TransactionSql,
  supabaseUserId: string
) {
  const rows = await transaction<{ id: string }[]>`
    select id from users where supabase_user_id = ${supabaseUserId} limit 1 for update
  `;
  return rows[0]?.id ?? null;
}

async function readNotificationReceipt<T>(
  transaction: import("postgres").TransactionSql,
  actorUserId: string,
  idempotencyKey: string
) {
  const rows = await transaction<NotificationReceiptRow<T>[]>`
    select action, request_hash, response_body
    from notification_action_receipts
    where actor_user_id = ${actorUserId} and idempotency_key = ${idempotencyKey}
    limit 1
  `;
  return rows[0] ?? null;
}

function assertNotificationReceipt<T>(
  receipt: NotificationReceiptRow<T>,
  action: string,
  requestHash: string
) {
  if (receipt.action !== action || receipt.request_hash !== requestHash) {
    throw new NotificationIdempotencyConflictError();
  }
}

async function recordNotificationReceipt(
  transaction: import("postgres").TransactionSql,
  actorUserId: string,
  idempotencyKey: string,
  action: string,
  requestHash: string,
  response: Notification | NotificationPreferences
) {
  await transaction`
    insert into notification_action_receipts (
      actor_user_id, idempotency_key, action, request_hash, response_body
    ) values (
      ${actorUserId}, ${idempotencyKey}, ${action}, ${requestHash}, ${transaction.json(response)}
    )
  `;
}

function hashNotificationAction(action: string, body: object) {
  const normalized = Object.fromEntries(Object.entries(body).sort(([left], [right]) => left.localeCompare(right)));
  return createHash("sha256").update(JSON.stringify({ action, body: normalized })).digest("hex");
}

function createUnavailableNotificationRepository(): NotificationRepository {
  return {
    async listNotifications() {
      throw new NotificationRepositoryConfigurationError();
    },
    async markRead() {
      throw new NotificationRepositoryConfigurationError();
    },
    async getPreferences() {
      throw new NotificationRepositoryConfigurationError();
    },
    async updatePreferences() {
      throw new NotificationRepositoryConfigurationError();
    },
    async registerDevice() {
      throw new NotificationRepositoryConfigurationError();
    },
    async deleteDevice() {
      throw new NotificationRepositoryConfigurationError();
    }
  };
}
