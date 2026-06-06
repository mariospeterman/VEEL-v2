drop policy if exists notification_devices_delete_self_or_staff on notification_devices;
drop policy if exists notification_devices_update_self_or_staff on notification_devices;
drop policy if exists notification_devices_insert_self on notification_devices;
drop policy if exists notification_devices_select_self_or_staff on notification_devices;
drop policy if exists notification_preferences_update_self_or_staff on notification_preferences;
drop policy if exists notification_preferences_insert_self on notification_preferences;
drop policy if exists notification_preferences_select_self_or_staff on notification_preferences;
drop policy if exists notifications_update_self_read_state on notifications;
drop policy if exists notifications_select_self_or_staff on notifications;

revoke select, insert, update, delete on table notification_devices from authenticated;
revoke select, insert, update on table notification_preferences from authenticated;
revoke select, update on table notifications from authenticated;

drop index if exists notification_devices_user_state_idx;
drop index if exists notifications_user_created_idx;
drop index if exists notifications_user_state_created_idx;

drop table if exists notification_devices;
drop table if exists notification_preferences;
drop table if exists notifications;

drop type if exists notification_device_state;
drop type if exists notification_device_platform;
drop type if exists notification_device_provider;
drop type if exists notification_state;
drop type if exists notification_kind;
