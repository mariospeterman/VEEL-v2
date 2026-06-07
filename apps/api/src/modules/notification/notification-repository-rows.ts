import type { Notification, NotificationDevice } from "./types.js";

export interface NotificationRow {
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

export interface PreferenceRow {
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

export interface DeviceRow {
  id: string;
  provider: NotificationDevice["provider"];
  platform: NotificationDevice["platform"];
  state: NotificationDevice["state"];
  created_at: Date;
  last_seen_at: Date | null;
}
