do $$
begin
  if exists (select 1 from creator_onboarding_action_receipts)
    or exists (
      select 1
      from creator_monetisation_settings
      where earnings_terms_accepted_at is not null
    )
    or exists (
      select 1
      from event_access_purchase_requests
      where reserved_until is not null
    )
    or exists (
      select 1
      from payment_intents
      where withdrawal_waiver_accepted_at is null
    ) then
    raise exception '0096 rollback refused: Launch 06 consent, earnings, or reservation facts exist';
  end if;
end $$;

drop index if exists event_access_purchase_requests_active_reservation_idx;

alter table event_access_purchase_requests
  drop column if exists reserved_until;

drop policy if exists creator_onboarding_action_receipts_select_actor_or_staff
  on creator_onboarding_action_receipts;
revoke select on table creator_onboarding_action_receipts from authenticated;
drop table creator_onboarding_action_receipts;

alter table creator_monetisation_settings
  drop constraint if exists creator_monetisation_settings_ready_terms_check;

alter table creator_monetisation_settings
  drop constraint if exists creator_monetisation_settings_recipient_owner_fk;

alter table wallets
  drop constraint if exists wallets_id_user_id_unique;

alter table creator_monetisation_settings
  drop column if exists earnings_terms_accepted_at,
  drop column if exists earnings_terms_version;

drop trigger if exists payment_intents_explicit_checkout_consent on payment_intents;
drop function if exists private.enforce_explicit_checkout_consent();

alter table payment_intents
  alter column withdrawal_waiver_accepted_at set default now(),
  alter column withdrawal_waiver_accepted_at set not null;
