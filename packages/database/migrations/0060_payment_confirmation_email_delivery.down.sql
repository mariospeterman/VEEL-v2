drop index if exists payment_confirmation_deliveries_provider_message_id_idx;

alter table payment_confirmation_deliveries
  drop column if exists provider_message_id,
  drop column if exists failure_code,
  drop column if exists leased_at,
  drop column if exists attempt_count;

alter table payment_confirmation_deliveries
  drop constraint payment_confirmation_deliveries_state_check;

alter table payment_confirmation_deliveries
  add constraint payment_confirmation_deliveries_state_check
  check (state in ('queued', 'sent', 'provider_not_configured', 'failed'));
