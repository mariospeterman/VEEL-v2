-- Tip/support settlement accounting.
-- Confirmed tips and support create creator/platform ledger entries, never access grants.

create table payment_ledger_entries (
  id uuid primary key,
  payment_intent_id uuid not null references payment_intents(id),
  account_kind text not null,
  account_key text not null,
  account_user_id uuid references users(id),
  amount_minor bigint not null,
  currency text not null,
  direction text not null,
  state text not null default 'posted',
  created_at timestamptz not null default now(),
  unique (payment_intent_id, account_kind, account_key)
);

alter table payment_ledger_entries enable row level security;

create index payment_ledger_entries_intent_idx
  on payment_ledger_entries (payment_intent_id);

create index payment_ledger_entries_account_idx
  on payment_ledger_entries (account_kind, account_key, created_at desc);
