-- Evidence-only remediation records for refund/dispute reviews.
-- This does not custody funds, execute refunds, create balances, or create payout queues.

create table refund_remediation_evidence (
  id uuid primary key,
  refund_dispute_id uuid not null references refunds_and_disputes(id) on delete cascade,
  payment_intent_id uuid not null references payment_intents(id),
  recorded_by_user_id uuid not null references users(id),
  evidence_type text not null
    check (evidence_type in (
      'creator_refund_attestation',
      'replacement_access_recorded',
      'access_revocation_recorded',
      'technical_remediation_recorded',
      'no_refund_denial_recorded'
    )),
  evidence_source text not null
    check (evidence_source in (
      'creator_attestation',
      'provider_reference',
      'support_observation',
      'platform_access_change'
    )),
  external_reference text,
  amount_minor bigint check (amount_minor is null or amount_minor >= 0),
  currency text,
  refund_value_basis text
    check (refund_value_basis is null or refund_value_basis in ('original_crypto_amount', 'fiat_value_at_purchase', 'manual_resolution')),
  refund_wallet text,
  notes text not null,
  custody_boundary text not null default 'evidence_only_no_platform_custody_no_payout_queue'
    check (custody_boundary = 'evidence_only_no_platform_custody_no_payout_queue'),
  idempotency_key text not null,
  created_at timestamptz not null default now()
);

create unique index refund_remediation_evidence_dispute_idempotency_idx
  on refund_remediation_evidence (refund_dispute_id, idempotency_key);

create index refund_remediation_evidence_dispute_created_idx
  on refund_remediation_evidence (refund_dispute_id, created_at desc);

create index refund_remediation_evidence_payment_created_idx
  on refund_remediation_evidence (payment_intent_id, created_at desc);

alter table refund_remediation_evidence enable row level security;

grant select on table refund_remediation_evidence to authenticated;

create policy refund_remediation_evidence_select_self_or_staff
  on refund_remediation_evidence for select to authenticated
  using (
    exists (
      select 1
      from refunds_and_disputes rd
      where rd.id = refund_remediation_evidence.refund_dispute_id
        and (
          rd.reporter_user_id = (select private.current_app_user_id())
          or (select private.is_staff_member())
        )
    )
  );
