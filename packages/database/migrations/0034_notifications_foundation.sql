-- Notification projections and PWA push device registry.
-- Notifications are delivery/read models only; they never grant access or prove payment.

create type notification_kind as enum (
  'message',
  'engagement',
  'live',
  'payment',
  'membership',
  'event_access',
  'mutuals',
  'safety',
  'wallet_action_required',
  'creator_setup',
  'studio_setup',
  'admin_issue',
  'provider_incident'
);

create type notification_state as enum (
  'unread',
  'read',
  'archived'
);

create type notification_device_provider as enum (
  'web_push'
);

create type notification_device_platform as enum (
  'desktop',
  'ios',
  'android',
  'mobile_web'
);

create type notification_device_state as enum (
  'active',
  'revoked'
);

create table notifications (
  id uuid primary key,
  user_id uuid not null references users(id),
  kind notification_kind not null,
  title text not null,
  body text,
  action_url text,
  state notification_state not null default 'unread',
  related_resource_type text,
  related_resource_id uuid,
  idempotency_key text,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  unique (user_id, idempotency_key)
);

create table notification_preferences (
  user_id uuid primary key references users(id),
  messages_enabled boolean not null default true,
  engagement_enabled boolean not null default true,
  live_enabled boolean not null default true,
  payments_enabled boolean not null default true,
  memberships_enabled boolean not null default true,
  event_access_enabled boolean not null default true,
  mutuals_enabled boolean not null default true,
  safety_enabled boolean not null default true,
  wallet_enabled boolean not null default true,
  creator_setup_enabled boolean not null default true,
  studio_setup_enabled boolean not null default true,
  push_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

create table notification_devices (
  id uuid primary key,
  user_id uuid not null references users(id),
  provider notification_device_provider not null,
  platform notification_device_platform not null,
  endpoint_hash text not null,
  p256dh_hash text not null,
  auth_hash text not null,
  user_agent text,
  state notification_device_state not null default 'active',
  last_seen_at timestamptz,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, endpoint_hash),
  unique (user_id, idempotency_key)
);

create index notifications_user_state_created_idx
  on notifications (user_id, state, created_at desc);

create index notifications_user_created_idx
  on notifications (user_id, created_at desc);

create index notification_devices_user_state_idx
  on notification_devices (user_id, state, created_at desc);

alter table notifications enable row level security;
alter table notification_preferences enable row level security;
alter table notification_devices enable row level security;

grant select, update on table notifications to authenticated;
grant select, insert, update on table notification_preferences to authenticated;
grant select, insert, update, delete on table notification_devices to authenticated;

create policy notifications_select_self_or_staff
  on notifications for select to authenticated
  using (user_id = (select private.current_app_user_id()) or (select private.is_staff_member()));

create policy notifications_update_self_read_state
  on notifications for update to authenticated
  using (user_id = (select private.current_app_user_id()) or (select private.is_staff_member()))
  with check (user_id = (select private.current_app_user_id()) or (select private.is_staff_member()));

create policy notification_preferences_select_self_or_staff
  on notification_preferences for select to authenticated
  using (user_id = (select private.current_app_user_id()) or (select private.is_staff_member()));

create policy notification_preferences_insert_self
  on notification_preferences for insert to authenticated
  with check (user_id = (select private.current_app_user_id()));

create policy notification_preferences_update_self_or_staff
  on notification_preferences for update to authenticated
  using (user_id = (select private.current_app_user_id()) or (select private.is_staff_member()))
  with check (user_id = (select private.current_app_user_id()) or (select private.is_staff_member()));

create policy notification_devices_select_self_or_staff
  on notification_devices for select to authenticated
  using (user_id = (select private.current_app_user_id()) or (select private.is_staff_member()));

create policy notification_devices_insert_self
  on notification_devices for insert to authenticated
  with check (user_id = (select private.current_app_user_id()));

create policy notification_devices_update_self_or_staff
  on notification_devices for update to authenticated
  using (user_id = (select private.current_app_user_id()) or (select private.is_staff_member()))
  with check (user_id = (select private.current_app_user_id()) or (select private.is_staff_member()));

create policy notification_devices_delete_self_or_staff
  on notification_devices for delete to authenticated
  using (user_id = (select private.current_app_user_id()) or (select private.is_staff_member()));
