-- Durable payment confirmation evidence for instant digital access.
-- This records receipt and delivery status only; it does not custody funds or execute refunds.

create unique index receipts_payment_intent_id_uidx
  on receipts (payment_intent_id)
  where payment_intent_id is not null;

create table payment_confirmation_deliveries (
  id uuid primary key,
  payment_intent_id uuid not null references payment_intents(id),
  receipt_id uuid references receipts(id),
  user_id uuid not null references users(id),
  channel text not null check (channel in ('in_app', 'email')),
  state text not null default 'queued'
    check (state in ('queued', 'sent', 'provider_not_configured', 'failed')),
  durable_medium boolean not null default true,
  confirmation_version text not null default 'payment-confirmation-v1',
  terms_version text not null,
  withdrawal_waiver_version text not null,
  payload jsonb not null default '{}'::jsonb,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (payment_intent_id, channel)
);

create index payment_confirmation_deliveries_user_created_idx
  on payment_confirmation_deliveries (user_id, created_at desc);

create index payment_confirmation_deliveries_state_created_idx
  on payment_confirmation_deliveries (state, created_at desc);

alter table payment_confirmation_deliveries enable row level security;

grant select on table payment_confirmation_deliveries to authenticated;

create policy payment_confirmation_deliveries_select_self_or_staff
  on payment_confirmation_deliveries for select to authenticated
  using (user_id = (select private.current_app_user_id()) or (select private.is_staff_member()));
