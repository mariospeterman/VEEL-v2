import { createHash, randomUUID } from "node:crypto";
import postgres from "postgres";
import type {
  Notification,
  NotificationDevice,
  NotificationPage,
  NotificationPreferences,
  NotificationRepository
} from "./types.js";

export class NotificationRepositoryConfigurationError extends Error {
  constructor() {
    super("DATABASE_URL_NOT_CONFIGURED");
    this.name = "NotificationRepositoryConfigurationError";
  }
}

interface NotificationRow {
  id: string;
  kind: Notification["kind"];
  title: string;
  body: string | null;
  action_url: string | null;
  state: Notification["state"];
  related_resource_type: NonNullable<Notification["relatedResource"]>["type"] | null;
  related_resource_id: string | null;
  created_at: Date;
  read_at: Date | null;
}

interface PreferenceRow {
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
  push_enabled: boolean;
  updated_at: Date;
}

interface DeviceRow {
  id: string;
  provider: NotificationDevice["provider"];
  platform: NotificationDevice["platform"];
  state: NotificationDevice["state"];
  created_at: Date;
  last_seen_at: Date | null;
}

export function createPostgresNotificationRepository(databaseUrl?: string): NotificationRepository {
  if (!databaseUrl) {
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

  const sql = postgres(databaseUrl, {
    max: 5,
    idle_timeout: 20,
    prepare: false
  });

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
    async registerDevice(input) {
      const endpointHash = sha256(input.body.endpoint);
      const p256dhHash = sha256(input.body.p256dh);
      const authHash = sha256(input.body.auth);
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
    },
    async close() {
      await sql.end({ timeout: 5 });
    }
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function toNotificationPage(rows: NotificationRow[], limit: number): NotificationPage {
  const pageRows = rows.slice(0, limit);
  const extraRow = rows[limit];

  return {
    items: pageRows.map(toNotification),
    nextCursor: extraRow ? extraRow.created_at.toISOString() : null
  };
}

function toNotification(row: NotificationRow): Notification {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    actionUrl: row.action_url,
    state: row.state,
    relatedResource: row.related_resource_type
      ? {
          type: row.related_resource_type,
          id: row.related_resource_id
        }
      : null,
    createdAt: row.created_at.toISOString(),
    readAt: row.read_at?.toISOString() ?? null
  };
}

function toPreferences(row: PreferenceRow | undefined): NotificationPreferences {
  return {
    messagesEnabled: row?.messages_enabled ?? true,
    engagementEnabled: row?.engagement_enabled ?? true,
    liveEnabled: row?.live_enabled ?? true,
    paymentsEnabled: row?.payments_enabled ?? true,
    membershipsEnabled: row?.memberships_enabled ?? true,
    eventAccessEnabled: row?.event_access_enabled ?? true,
    mutualsEnabled: row?.mutuals_enabled ?? true,
    safetyEnabled: row?.safety_enabled ?? true,
    walletEnabled: row?.wallet_enabled ?? true,
    creatorSetupEnabled: row?.creator_setup_enabled ?? true,
    studioSetupEnabled: row?.studio_setup_enabled ?? true,
    pushEnabled: row?.push_enabled ?? false,
    updatedAt: row?.updated_at.toISOString() ?? null
  };
}

function toDevice(row: DeviceRow): NotificationDevice {
  return {
    id: row.id,
    provider: row.provider,
    platform: row.platform,
    state: row.state,
    createdAt: row.created_at.toISOString(),
    lastSeenAt: row.last_seen_at?.toISOString() ?? null
  };
}
