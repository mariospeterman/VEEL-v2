-- A code rollback cannot represent multiple subscription generations or
-- durable device-action receipts.  Refuse instead of silently weakening the
-- owner/outcome fence.
do $$
begin
  if exists (
    select 1 from notification_devices where subscription_generation <> 1
  ) or exists (
    select 1 from notification_delivery_attempts where dispatch_started_at is not null
  ) or exists (
    select 1
    from notification_action_receipts
    where action in ('notification.device.register', 'notification.device.revoke')
  ) or exists (
    select 1
    from notification_delivery_attempts
    group by notification_id, device_id
    having count(*) > 1
  ) then
    raise exception using
      errcode = '55000',
      message = '0121 rollback refused because subscription-generation delivery state exists';
  end if;
end
$$;

alter table notification_action_receipts
  drop constraint notification_action_receipts_action_check,
  add constraint notification_action_receipts_action_check check (
    action in ('notification.read', 'notification.preferences.update')
  );

drop index if exists notification_delivery_attempts_device_generation_state_idx;

alter table notification_delivery_attempts
  drop constraint notification_delivery_attempts_notification_device_generation_key,
  add constraint notification_delivery_attempts_notification_id_device_id_key
    unique (notification_id, device_id),
  drop column dispatch_started_at,
  drop column device_subscription_generation;

alter table notification_devices
  drop column subscription_generation;
