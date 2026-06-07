import type {
  Notification,
  NotificationDevice,
  NotificationPage,
  NotificationPreferences
} from "./types.js";
import type { DeviceRow, NotificationRow, PreferenceRow } from "./notification-repository-rows.js";

export function toNotificationPage(rows: NotificationRow[], limit: number): NotificationPage {
  const pageRows = rows.slice(0, limit);
  const extraRow = rows[limit];

  return {
    items: pageRows.map(toNotification),
    nextCursor: extraRow ? extraRow.created_at.toISOString() : null
  };
}

export function toNotification(row: NotificationRow): Notification {
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

export function toPreferences(row: PreferenceRow | undefined): NotificationPreferences {
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

export function toDevice(row: DeviceRow): NotificationDevice {
  return {
    id: row.id,
    provider: row.provider,
    platform: row.platform,
    state: row.state,
    createdAt: row.created_at.toISOString(),
    lastSeenAt: row.last_seen_at?.toISOString() ?? null
  };
}
