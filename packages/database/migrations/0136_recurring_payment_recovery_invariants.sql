-- Retained recurring-payment invariants. Recurring sales remain disabled until
-- provider approval and release-bound chain evidence are complete.
--
-- This migration deliberately does not infer acceptance for historical rows.
-- A subscription without an immutable acceptance cannot be collected.

alter table subscription_plans
  add column asset_decimals smallint not null default 6
    check (asset_decimals between 0 and 18),
  add column price_minor bigint generated always as (
    case
      -- Legacy platform seeds stored USDC atomic units in amount_minor. Preserve
      -- that historical field verbatim and expose a distinct canonical minor-unit
      -- value for future consent, receipts, and presentation.
      when id in ('platform_plus_monthly', 'platform_ultra_monthly', 'platform_studio_monthly')
        and currency = 'USDC'
        and amount_minor = amount_atomic
        and amount_atomic in (8990000, 15000000, 17990000, 29000000)
        then amount_atomic / 10000
      else amount_minor
    end
  ) stored;

alter table subscription_plans
  add constraint subscription_plans_price_minor_check check (price_minor > 0);

comment on column subscription_plans.amount_minor is
  'Legacy mixed-unit field retained for historical fidelity. New recurring consent and presentation use price_minor.';

comment on column subscription_plans.price_minor is
  'Canonical two-decimal price minor units; exact legacy platform seed atomics are projected without rewriting history.';

create table subscription_billing_acceptances (
  subscription_id uuid primary key references subscriptions(id),
  authorization_intent_id uuid not null unique references subscription_authorization_intents(id),
  accepted_by_user_id uuid not null references users(id),
  plan_id text not null references subscription_plans(id),
  scope text not null check (scope in ('platform', 'creator')),
  creator_user_id uuid references users(id),
  terms_version text not null check (length(trim(terms_version)) between 1 and 80),
  withdrawal_waiver_version text not null
    check (length(trim(withdrawal_waiver_version)) between 1 and 80),
  immediate_access_acknowledged boolean not null check (immediate_access_acknowledged),
  consent_request_hash text not null,
  amount_minor bigint not null check (amount_minor > 0),
  amount_atomic bigint not null check (amount_atomic > 0),
  asset_decimals smallint not null check (asset_decimals = 6),
  currency text not null check (currency = 'USDC'),
  solana_network text not null check (solana_network in ('devnet', 'mainnet-beta')),
  token_mint text not null,
  token_program text not null check (token_program in ('spl_token', 'token_2022')),
  provider text not null check (provider = 'official_solana_subscription_program'),
  program_id text not null,
  plan_pda text,
  period_days integer not null check (period_days between 1 and 366),
  period_seconds integer not null check (period_seconds = period_days * 86400),
  creator_amount_atomic bigint not null check (creator_amount_atomic >= 0),
  platform_amount_atomic bigint not null check (platform_amount_atomic >= 0),
  allocation_amount_atomic bigint not null default 0 check (allocation_amount_atomic = 0),
  creator_receiver_wallet text,
  platform_receiver_wallet text not null,
  allocation_receiver_wallet text,
  collector_address text not null,
  merchant_wallet text,
  delegation_nonce bigint not null check (delegation_nonce > 0),
  immutable_hash text not null unique,
  accepted_at timestamptz not null default now(),
  check (
    creator_amount_atomic + platform_amount_atomic + allocation_amount_atomic = amount_atomic
  ),
  check (amount_atomic::numeric = amount_minor::numeric * 10000),
  check (
    (scope = 'creator' and creator_user_id is not null and creator_receiver_wallet is not null)
    or
    (scope = 'platform' and creator_user_id is null and creator_amount_atomic = 0)
  ),
  check (allocation_receiver_wallet is null)
);

comment on table subscription_billing_acceptances is
  'Immutable explicit recurring terms and exact asset/split snapshot. Historical subscriptions are never backfilled from mutable plans.';

create function private.prevent_subscription_billing_acceptance_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'subscription billing acceptances are immutable'
    using errcode = '55000';
end;
$$;

create trigger subscription_billing_acceptances_immutable
before update or delete on subscription_billing_acceptances
for each row execute function private.prevent_subscription_billing_acceptance_mutation();

alter table subscription_collections
  drop constraint subscription_collections_state_check;

