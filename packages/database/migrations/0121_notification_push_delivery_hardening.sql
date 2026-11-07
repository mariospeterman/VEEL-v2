-- Bind every push attempt to one account and one browser-subscription
-- generation.  Push payloads are refresh hints only; Fastify remains the
-- authority for the notification content shown after the app opens.

alter table notification_devices
  add column subscription_generation bigint not null default 1
    check (subscription_generation > 0);

alter table notification_delivery_attempts
  add column device_subscription_generation bigint,
  add column dispatch_started_at timestamptz;

-- A legacy endpoint could have been reassigned without changing device_id.
-- Such work must never be dispatched under the current subscription.
update notification_delivery_attempts attempt
set
  state = 'skipped',
  failure_code = 'push_device_owner_mismatch_at_upgrade',
  lease_token = null,
  leased_until = null,
  updated_at = now()
from notification_devices device, notifications notification
where device.id = attempt.device_id
  and notification.id = attempt.notification_id
  and (
    attempt.user_id <> device.user_id
    or attempt.user_id <> notification.user_id
  )
  and attempt.state in ('queued', 'leased', 'failed');

update notification_delivery_attempts attempt
set device_subscription_generation = device.subscription_generation
from notification_devices device
where device.id = attempt.device_id
  and attempt.device_subscription_generation is null;

alter table notification_delivery_attempts
  alter column device_subscription_generation set not null,
  drop constraint notification_delivery_attempts_notification_id_device_id_key,
  add constraint notification_delivery_attempts_notification_device_generation_key
    unique (notification_id, device_id, device_subscription_generation);

create index notification_delivery_attempts_device_generation_state_idx
  on notification_delivery_attempts (device_id, device_subscription_generation, state);

alter table notification_action_receipts
  drop constraint notification_action_receipts_action_check,
  add constraint notification_action_receipts_action_check check (
    action in (
      'notification.read',
      'notification.preferences.update',
      'notification.device.register',
      'notification.device.revoke'
    )
  );

comment on column notification_devices.subscription_generation is
  'Monotonic fence incremented when endpoint ownership, keys, or active lifecycle changes.';

comment on column notification_delivery_attempts.dispatch_started_at is
  'Linearization point after final owner, generation, preference, unread-state, and key checks and before bounded transport.';
