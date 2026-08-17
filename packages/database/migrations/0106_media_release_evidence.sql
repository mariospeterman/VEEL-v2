-- A staff decision may release uploaded media only after every required normalized
-- automated signal is present and the latest signal for each category is clear.
-- Provider playability remains transport evidence, never malware/hash/classification proof.

alter table provider_media_scan_events
  drop constraint provider_media_scan_events_scan_type_check;

alter table provider_media_scan_events
  add constraint provider_media_scan_events_scan_type_check check (scan_type in (
    'container_integrity',
    'malware',
    'known_hash',
    'content_classification',
    'live_signal',
    'manual_review'
  ));

alter table provider_media_scan_events
  add column if not exists media_asset_id uuid;

alter table provider_media_scan_events
  add column if not exists release_eligible boolean not null default true;

alter table content_items
  add column if not exists release_media_asset_id uuid;

alter table provider_media_scan_events
  drop constraint if exists provider_media_scan_events_media_asset_id_fkey;

alter table provider_media_scan_events
  add constraint provider_media_scan_events_media_asset_id_fkey
  foreign key (media_asset_id) references media_assets(id) on delete restrict;

alter table content_items
  drop constraint if exists content_items_release_media_asset_id_fkey;

alter table content_items
  add constraint content_items_release_media_asset_id_fkey
  foreign key (release_media_asset_id) references media_assets(id) on delete restrict;

create index if not exists provider_media_scan_events_asset_idx
  on provider_media_scan_events (media_safety_case_id, media_asset_id, scan_type, observed_at desc);

create or replace function private.content_safety_automated_asset_evidence_ready(
  p_content_item_id uuid,
  p_media_asset_id uuid
)
returns boolean
language sql
stable
security invoker
set search_path = public, private
as $$
  with active_case as (
    select id
    from media_safety_cases
    where content_item_id = p_content_item_id
      and state <> 'superseded'
  ),
  latest_required_signals as (
    select distinct on (scan.scan_type)
      scan.scan_type,
      scan.provider,
      scan.provider_event_id,
      scan.normalized_signal,
      scan.payload_hash,
      scan.model_or_ruleset_version
    from provider_media_scan_events scan
    join active_case safety on safety.id = scan.media_safety_case_id
    where scan.media_asset_id = p_media_asset_id
      and scan.release_eligible is true
      and scan.scan_type in (
        'container_integrity',
        'malware',
        'known_hash',
        'content_classification'
      )
    order by scan.scan_type, scan.observed_at desc, scan.created_at desc, scan.id desc
  )
  select
    exists (
      select 1
      from media_assets asset
      where asset.id = p_media_asset_id
        and asset.content_item_id = p_content_item_id
        and asset.provider_playable is true
        and asset.ready_at is not null
    )
    and count(*) = 4
    and bool_and(normalized_signal = 'clear')
    and bool_and(provider_event_id is not null)
    and bool_and(payload_hash ~ '^[0-9a-f]{64}$')
    and bool_and(case scan_type
      when 'container_integrity' then provider = 'bunny_stream'
      when 'malware' then provider = 'bunny_shield'
      when 'known_hash' then provider = 'bunny_shield'
      when 'content_classification' then provider = 'internal' and model_or_ruleset_version is not null
      else false
    end)
  from latest_required_signals;
$$;

create or replace function private.content_safety_automated_candidate_asset(p_content_item_id uuid)
returns uuid
language sql
stable
security invoker
set search_path = public, private
as $$
  select asset.id
  from media_assets asset
  where asset.content_item_id = p_content_item_id
    and private.content_safety_automated_asset_evidence_ready(p_content_item_id, asset.id)
  order by asset.created_at desc, asset.id desc
  limit 1;
$$;

