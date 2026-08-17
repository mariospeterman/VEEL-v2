alter table payment_intents
  drop constraint if exists payment_intents_quote_window_check,
  drop constraint if exists payment_intents_referral_share_bps_check,
  drop constraint if exists payment_intents_platform_fee_bps_check,
  drop constraint if exists payment_intents_minimum_amount_check,
  drop constraint if exists payment_intents_commercial_policy_revision_check,
  drop constraint if exists payment_intents_commercial_policy_source_check,
  drop column if exists quoted_at,
  drop column if exists referral_share_of_platform_fee_bps,
  drop column if exists platform_fee_bps,
  drop column if exists minimum_amount_minor,
  drop column if exists commercial_policy_revision,
  drop column if exists commercial_policy_override_id,
  drop column if exists commercial_policy_source;

drop policy if exists payment_commercial_policy_overrides_select_staff
  on payment_commercial_policy_overrides;
drop index if exists payment_commercial_policy_overrides_updated_at_idx;
drop table if exists payment_commercial_policy_overrides;
