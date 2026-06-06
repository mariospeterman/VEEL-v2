drop index if exists notification_delivery_attempts_notification_idx;
drop index if exists notification_delivery_attempts_user_state_idx;
drop index if exists notification_delivery_attempts_state_next_idx;

drop table if exists notification_delivery_attempts;

drop type if exists notification_delivery_state;

alter table notification_devices
  drop column if exists auth_tag,
  drop column if exists auth_iv,
  drop column if exists auth_ciphertext,
  drop column if exists p256dh_tag,
  drop column if exists p256dh_iv,
  drop column if exists p256dh_ciphertext,
  drop column if exists endpoint_tag,
  drop column if exists endpoint_iv,
  drop column if exists endpoint_ciphertext;