create or replace function private.content_safety_automated_evidence_ready(p_content_item_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = public, private
as $$
  select private.content_safety_automated_candidate_asset(p_content_item_id) is not null;
$$;

create or replace function private.content_safety_release_evidence_ready(p_content_item_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = public, private
as $$
  select coalesce((
    select
      private.content_safety_automated_asset_evidence_ready(ci.id, ci.release_media_asset_id)
      and coalesce((
      select
        scan.provider = 'internal'
        and scan.normalized_signal = 'clear'
        and scan.provider_event_id is not null
        and scan.payload_hash ~ '^[0-9a-f]{64}$'
        and scan.model_or_ruleset_version is not null
      from provider_media_scan_events scan
      join media_safety_cases safety on safety.id = scan.media_safety_case_id
      where safety.content_item_id = p_content_item_id
        and safety.state <> 'superseded'
        and scan.scan_type = 'manual_review'
        and scan.media_asset_id = ci.release_media_asset_id
      order by scan.observed_at desc, scan.created_at desc, scan.id desc
      limit 1
      ), false)
    from content_items ci
    where ci.id = p_content_item_id
      and ci.release_media_asset_id is not null
  ), false);
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
      and private.content_safety_automated_evidence_ready(ci.id)
      and private.content_safety_release_evidence_ready(ci.id)
      and private.content_performer_readiness(ci.id)
      and exists (
        select 1
        from media_assets ma
        where ma.id = ci.release_media_asset_id
          and ma.content_item_id = ci.id
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

create or replace function private.enforce_media_evidence_asset_scope()
returns trigger
language plpgsql
security invoker
set search_path = public, private
as $$
declare
  v_content_item_id uuid;
begin
  select safety.content_item_id
  into v_content_item_id
  from media_safety_cases safety
  where safety.id = new.media_safety_case_id;

  if v_content_item_id is not null and (
    new.media_asset_id is null
    or not exists (
      select 1
      from media_assets asset
      where asset.id = new.media_asset_id
        and asset.content_item_id = v_content_item_id
    )
  ) then
    raise exception using
      errcode = '23514',
      message = 'provider_media_scan_event_asset_scope_invalid';
  end if;

  return new;
end;
$$;

create trigger provider_media_scan_events_asset_scope
before insert or update of media_safety_case_id, media_asset_id on provider_media_scan_events
for each row execute function private.enforce_media_evidence_asset_scope();

create or replace function private.hold_content_on_adverse_media_evidence()
returns trigger
language plpgsql
security invoker
set search_path = public, private
as $$
declare
  v_content_item_id uuid;
  v_release_media_asset_id uuid;
  v_case_state text;
begin
  if new.scan_type not in (
    'container_integrity',
    'malware',
    'known_hash',
    'content_classification'
  ) or new.normalized_signal = 'clear' then
    return new;
  end if;

  v_case_state := case
    when new.scan_type = 'known_hash' and new.normalized_signal = 'matched'
      then 'held_for_reporting'
    else 'review_required'
  end;

  select safety.content_item_id, content.release_media_asset_id
  into v_content_item_id, v_release_media_asset_id
  from media_safety_cases safety
  join content_items content on content.id = safety.content_item_id
  where safety.id = new.media_safety_case_id
    and safety.state <> 'superseded';

  if v_content_item_id is null then
    return new;
  end if;

  -- Evidence for a draft replacement must not withdraw a different asset that is
  -- already the canonical public release. Normal uploads cannot replace published
  -- media in place, but this also closes the administrative/out-of-band path.
  if v_release_media_asset_id is not null
     and new.media_asset_id is not null
     and new.media_asset_id <> v_release_media_asset_id then
    return new;
  end if;

  update media_safety_cases safety
  set
    state = case
      when safety.state = 'appealed' and v_case_state = 'review_required' then 'appealed'
      else v_case_state
    end,
    reason_code = case
      when v_case_state = 'held_for_reporting'
        then 'known_hash_match_requires_reporting_review'
      else 'automated_signal_requires_human_review'
    end,
    provider_release_allowed = false,
    reviewed_by_user_id = null,
    decided_at = null,
    updated_at = now()
  where safety.id = new.media_safety_case_id
    and safety.state <> 'superseded';

  if v_content_item_id is not null then
    update content_items
    set
      state = 'blocked',
      moderation_state = 'pending',
      publish_state = 'blocked',
      updated_at = now()
    where id = v_content_item_id;
  end if;

  if new.scan_type = 'known_hash'
     and new.normalized_signal = 'matched'
     and new.provider = 'bunny_shield' then
    update provider_media_scan_events
    set reporting_state = 'platform_review_required'
    where id = new.id;

    insert into regulatory_report_workflows (
      media_safety_case_id,
      provider,
      provider_incident_reference,
      state
    )
    values (
      new.media_safety_case_id,
      'bunny_shield',
      coalesce(new.provider_incident_reference, new.provider_event_id, new.id::text),
      'review_required'
    )
    on conflict (media_safety_case_id, provider, provider_incident_reference) do nothing;
  end if;

  return new;
end;
$$;

create trigger provider_media_scan_events_adverse_hold
after insert on provider_media_scan_events
for each row execute function private.hold_content_on_adverse_media_evidence();

-- Existing approvals without the new evidence cannot remain public merely because
-- they predate this guard. Rollback deliberately does not fabricate their approval.
update content_items ci
set
  moderation_state = 'pending',
  publish_state = case when publish_state = 'published' then 'submitted_for_review' else publish_state end,
  updated_at = now()
where ci.moderation_state = 'approved'
  and not private.content_safety_release_evidence_ready(ci.id);

update media_safety_cases safety
set
  state = 'review_required',
  decision_source = null,
  reason_code = 'required_release_evidence_incomplete',
  provider_release_allowed = false,
  reviewed_by_user_id = null,
  decided_at = null,
  updated_at = now()
where safety.content_item_id is not null
  and safety.state = 'approved'
  and not private.content_safety_release_evidence_ready(safety.content_item_id);

revoke all on function private.content_safety_automated_evidence_ready(uuid) from public, anon, authenticated;
revoke all on function private.content_safety_automated_asset_evidence_ready(uuid, uuid) from public, anon, authenticated;
revoke all on function private.content_safety_automated_candidate_asset(uuid) from public, anon, authenticated;
revoke all on function private.content_safety_release_evidence_ready(uuid) from public, anon, authenticated;
revoke all on function private.enforce_media_evidence_asset_scope() from public, anon, authenticated;
revoke all on function private.hold_content_on_adverse_media_evidence() from public, anon, authenticated;

comment on function private.content_safety_automated_evidence_ready(uuid) is
  'Requires one playable media asset to have a complete, attributable, and clear automated evidence set.';
comment on function private.content_safety_automated_asset_evidence_ready(uuid, uuid) is
  'Requires the latest release-eligible container, malware, known-hash, and classification evidence for one media asset to be complete, attributable, and clear.';
comment on function private.content_safety_automated_candidate_asset(uuid) is
  'Returns the latest playable media asset whose own automated evidence set is complete and clear.';
comment on function private.content_safety_release_evidence_ready(uuid) is
  'Requires complete automated evidence plus a clear human review bound to the selected release media asset.';
comment on function private.content_safety_release_ready(uuid) is
  'Returns whether canonical moderation, normalized release evidence, performer evidence, and provider playability allow content release.';
comment on function private.enforce_media_evidence_asset_scope() is
  'Rejects content safety evidence unless its media asset belongs to the same content item.';
comment on function private.hold_content_on_adverse_media_evidence() is
  'Immediately removes published content from public access when a new required automated signal is not clear.';
