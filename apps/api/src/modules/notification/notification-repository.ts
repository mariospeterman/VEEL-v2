import { parseAes256GcmKey } from "@veel/config";
import postgres from "postgres";
import { createNotificationDeviceRepositoryMethods } from "./notification-device-repository.js";
import { NotificationRepositoryConfigurationError } from "./notification-errors.js";
import { toNotification, toNotificationPage, toPreferences } from "./notification-repository-mappers.js";
import type { NotificationRow, PreferenceRow } from "./notification-repository-rows.js";
import type { NotificationRepository } from "./types.js";

export { NotificationRepositoryConfigurationError } from "./notification-errors.js";

interface NotificationRepositoryOptions {
  encryptionKey?: string | undefined;
}

export function createPostgresNotificationRepository(
  databaseUrl?: string,
  options: NotificationRepositoryOptions = {}
): NotificationRepository {
  if (!databaseUrl) {
    return createUnavailableNotificationRepository();
  }

  const sql = postgres(databaseUrl, {
    max: 5,
    idle_timeout: 20,
    prepare: false
  });
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
      const rows = await sql<NotificationRow[]>`
        with target_user as (
          select id
          from users
          where supabase_user_id = ${input.supabaseUserId}
          limit 1
        ),
        updated as (
          update notifications n
          set state = 'read', read_at = coalesce(n.read_at, now())
          from target_user tu
          where n.id = ${input.notificationId}
            and n.user_id = tu.id
          returning n.id, n.kind, n.title, n.body, n.action_url, n.state, n.related_resource_type, n.related_resource_id::text as related_resource_id, n.created_at, n.read_at
        )
        select * from updated
      `;

      const row = rows[0];
      return row ? toNotification(row) : null;
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
      const rows = await sql<PreferenceRow[]>`
        with target_user as (
          select id
          from users
          where supabase_user_id = ${input.supabaseUserId}
          limit 1
        ),
        upserted as (
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
          select
            target_user.id,
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
          from target_user
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
        from upserted
      `;

      return toPreferences(rows[0]);
    },
    ...createNotificationDeviceRepositoryMethods(sql, encryptionKey),
    async close() {
      await sql.end({ timeout: 5 });
    }
  };
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
