do $$
begin
  if exists (select 1 from subscription_billing_acceptances)
    or exists (
      select 1 from subscription_action_receipts
      where action = 'authorization_intent_create'
    )
    or exists (select 1 from subscription_finance_outbox_events)
    or exists (
      select 1 from subscription_collections
      where broadcast_started_at is not null or broadcast_signature is not null
    )
    or exists (select 1 from receipts where subscription_collection_id is not null)
    or exists (select 1 from wallet_transaction_records where subscription_collection_id is not null)
    or exists (select 1 from compliance_ledger_entries where subscription_collection_id is not null)
  then
    raise exception
      '0136 rollback refused because recurring idempotency, acceptance, broadcast, or finance evidence exists'
      using errcode = '55000';
  end if;
end
$$;

drop table if exists subscription_finance_outbox_events;

drop index if exists compliance_ledger_entries_subscription_collection_uidx;
alter table compliance_ledger_entries drop column if exists subscription_collection_id;

drop index if exists wallet_transaction_records_subscription_collection_uidx;
alter table wallet_transaction_records drop column if exists subscription_collection_id;

drop index if exists receipts_subscription_collection_uidx;
alter table receipts drop column if exists subscription_collection_id;

drop index if exists subscription_collections_recovery_selector_idx;
drop index if exists subscription_authorization_intents_reconciliation_selector_idx;
drop index if exists subscriptions_recurring_due_selector_idx;
drop index if exists subscriptions_recurring_delegation_nonce_uidx;
drop index if exists subscription_collections_broadcast_signature_uidx;

alter table subscription_action_receipts
  drop constraint if exists subscription_action_receipts_action_check,
  add constraint subscription_action_receipts_action_check check (
    action in ('cancel', 'revoke_submission', 'recover', 'offer_upsert', 'offer_disable')
  );

alter table subscription_collections
  drop constraint if exists subscription_collections_broadcast_evidence_check,
  drop constraint if exists subscription_collections_signed_state_check,
  drop column if exists broadcast_prepared_at,
  drop column if exists broadcast_last_valid_block_height,
  drop column if exists broadcast_blockhash,
  drop column if exists broadcast_transaction_base64,
  drop column if exists broadcast_signature,
  drop column if exists broadcast_lease_token,
  drop column if exists broadcast_started_at;

alter table subscription_collections
  drop constraint if exists subscription_collections_state_check,
  add constraint subscription_collections_state_check check (
    state in ('due', 'processing', 'confirmed', 'failed', 'dead_letter', 'skipped', 'cancelled')
  );

drop trigger if exists subscription_billing_acceptances_immutable
  on subscription_billing_acceptances;
drop function if exists private.prevent_subscription_billing_acceptance_mutation();
drop table if exists subscription_billing_acceptances;

alter table subscription_plans
  drop constraint if exists subscription_plans_price_minor_check,
  drop column if exists price_minor,
  drop column if exists asset_decimals;