alter table subscription_collections
  add constraint subscription_collections_state_check check (
    state in (
      'due',
      'processing',
      'reconciling',
      'confirmed',
      'failed',
      'dead_letter',
      'skipped',
      'cancelled'
    )
  ),
  add column broadcast_started_at timestamptz,
  add column broadcast_lease_token uuid,
  add column broadcast_signature text,
  add column broadcast_transaction_base64 text,
  add column broadcast_blockhash text,
  add column broadcast_last_valid_block_height bigint,
  add column broadcast_prepared_at timestamptz,
  add constraint subscription_collections_broadcast_evidence_check check (
    (
      broadcast_signature is null
      and broadcast_transaction_base64 is null
      and broadcast_blockhash is null
      and broadcast_last_valid_block_height is null
      and broadcast_prepared_at is null
    )
    or
    (
      broadcast_started_at is not null
      and broadcast_lease_token is not null
      and broadcast_signature is not null
      and broadcast_transaction_base64 is not null
      and broadcast_blockhash is not null
      and broadcast_last_valid_block_height is not null
      and broadcast_prepared_at is not null
    )
  ),
  add constraint subscription_collections_signed_state_check check (
    broadcast_signature is null or state in ('processing', 'reconciling', 'confirmed')
  );

create unique index subscription_collections_broadcast_signature_uidx
  on subscription_collections (broadcast_signature)
  where broadcast_signature is not null;

-- Durable nonce namespace for the exact official recurring-delegation PDA seeds.
-- Zero is retained only for historical records that cannot be asserted as accepted.
create unique index subscriptions_recurring_delegation_nonce_uidx
  on subscriptions (subscriber_wallet, token_mint, collector_address, delegation_nonce)
  where renewal_mode = 'delegated_solana_subscription'
    and subscriber_wallet is not null
    and token_mint is not null
    and collector_address is not null
    and delegation_nonce > 0;

-- Existing logical-period uniqueness is retained and made explicit for recovery
-- selectors. Signature indexes support exact reconciliation, not history scans.
create index subscriptions_recurring_due_selector_idx
  on subscriptions (next_collection_at, id)
  where state in ('active', 'renewal_pending', 'grace_period')
    and renewal_mode = 'delegated_solana_subscription'
    and cancel_at_period_end = false;

create index subscription_authorization_intents_reconciliation_selector_idx
  on subscription_authorization_intents (submitted_at, id)
  where state = 'submitted' and submitted_signature is not null;

create index subscription_collections_recovery_selector_idx
  on subscription_collections (next_attempt_at, leased_until, id)
  where state in ('due', 'processing', 'reconciling', 'failed');

-- Authorization creation uses the same durable actor/action/key receipt authority
-- as every other subscription command. The transaction-scoped advisory lock in
-- the repository serializes a racing first claim; this unique key is the durable
-- database backstop.
alter table subscription_action_receipts
  drop constraint subscription_action_receipts_action_check,
  add constraint subscription_action_receipts_action_check check (
    action in (
      'authorization_intent_create',
      'cancel',
      'revoke_submission',
      'revoke_subscription',
      'recover',
      'offer_upsert',
      'offer_disable'
    )
  );

alter table receipts
  add column subscription_collection_id uuid references subscription_collections(id);

create unique index receipts_subscription_collection_uidx
  on receipts (subscription_collection_id)
  where subscription_collection_id is not null;

alter table wallet_transaction_records
  add column subscription_collection_id uuid references subscription_collections(id);

create unique index wallet_transaction_records_subscription_collection_uidx
  on wallet_transaction_records (subscription_collection_id)
  where subscription_collection_id is not null;

alter table compliance_ledger_entries
  add column subscription_collection_id uuid references subscription_collections(id);

create unique index compliance_ledger_entries_subscription_collection_uidx
  on compliance_ledger_entries (subscription_collection_id)
  where subscription_collection_id is not null;

create table subscription_finance_outbox_events (
  id uuid primary key,
  subscription_collection_id uuid not null unique references subscription_collections(id),
  event_type text not null check (event_type = 'subscription_collection_confirmed'),
  state text not null default 'queued'
    check (state in ('queued', 'processing', 'delivered', 'failed', 'dead_letter')),
  amount_minor bigint not null check (amount_minor > 0),
  amount_atomic bigint not null check (amount_atomic > 0),
  asset_decimals smallint not null check (asset_decimals between 0 and 18),
  currency text not null check (currency = 'USDC'),
  collection_signature text not null,
  terms_version text not null,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  lease_token uuid,
  leased_until timestamptz,
  next_attempt_at timestamptz not null default now(),
  delivered_at timestamptz,
  failure_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table subscription_finance_outbox_events is
  'Delivery-only handoff queue. It is not payment, entitlement, reporting, or bookkeeping truth.';

create index subscription_finance_outbox_events_due_idx
  on subscription_finance_outbox_events (next_attempt_at, leased_until, id)
  where state in ('queued', 'processing', 'failed');

alter table subscription_billing_acceptances enable row level security;
alter table subscription_finance_outbox_events enable row level security;

revoke all on table subscription_billing_acceptances from public, anon, authenticated;
revoke all on table subscription_finance_outbox_events from public, anon, authenticated;
