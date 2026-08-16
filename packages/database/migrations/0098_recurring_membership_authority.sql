-- Lock recurring memberships to the audited Solana recurring-delegation primitive.
-- WeVid owns plan policy, exact direct-recipient splits, collection evidence, and access state.

alter table subscription_plans
  add column description text,
  add column benefits text[] not null default '{}'::text[];

alter table subscriptions
  add column delegation_nonce bigint not null default 0 check (delegation_nonce >= 0),
  add column delegation_expires_at timestamptz;

alter table subscription_authorization_intents
  add column authority_address text,
  add column delegation_address text,
  add column delegation_nonce bigint not null default 0 check (delegation_nonce >= 0),
  add column delegation_expires_at timestamptz;

alter table subscription_collections
  add column creator_receiver_wallet text,
  add column platform_receiver_wallet text,
  add column allocation_receiver_wallet text;

update subscription_plans
set
  creator_amount_atomic = case when scope = 'creator' then amount_atomic else 0 end,
  platform_fee_amount_atomic = case when scope = 'platform' then amount_atomic else 0 end,
  allocation_amount_atomic = 0
where creator_amount_atomic + platform_fee_amount_atomic + allocation_amount_atomic <> amount_atomic;

alter table subscription_plans
  drop constraint subscription_plans_split_amounts_check,
  add constraint subscription_plans_split_amounts_check
    check (
      creator_amount_atomic >= 0
      and platform_fee_amount_atomic >= 0
      and allocation_amount_atomic >= 0
      and creator_amount_atomic + platform_fee_amount_atomic + allocation_amount_atomic = amount_atomic
    );

create table subscription_action_receipts (
  id uuid primary key,
  actor_user_id uuid not null references users(id),
  subscription_id uuid references subscriptions(id),
  action text not null check (action in ('cancel', 'revoke_submission', 'recover', 'offer_upsert', 'offer_disable')),
  idempotency_key text not null,
  request_hash text not null,
  response_body jsonb not null,
  created_at timestamptz not null default now(),
  unique (actor_user_id, action, idempotency_key)
);

create index subscription_action_receipts_subscription_idx
  on subscription_action_receipts (subscription_id, created_at desc)
  where subscription_id is not null;

create index subscriptions_delegation_expiry_idx
  on subscriptions (state, delegation_expires_at)
  where state in ('authorization_pending', 'active', 'renewal_pending', 'grace_period');

alter table subscription_action_receipts enable row level security;

revoke all on table subscription_action_receipts from anon, authenticated;
