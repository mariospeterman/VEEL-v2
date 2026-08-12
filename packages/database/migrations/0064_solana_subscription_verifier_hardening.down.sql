drop index if exists subscriptions_status_expires_idx;
drop index if exists subscriptions_creator_status_idx;
drop index if exists subscriptions_user_plan_status_idx;
drop index if exists subscription_plans_provider_status_idx;
drop index if exists subscription_collections_idempotency_uidx;
drop index if exists subscription_collections_signature_uidx;
drop index if exists subscription_authorization_intents_submitted_signature_uidx;
drop index if exists subscription_authorization_intents_verified_signature_uidx;

alter table subscription_collections
  drop constraint if exists subscription_collections_amount_atomic_check,
  drop column if exists attempted_at,
  drop column if exists idempotency_key,
  drop column if exists receiver_token_account,
  drop column if exists receiver_wallet,
  drop column if exists collector_wallet,
  drop column if exists allocation_amount_atomic,
  drop column if exists platform_fee_amount_atomic,
  drop column if exists creator_amount_atomic,
  drop column if exists amount_atomic;

alter table subscription_authorization_intents
  drop column if exists failure_reason,
  drop column if exists subscription_pda,
  drop column if exists subscription_authority_pda,
  drop column if exists token_mint,
  drop column if exists subscriber_token_account,
  drop column if exists subscriber_wallet,
  drop column if exists program_id,
  drop column if exists provider;

alter table subscriptions
  drop constraint if exists subscriptions_amount_period_check,
  drop constraint if exists subscriptions_token_only_check,
  drop constraint if exists subscriptions_provider_check,
  drop column if exists merchant_wallet,
  drop column if exists plan_pda,
  drop column if exists failure_reason,
  drop column if exists verified_at,
  drop column if exists verified_signature,
  drop column if exists setup_signature,
  drop column if exists expires_at,
  drop column if exists start_at,
  drop column if exists period_seconds,
  drop column if exists amount_atomic,
  drop column if exists program_id,
  drop column if exists provider,
  drop column if exists subscription_pda,
  drop column if exists subscription_authority_pda,
  drop column if exists token_mint,
  drop column if exists user_token_account,
  drop column if exists subscriber_wallet;

alter table subscription_plans
  drop constraint if exists subscription_plans_onchain_active_check,
  drop constraint if exists subscription_plans_split_amounts_check,
  drop constraint if exists subscription_plans_amount_atomic_check,
  drop constraint if exists subscription_plans_token_only_check,
  drop constraint if exists subscription_plans_provider_check,
  drop constraint if exists subscription_plans_provider_state_check,
  add constraint subscription_plans_provider_state_check
    check (provider_state in ('fallback_active', 'staging_required', 'disabled')),
  drop column if exists metadata_uri,
  drop column if exists allocation_amount_atomic,
  drop column if exists platform_fee_amount_atomic,
  drop column if exists creator_amount_atomic,
  drop column if exists period_seconds,
  drop column if exists amount_atomic,
  drop column if exists merchant_wallet,
  drop column if exists onchain_plan_id,
  drop column if exists plan_pda,
  drop column if exists program_id,
  drop column if exists provider;
