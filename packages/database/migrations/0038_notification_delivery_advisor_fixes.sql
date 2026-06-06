-- Advisor fixes for notification delivery attempts.
-- Staff policy removes the RLS-with-no-policy warning; no anon/authenticated grants are added.

create index notification_delivery_attempts_device_idx
  on notification_delivery_attempts (device_id);

create policy notification_delivery_attempts_select_staff
  on notification_delivery_attempts for select to authenticated
  using ((select private.is_staff_member()));
