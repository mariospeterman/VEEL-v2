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

create or replace function private.content_safety_automated_evidence_ready(p_content_item_id uuid)
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
    where scan.scan_type in (
      'container_integrity',
      'malware',
      'known_hash',
      'content_classification'
    )
    order by scan.scan_type, scan.observed_at desc, scan.created_at desc, scan.id desc
  )
  select
    count(*) = 4
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

create or replace function private.content_safety_release_evidence_ready(p_content_item_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = public, private
as $$
  select
    private.content_safety_automated_evidence_ready(p_content_item_id)
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
      order by scan.observed_at desc, scan.created_at desc, scan.id desc
      limit 1
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

create or replace function private.hold_content_on_adverse_media_evidence()
returns trigger
language plpgsql
security invoker
set search_path = public, private
as $$
declare
  v_content_item_id uuid;
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
    and safety.state <> 'superseded'
  returning safety.content_item_id into v_content_item_id;

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
revoke all on function private.content_safety_release_evidence_ready(uuid) from public, anon, authenticated;
revoke all on function private.hold_content_on_adverse_media_evidence() from public, anon, authenticated;

comment on function private.content_safety_automated_evidence_ready(uuid) is
  'Requires the latest container, malware, known-hash, and classification evidence to be complete, attributable, and clear.';
comment on function private.content_safety_release_evidence_ready(uuid) is
  'Requires complete automated evidence plus a latest clear human review before uploaded content can be released.';
comment on function private.content_safety_release_ready(uuid) is
  'Returns whether canonical moderation, normalized release evidence, performer evidence, and provider playability allow content release.';
comment on function private.hold_content_on_adverse_media_evidence() is
  'Immediately removes published content from public access when a new required automated signal is not clear.';
