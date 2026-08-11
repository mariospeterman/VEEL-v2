-- Canonical media-safety, performer-consent, and review workflow.
-- Provider events are normalized and minimized here; raw provider payloads,
-- identity documents, biometric data, and stream keys remain provider-side.

create table content_safety_declarations (
  content_item_id uuid primary key references content_items(id) on delete cascade,
  uploader_user_id uuid not null references users(id),
  representation_mode text not null check (representation_mode in (
    'not_declared',
    'no_real_person',
    'self_only',
    'declared_performers'
  )),
  policy_version text not null,
  state text not null default 'active' check (state in (
    'active',
    'disputed',
    'withdrawal_requested',
    'revoked'
  )),
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    representation_mode = 'not_declared'
    or (accepted_at is not null and char_length(policy_version) > 0)
  )
);

create table performer_subjects (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references users(id),
  linked_user_id uuid references users(id),
  verification_status text not null default 'pending' check (verification_status in (
    'pending',
    'valid',
    'expired',
    'revoked',
    'blocked'
  )),
  verification_provider text,
  verification_reference text,
  verification_method text,
  assurance_level text,
  result_over_18 boolean,
  verified_at timestamptz,
  expires_at timestamptz,
  dispute_state text not null default 'none' check (dispute_state in (
    'none',
    'open',
    'resolved',
    'upheld'
  )),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index performer_subjects_linked_user_idx
  on performer_subjects (owner_user_id, linked_user_id)
  where linked_user_id is not null;

create table performer_consents (
  id uuid primary key default gen_random_uuid(),
  content_item_id uuid not null references content_items(id) on delete cascade,
  performer_subject_id uuid not null references performer_subjects(id),
  recorded_by_user_id uuid not null references users(id),
  allowed_uses text[] not null,
  policy_version text not null,
  release_version text not null,
  state text not null default 'active' check (state in (
    'active',
    'withdrawal_requested',
    'withdrawn',
    'disputed',
    'revoked',
    'expired'
  )),
  evidence_hash text not null,
  evidence_reference text,
  accepted_at timestamptz not null,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (content_item_id, performer_subject_id, release_version),
  check (cardinality(allowed_uses) > 0),
  check (allowed_uses <@ array[
    'capture',
    'upload',
    'distribution',
    'monetisation',
    'live',
    'replay',
    'promotion'
  ]::text[])
);

create table media_safety_cases (
  id uuid primary key default gen_random_uuid(),
  content_item_id uuid references content_items(id) on delete cascade,
  live_room_id uuid references live_rooms(id) on delete cascade,
  declared_rating text not null check (declared_rating in ('none', 'adult', 'explicit')),
  state text not null default 'quarantined' check (state in (
    'quarantined',
    'preprocessing',
    'hash_checking',
    'classification',
    'review_required',
    'approved',
    'rejected',
    'held_for_reporting',
    'appealed',
    'superseded'
  )),
  decision_source text check (decision_source in (
    'automated',
    'provider',
    'staff',
    'appeal',
    'legacy_hold'
  )),
  reason_code text,
  policy_version text not null,
  provider_release_allowed boolean not null default false,
  evidence_summary jsonb not null default '{}'::jsonb,
  reviewed_by_user_id uuid references users(id),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((content_item_id is not null)::integer + (live_room_id is not null)::integer = 1),
  check (state = 'approved' or provider_release_allowed = false),
  check (jsonb_typeof(evidence_summary) = 'object')
);

create unique index media_safety_cases_content_active_idx
  on media_safety_cases (content_item_id)
  where content_item_id is not null and state <> 'superseded';

create unique index media_safety_cases_live_active_idx
  on media_safety_cases (live_room_id)
  where live_room_id is not null and state <> 'superseded';

create index media_safety_cases_review_queue_idx
  on media_safety_cases (state, created_at)
  where state in ('review_required', 'held_for_reporting', 'appealed');

create table provider_media_scan_events (
  id uuid primary key default gen_random_uuid(),
  media_safety_case_id uuid not null references media_safety_cases(id) on delete cascade,
  provider text not null check (provider in ('bunny_shield', 'bunny_stream', 'livepeer', 'internal')),
  provider_event_id text,
  scan_type text not null check (scan_type in (
    'malware',
    'known_hash',
    'content_classification',
    'live_signal',
    'manual_review'
  )),
  normalized_signal text not null check (normalized_signal in (
    'clear',
    'suspected',
    'matched',
    'inconclusive',
    'provider_error'
  )),
  payload_hash text not null,
  model_or_ruleset_version text,
  confidence numeric(5,4),
  provider_incident_reference text,
  reporting_state text not null default 'not_required' check (reporting_state in (
    'not_required',
    'provider_reported',
    'platform_review_required',
    'platform_reported',
    'reconciled'
  )),
  observed_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (provider, provider_event_id),
  check (confidence is null or confidence between 0 and 1)
);

create index provider_media_scan_events_case_idx
  on provider_media_scan_events (media_safety_case_id, observed_at desc);

create table media_moderation_jobs (
  id uuid primary key default gen_random_uuid(),
  media_safety_case_id uuid not null references media_safety_cases(id) on delete cascade,
  media_asset_id uuid references media_assets(id) on delete cascade,
  live_room_id uuid references live_rooms(id) on delete cascade,
  stage text not null check (stage in (
    'provider_scan_reconciliation',
    'content_classification',
    'live_monitoring',
    'manual_review'
  )),
  state text not null default 'queued' check (state in (
    'queued',
    'processing',
    'retry',
    'review_required',
    'completed',
    'dead_letter'
  )),
  attempt_count integer not null default 0,
  max_attempts integer not null default 5,
  next_attempt_at timestamptz not null default now(),
  lease_token uuid,
  leased_at timestamptz,
  lease_expires_at timestamptz,
  last_failure_code text,
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((media_asset_id is not null)::integer + (live_room_id is not null)::integer = 1),
  check (attempt_count >= 0 and max_attempts between 1 and 20)
);

create index media_moderation_jobs_lease_idx
  on media_moderation_jobs (state, next_attempt_at, created_at)
  where state in ('queued', 'retry', 'processing');

create table media_moderation_appeals (
  id uuid primary key default gen_random_uuid(),
  media_safety_case_id uuid not null references media_safety_cases(id) on delete cascade,
  appellant_user_id uuid not null references users(id),
  reason text not null check (char_length(reason) between 1 and 2000),
  state text not null default 'submitted' check (state in (
    'submitted',
    'reviewing',
    'upheld',
    'overturned',
    'withdrawn'
  )),
  resolution_reason text,
  reviewed_by_user_id uuid references users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index media_moderation_appeals_open_idx
  on media_moderation_appeals (media_safety_case_id, appellant_user_id)
  where state in ('submitted', 'reviewing');

create table regulatory_report_workflows (
  id uuid primary key default gen_random_uuid(),
  media_safety_case_id uuid not null references media_safety_cases(id) on delete cascade,
  provider text not null check (provider in ('bunny_shield', 'platform', 'law_enforcement')),
  provider_incident_reference text,
  jurisdiction text,
  state text not null default 'review_required' check (state in (
    'review_required',
    'provider_reported',
    'platform_reported',
    'reconciled',
    'closed'
  )),
  report_reference text,
  deadline_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (media_safety_case_id, provider, provider_incident_reference)
);

alter table content_safety_declarations enable row level security;
alter table performer_subjects enable row level security;
alter table performer_consents enable row level security;
alter table media_safety_cases enable row level security;
alter table provider_media_scan_events enable row level security;
alter table media_moderation_jobs enable row level security;
alter table media_moderation_appeals enable row level security;
alter table regulatory_report_workflows enable row level security;

create policy content_safety_declarations_select_owner_or_staff
  on content_safety_declarations for select to authenticated
  using (
    uploader_user_id = (select private.current_app_user_id())
    or (select private.is_staff_member())
  );

create policy performer_subjects_select_self_owner_or_staff
  on performer_subjects for select to authenticated
  using (
    owner_user_id = (select private.current_app_user_id())
    or linked_user_id = (select private.current_app_user_id())
    or (select private.is_staff_member())
  );

create policy performer_consents_select_party_or_staff
  on performer_consents for select to authenticated
  using (
    recorded_by_user_id = (select private.current_app_user_id())
    or exists (
      select 1
      from performer_subjects ps
      where ps.id = performer_consents.performer_subject_id
        and ps.linked_user_id = (select private.current_app_user_id())
    )
    or (select private.is_staff_member())
  );

create policy media_safety_cases_select_creator_or_staff
  on media_safety_cases for select to authenticated
  using (
    exists (
      select 1
      from content_items ci
      where ci.id = media_safety_cases.content_item_id
        and ci.creator_user_id = (select private.current_app_user_id())
    )
    or exists (
      select 1
      from live_rooms lr
      where lr.id = media_safety_cases.live_room_id
        and lr.creator_user_id = (select private.current_app_user_id())
    )
    or (select private.is_staff_member())
  );

create policy provider_media_scan_events_staff_select
  on provider_media_scan_events for select to authenticated
  using ((select private.is_staff_member()));

create policy media_moderation_jobs_staff_select
  on media_moderation_jobs for select to authenticated
  using ((select private.is_staff_member()));

create policy media_moderation_appeals_select_appellant_or_staff
  on media_moderation_appeals for select to authenticated
  using (
    appellant_user_id = (select private.current_app_user_id())
    or (select private.is_staff_member())
  );

create policy regulatory_report_workflows_staff_select
  on regulatory_report_workflows for select to authenticated
  using ((select private.is_staff_member()));

insert into content_safety_declarations (
  content_item_id,
  uploader_user_id,
  representation_mode,
  policy_version,
  state
)
select
  ci.id,
  ci.creator_user_id,
  'not_declared',
  'media-safety-v1',
  'active'
from content_items ci
where ci.nsfw_label in ('adult', 'explicit')
on conflict (content_item_id) do nothing;

insert into media_safety_cases (
  content_item_id,
  declared_rating,
  state,
  decision_source,
  reason_code,
  policy_version
)
select
  ci.id,
  ci.nsfw_label,
  case
    when exists (select 1 from media_assets ma where ma.content_item_id = ci.id)
      then 'review_required'
    else 'quarantined'
  end,
  'legacy_hold',
  'legacy_content_requires_canonical_review',
  'media-safety-v1'
from content_items ci
on conflict do nothing;

update content_items
set
  moderation_state = 'pending',
  publish_state = case when publish_state = 'published' then 'submitted_for_review' else publish_state end,
  updated_at = now()
where moderation_state = 'approved';

insert into media_moderation_jobs (
  media_safety_case_id,
  media_asset_id,
  stage,
  state,
  idempotency_key
)
select
  msc.id,
  ma.id,
  'provider_scan_reconciliation',
  'queued',
  'media-safety:asset:' || ma.id::text || ':provider-scan-v1'
from media_assets ma
join media_safety_cases msc on msc.content_item_id = ma.content_item_id
where msc.state <> 'superseded'
on conflict (idempotency_key) do nothing;

create or replace function private.content_performer_readiness(p_content_item_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = public, private
as $$
  select case
    when ci.nsfw_label = 'none' then true
    when not exists (
      select 1
      from verification_records vr
      where vr.subject_type = 'user'
        and vr.subject_id = ci.creator_user_id
        and vr.purpose = 'adult_publisher_eligibility'
        and vr.status = 'valid'
        and vr.result_over_threshold is true
        and vr.assurance_level in ('high', 'documentary')
        and vr.policy_version is not null
        and vr.terms_accepted_at is not null
        and (vr.expires_at is null or vr.expires_at > now())
    ) then false
    when csd.state <> 'active' or csd.representation_mode = 'not_declared' then false
    when csd.representation_mode = 'no_real_person' then true
    when csd.representation_mode = 'self_only' then
      exists (
        select 1
        from performer_consents pc
        join performer_subjects ps on ps.id = pc.performer_subject_id
        where pc.content_item_id = ci.id
          and ps.linked_user_id = ci.creator_user_id
          and ps.verification_status = 'valid'
          and ps.result_over_18 is true
          and ps.dispute_state = 'none'
          and (ps.expires_at is null or ps.expires_at > now())
          and pc.state = 'active'
          and pc.allowed_uses @> array['capture', 'upload', 'distribution']::text[]
          and (pc.expires_at is null or pc.expires_at > now())
      )
    when csd.representation_mode = 'declared_performers' then
      exists (
        select 1
        from performer_consents pc
        where pc.content_item_id = ci.id and pc.state = 'active'
      )
      and not exists (
        select 1
        from performer_consents pc
        join performer_subjects ps on ps.id = pc.performer_subject_id
        where pc.content_item_id = ci.id
          and (
            pc.state <> 'active'
            or not (pc.allowed_uses @> array['capture', 'upload', 'distribution']::text[])
            or (pc.expires_at is not null and pc.expires_at <= now())
            or ps.verification_status <> 'valid'
            or ps.result_over_18 is distinct from true
            or ps.dispute_state <> 'none'
            or (ps.expires_at is not null and ps.expires_at <= now())
          )
      )
    else false
  end
  from content_items ci
  left join content_safety_declarations csd on csd.content_item_id = ci.id
  where ci.id = p_content_item_id;
$$;

create or replace function private.content_safety_release_ready(p_content_item_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = public, private
as $$
  select coalesce((
    select
      msc.state = 'approved'
      and msc.provider_release_allowed is true
      and private.content_performer_readiness(ci.id)
      and exists (
        select 1
        from media_assets ma
        where ma.content_item_id = ci.id
          and ma.provider_playable is true
          and ma.ready_at is not null
      )
    from content_items ci
    join media_safety_cases msc
      on msc.content_item_id = ci.id
      and msc.state <> 'superseded'
    where ci.id = p_content_item_id
  ), false);
$$;

create or replace function private.enforce_content_safety_release()
returns trigger
language plpgsql
security invoker
set search_path = public, private
as $$
begin
  if new.moderation_state = 'approved'
     and not private.content_safety_release_ready(new.id) then
    raise exception using errcode = 'P0001', message = 'content_safety_release_not_ready';
  end if;
  return new;
end;
$$;

create trigger content_items_safety_release_guard
before insert or update of moderation_state on content_items
for each row execute function private.enforce_content_safety_release();

revoke all on function private.content_performer_readiness(uuid) from public, anon, authenticated;
revoke all on function private.content_safety_release_ready(uuid) from public, anon, authenticated;
revoke all on function private.enforce_content_safety_release() from public, anon, authenticated;

comment on table media_safety_cases is
  'Canonical media release decision. content_items.moderation_state is a projection only.';
comment on table provider_media_scan_events is
  'Normalized provider scan evidence only. Raw payloads and illegal media are not stored here.';
comment on function private.content_safety_release_ready(uuid) is
  'Returns whether canonical moderation and performer evidence allow content release.';
