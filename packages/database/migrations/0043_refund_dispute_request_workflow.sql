-- Refund/dispute request and review workflow.
-- This records request/review/access-policy state only. It does not execute refunds,
-- custody funds, create balances, create payout queues, or treat admin state as payment truth.

create table refunds_and_disputes (
  id uuid primary key,
  payment_intent_id uuid not null references payment_intents(id),
  entitlement_id uuid references entitlements(id),
  reporter_user_id uuid not null references users(id),
  kind text not null check (kind in ('refund_request', 'dispute', 'access_issue')),
  requested_action text not null check (requested_action in ('review_only', 'creator_refund', 'revoke_access', 'replacement_access')),
  reason text not null,
  state text not null default 'opened'
    check (state in ('opened', 'reviewing', 'creator_action_required', 'rejected', 'withdrawn', 'resolved', 'closed')),
  resolution text,
  custody_boundary text not null default 'no_platform_custody_no_payout_queue'
    check (custody_boundary = 'no_platform_custody_no_payout_queue'),
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  resolved_at timestamptz
);

create index refunds_and_disputes_reporter_created_idx
  on refunds_and_disputes (reporter_user_id, created_at desc);

create index refunds_and_disputes_payment_idx
  on refunds_and_disputes (payment_intent_id, created_at desc);

create index refunds_and_disputes_entitlement_idx
  on refunds_and_disputes (entitlement_id)
  where entitlement_id is not null;

create index refunds_and_disputes_state_created_idx
  on refunds_and_disputes (state, created_at desc);

alter table refunds_and_disputes enable row level security;

grant select on table refunds_and_disputes to authenticated;

create policy refunds_and_disputes_select_self_or_staff
  on refunds_and_disputes for select to authenticated
  using (reporter_user_id = (select private.current_app_user_id()) or (select private.is_staff_member()));
