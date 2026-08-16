drop index if exists subscriptions_delegation_expiry_idx;
drop index if exists subscription_action_receipts_subscription_idx;
drop table if exists subscription_action_receipts;

alter table subscription_plans
  drop constraint if exists subscription_plans_split_amounts_check,
  add constraint subscription_plans_split_amounts_check
    check (
      creator_amount_atomic >= 0
      and platform_fee_amount_atomic >= 0
      and allocation_amount_atomic >= 0
      and creator_amount_atomic + platform_fee_amount_atomic + allocation_amount_atomic <= amount_atomic
    );

alter table subscription_collections
  drop column if exists allocation_receiver_wallet,
  drop column if exists platform_receiver_wallet,
  drop column if exists creator_receiver_wallet;

alter table subscription_authorization_intents
  drop column if exists delegation_expires_at,
  drop column if exists delegation_nonce,
  drop column if exists delegation_address,
  drop column if exists authority_address;

alter table subscriptions
  drop column if exists delegation_expires_at,
  drop column if exists delegation_nonce;

alter table subscription_plans
  drop column if exists benefits,
  drop column if exists description;
