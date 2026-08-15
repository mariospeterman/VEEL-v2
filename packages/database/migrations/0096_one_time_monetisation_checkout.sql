-- Launch 06: explicit checkout consent, canonical earnings setup, and Event Access reservations.

alter table payment_intents
  alter column withdrawal_waiver_accepted_at drop default,
  alter column withdrawal_waiver_accepted_at drop not null;

update payment_intents
set withdrawal_waiver_accepted_at = null
where withdrawal_waiver_accepted_at is not null;

update payment_confirmation_deliveries
set payload = jsonb_set(
  payload || jsonb_build_object('legacyConsentEvidence', 'review_required'),
  '{withdrawalWaiverAcceptedAt}',
  'null'::jsonb,
  true
)
where payload ? 'withdrawalWaiverAcceptedAt';

insert into support_cases (
  id, requester_user_id, subject_type, subject_id, category, state, priority, updated_at
)
select
  gen_random_uuid(), pi.user_id, 'payment', pi.id, 'payment',
  'pending_internal', 'standard', now()
from payment_intents pi
where pi.withdrawal_waiver_required
  and pi.state in ('transaction_requested', 'submitted')
  and not exists (
    select 1 from support_cases sc
    where sc.subject_type = 'payment'
      and sc.subject_id = pi.id
      and sc.state in ('open', 'pending_user', 'pending_internal')
  );

update payment_intents
set
  state = 'cancelled',
  failed_at = coalesce(failed_at, now()),
  failure_reason = 'explicit_checkout_consent_required_after_launch_06',
  updated_at = now()
where withdrawal_waiver_required
  and state in ('pending', 'transaction_requested', 'submitted');

create function private.enforce_explicit_checkout_consent()
returns trigger
language plpgsql
security invoker
set search_path = public, private
as $$
begin
  if new.state in ('confirmed', 'settled')
    and new.withdrawal_waiver_required
    and new.withdrawal_waiver_accepted_at is null then
    if tg_op = 'INSERT' or old.state not in ('confirmed', 'settled') then
      raise exception using
        errcode = '23514',
        message = 'explicit_checkout_consent_required';
    end if;
  end if;

  return new;
end;
$$;

create trigger payment_intents_explicit_checkout_consent
before insert or update on payment_intents
for each row execute function private.enforce_explicit_checkout_consent();

alter table creator_monetisation_settings
  add column earnings_terms_version text,
  add column earnings_terms_accepted_at timestamptz,
  add constraint creator_monetisation_settings_earnings_terms_version_check
    check (earnings_terms_version is null or earnings_terms_version = 'wevid-creator-earnings-v1'),
  add constraint creator_monetisation_settings_earnings_terms_pair_check
    check ((earnings_terms_version is null) = (earnings_terms_accepted_at is null));

update creator_monetisation_settings
set earning_state = 'not_configured', updated_at = now()
where earning_state = 'ready';

alter table creator_monetisation_settings
  add constraint creator_monetisation_settings_ready_terms_check
    check (
      earning_state <> 'ready'
      or (
        earnings_terms_version = 'wevid-creator-earnings-v1'
        and earnings_terms_accepted_at is not null
      )
    );

alter table wallets
  add constraint wallets_id_user_id_unique unique (id, user_id);

alter table creator_monetisation_settings
  add constraint creator_monetisation_settings_recipient_owner_fk
  foreign key (earnings_recipient_wallet_id, user_id)
  references wallets (id, user_id);

create table creator_onboarding_action_receipts (
  actor_user_id uuid not null references users(id),
  idempotency_key text not null,
  request_hash text not null,
  response_body jsonb not null,
  created_at timestamptz not null default now(),
  primary key (actor_user_id, idempotency_key)
);

alter table creator_onboarding_action_receipts enable row level security;
grant select on table creator_onboarding_action_receipts to authenticated;

create policy creator_onboarding_action_receipts_select_actor_or_staff
  on creator_onboarding_action_receipts for select to authenticated
  using (
    actor_user_id = (select private.current_app_user_id())
    or (select private.is_staff_member())
  );

alter table event_access_purchase_requests
  add column reserved_until timestamptz;

update event_access_purchase_requests eapr
set reserved_until = pi.expires_at
from payment_intents pi
where pi.id = eapr.payment_intent_id
  and eapr.state = 'pending_payment';

create index event_access_purchase_requests_active_reservation_idx
  on event_access_purchase_requests (access_pass_type_id, reserved_until)
  where state = 'pending_payment';

comment on column payment_intents.withdrawal_waiver_accepted_at is
  'Explicit buyer acknowledgement captured before a transaction-request capability is minted; null never means consent.';
comment on table creator_onboarding_action_receipts is
  'Exact replay boundary for canonical Enable Earnings configuration; contains no balances, custody, or payout state.';
comment on column event_access_purchase_requests.reserved_until is
  'Short-lived capacity reservation tied to the backend PaymentIntent expiry; invalid submissions never extend inventory.';
