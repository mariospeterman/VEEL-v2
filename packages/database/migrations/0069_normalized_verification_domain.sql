-- Normalized verification domain.
-- Stores provider references, normalized decisions, payload hashes, and minimal metadata only.
-- Do not store raw identity documents, selfies, biometric templates, or raw provider payloads here.

create table verification_sessions (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null check (subject_type in ('user', 'organization', 'organization_person')),
  subject_id uuid not null,
  purpose text not null check (purpose in (
    'age_access',
    'adult_content_access',
    'creator_kyc',
    'payout_kyc',
    'org_kyb',
    'ubo_kyc',
    'enterprise_review'
  )),
  provider text not null check (provider in ('sumsub', 'yoti', 'persona', 'veriff', 'manual', 'internal')),
  provider_session_id text,
  provider_applicant_id text,
  provider_inquiry_id text,
  provider_transaction_id text,
  requested_method text not null check (requested_method in (
    'reusable_age',
    'age_estimation',
    'non_doc',
    'doc_scan',
    'gov_id_selfie',
    'kyb_registry',
    'manual_review'
  )),
  status text not null default 'created' check (status in (
    'created',
    'pending',
    'submitted',
    'approved',
    'declined',
    'needs_review',
    'expired',
    'canceled',
    'failed'
  )),
  jurisdiction text,
  threshold_age integer,
  assurance_level text not null default 'low' check (assurance_level in (
    'self_declared',
    'low',
    'medium',
    'high',
    'documentary',
    'business_verified'
  )),
  reusable boolean not null default false,
  source_session_id uuid references verification_sessions(id),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create table verification_records (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null check (subject_type in ('user', 'organization', 'organization_person')),
  subject_id uuid not null,
  purpose text not null check (purpose in (
    'age_access',
    'adult_content_access',
    'creator_kyc',
    'payout_kyc',
    'org_kyb',
    'ubo_kyc',
    'enterprise_review'
  )),
  status text not null check (status in ('valid', 'invalid', 'pending', 'expired', 'revoked', 'blocked')),
  provider text not null check (provider in ('sumsub', 'yoti', 'persona', 'veriff', 'manual', 'internal')),
  provider_reference text,
  method text not null check (method in (
    'reusable_age',
    'age_estimation',
    'non_doc',
    'doc_scan',
    'gov_id_selfie',
    'kyb_registry',
    'manual_review'
  )),
  jurisdiction text,
  threshold_age integer,
  result_over_threshold boolean,
  assurance_level text not null check (assurance_level in (
    'self_declared',
    'low',
    'medium',
    'high',
    'documentary',
    'business_verified'
  )),
  verified_at timestamptz,
  expires_at timestamptz,
  reusable boolean not null default false,
  derived_from_record_id uuid references verification_records(id),
  raw_payload_hash text,
  failure_reason_code text,
  manual_review_reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table verification_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references verification_sessions(id),
  provider text not null check (provider in ('sumsub', 'yoti', 'persona', 'veriff', 'manual', 'internal')),
  event_type text not null,
  idempotency_key text,
  payload_hash text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  processing_status text not null default 'received' check (processing_status in ('received', 'processed', 'ignored', 'failed')),
  unique (provider, payload_hash),
  unique (provider, idempotency_key)
);

create index verification_records_subject_purpose_idx
  on verification_records (subject_type, subject_id, purpose, status, verified_at desc);

create index verification_records_expiry_idx
  on verification_records (expires_at)
  where expires_at is not null;

create index verification_sessions_subject_purpose_idx
  on verification_sessions (subject_type, subject_id, purpose, status, created_at desc);

create index verification_events_session_idx
  on verification_events (session_id, received_at desc);

alter table verification_sessions enable row level security;
alter table verification_records enable row level security;
alter table verification_events enable row level security;

create policy verification_sessions_select_self_org_or_staff
  on verification_sessions for select to authenticated
  using (
    (subject_type = 'user' and subject_id = (select private.current_app_user_id()))
    or (subject_type = 'organization' and exists (
      select 1
      from organization_memberships om
      where om.organization_id = verification_sessions.subject_id
        and om.user_id = (select private.current_app_user_id())
        and om.state in ('active', 'invited')
    ))
    or (select private.is_staff_member())
  );

create policy verification_records_select_self_org_or_staff
  on verification_records for select to authenticated
  using (
    (subject_type = 'user' and subject_id = (select private.current_app_user_id()))
    or (subject_type = 'organization' and exists (
      select 1
      from organization_memberships om
      where om.organization_id = verification_records.subject_id
        and om.user_id = (select private.current_app_user_id())
        and om.state in ('active', 'invited')
    ))
    or (select private.is_staff_member())
  );

create policy verification_events_staff_select
  on verification_events for select to authenticated
  using ((select private.is_staff_member()));

insert into verification_records (
  subject_type,
  subject_id,
  purpose,
  status,
  provider,
  provider_reference,
  method,
  jurisdiction,
  threshold_age,
  result_over_threshold,
  assurance_level,
  verified_at,
  expires_at,
  reusable,
  metadata,
  created_at,
  updated_at
)
select
  'user',
  av.user_id,
  'age_access',
  case
    when av.state = 'verified' and (av.expires_at is null or av.expires_at > now()) then 'valid'
    when av.state = 'verified' then 'expired'
    when av.state = 'pending' then 'pending'
    when av.state = 'failed' then 'blocked'
    else 'invalid'
  end,
  case when av.provider in ('sumsub', 'yoti', 'persona', 'veriff') then av.provider else 'internal' end,
  av.provider_reference,
  case
    when av.provider = 'yoti' then 'reusable_age'
    when av.provider = 'persona' then 'doc_scan'
    when av.provider in ('sumsub', 'veriff') then 'gov_id_selfie'
    else 'manual_review'
  end,
  av.jurisdiction,
  18,
  av.state = 'verified',
  case
    when av.provider in ('sumsub', 'veriff') then 'documentary'
    when av.provider = 'yoti' then 'medium'
    else 'low'
  end,
  av.verified_at,
  av.expires_at,
  av.provider = 'yoti',
  jsonb_build_object('source', 'age_verifications_backfill', 'rule', av.rule),
  av.created_at,
  now()
from age_verifications av
where not exists (
  select 1
  from verification_records vr
  where vr.subject_type = 'user'
    and vr.subject_id = av.user_id
    and vr.purpose = 'age_access'
    and vr.provider = case when av.provider in ('sumsub', 'yoti', 'persona', 'veriff') then av.provider else 'internal' end
    and coalesce(vr.provider_reference, '') = coalesce(av.provider_reference, '')
);

insert into verification_records (
  subject_type,
  subject_id,
  purpose,
  status,
  provider,
  method,
  assurance_level,
  verified_at,
  reusable,
  metadata,
  created_at,
  updated_at
)
select
  'user',
  cms.user_id,
  'creator_kyc',
  case
    when cms.kyc_state = 'verified' then 'valid'
    when cms.kyc_state = 'pending' then 'pending'
    when cms.kyc_state = 'failed' then 'blocked'
    when cms.kyc_state = 'required' then 'invalid'
    else 'invalid'
  end,
  'internal',
  'manual_review',
  case when cms.kyc_state = 'verified' then 'documentary' else 'low' end,
  case when cms.kyc_state = 'verified' then cms.updated_at else null end,
  false,
  jsonb_build_object('source', 'creator_monetisation_settings_backfill', 'legacyKycState', cms.kyc_state),
  cms.created_at,
  now()
from creator_monetisation_settings cms
where cms.kyc_state <> 'not_required'
  and not exists (
    select 1
    from verification_records vr
    where vr.subject_type = 'user'
      and vr.subject_id = cms.user_id
      and vr.purpose = 'creator_kyc'
  );

insert into verification_records (
  subject_type,
  subject_id,
  purpose,
  status,
  provider,
  method,
  assurance_level,
  verified_at,
  reusable,
  metadata,
  created_at,
  updated_at
)
select
  'organization',
  o.id,
  'org_kyb',
  case
    when o.kyb_state = 'verified' then 'valid'
    when o.kyb_state = 'pending' then 'pending'
    when o.kyb_state = 'rejected' then 'blocked'
    else 'invalid'
  end,
  'internal',
  'manual_review',
  case when o.kyb_state = 'verified' then 'business_verified' else 'low' end,
  case when o.kyb_state = 'verified' then o.created_at else null end,
  false,
  jsonb_build_object('source', 'organizations_backfill', 'legacyKybState', o.kyb_state),
  o.created_at,
  now()
from organizations o
where o.kyb_state is not null
  and not exists (
    select 1
    from verification_records vr
    where vr.subject_type = 'organization'
      and vr.subject_id = o.id
      and vr.purpose = 'org_kyb'
  );
