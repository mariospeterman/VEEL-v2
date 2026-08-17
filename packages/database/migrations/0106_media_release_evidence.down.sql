-- Rollback removes the new hard release predicate. It intentionally leaves content
-- held for review; rollback must never fabricate or restore an approval.

drop trigger if exists provider_media_scan_events_adverse_hold on provider_media_scan_events;
drop function if exists private.hold_content_on_adverse_media_evidence();
drop trigger if exists provider_media_scan_events_asset_scope on provider_media_scan_events;
drop function if exists private.enforce_media_evidence_asset_scope();

-- The previous application version does not select release_media_asset_id. Hold
-- every release approved under this migration before restoring the old predicate,
-- otherwise rollback could expose a different, unchecked asset for the content.
update content_items
set
  state = 'blocked',
  moderation_state = 'pending',
  publish_state = 'blocked',
  updated_at = now()
where release_media_asset_id is not null
  and publish_state = 'published';

update media_safety_cases safety
set
  state = 'review_required',
  decision_source = null,
  reason_code = 'release_requires_review_after_policy_rollback',
  provider_release_allowed = false,
  reviewed_by_user_id = null,
  decided_at = null,
  updated_at = now()
from content_items content
where content.id = safety.content_item_id
  and content.release_media_asset_id is not null
  and safety.state = 'approved';

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
drop function if exists private.content_safety_automated_candidate_asset(uuid);
drop function if exists private.content_safety_automated_asset_evidence_ready(uuid, uuid);

-- Preserve container-integrity evidence, asset bindings, and the selected release
-- pointer on rollback. Audit evidence must not be deleted merely to restore the
-- earlier release policy.

comment on function private.content_safety_release_ready(uuid) is
  'Returns whether canonical moderation and performer evidence allow content release.';
