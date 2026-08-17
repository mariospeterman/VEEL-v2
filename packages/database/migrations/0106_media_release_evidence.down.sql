-- Rollback removes the new hard release predicate. It intentionally leaves content
-- held for review; rollback must never fabricate or restore an approval.

drop trigger if exists provider_media_scan_events_adverse_hold on provider_media_scan_events;
drop function if exists private.hold_content_on_adverse_media_evidence();

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

drop function if exists private.content_safety_release_evidence_ready(uuid);
drop function if exists private.content_safety_automated_evidence_ready(uuid);

-- Preserve container-integrity evidence and the additive scan type on rollback.
-- Audit evidence must not be deleted merely to restore the earlier release policy.

comment on function private.content_safety_release_ready(uuid) is
  'Returns whether canonical moderation and performer evidence allow content release.';
