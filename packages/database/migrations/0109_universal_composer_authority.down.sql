drop trigger if exists content_poll_options_enforce_shape on content_poll_options;
drop trigger if exists content_polls_enforce_shape on content_polls;
drop trigger if exists content_items_enforce_poll_shape on content_items;
drop function if exists private.enforce_poll_shape();

drop trigger if exists content_polls_clear_children on content_polls;
drop function if exists private.clear_poll_children_for_parent_delete();

drop trigger if exists content_poll_votes_sync_counts on content_poll_votes;
drop function if exists private.sync_poll_vote_counts();
drop trigger if exists content_poll_options_lock_after_vote on content_poll_options;
drop function if exists private.prevent_poll_option_rewrite_after_vote();

drop trigger if exists media_assets_bump_asset_revision on media_assets;
drop function if exists private.bump_content_asset_revision();
drop trigger if exists content_items_enforce_asset_shape on content_items;
drop trigger if exists media_assets_enforce_content_shape on media_assets;
drop function if exists private.enforce_content_asset_shape();

drop table if exists content_poll_votes;
drop table if exists content_poll_options;
drop table if exists content_polls;

-- Restore the media-only release predicate from 0106 before removing the
-- composition-aware functions and columns introduced by this migration.
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

comment on function private.content_safety_release_ready(uuid) is
  'Requires canonical moderation, automated and manual evidence, performer readiness, and provider-ready release media.';

drop function if exists private.content_composition_safety_ready(uuid);
drop function if exists private.content_composition_provider_ready(uuid);

drop trigger if exists media_assets_assign_position on media_assets;
drop function if exists private.assign_media_asset_position();

drop index if exists media_assets_content_release_idx;
drop index if exists media_assets_provider_cleanup_idx;
drop index if exists media_assets_content_cover_uidx;
alter table media_assets
  drop constraint if exists media_assets_content_position_uidx;

alter table media_assets
  drop constraint if exists media_assets_provenance_privacy_check,
  drop constraint if exists media_assets_focal_point_check,
  drop constraint if exists media_assets_checksum_check,
  drop constraint if exists media_assets_alt_text_check,
  drop constraint if exists media_assets_dimensions_check,
  drop constraint if exists media_assets_mime_type_check,
  drop constraint if exists media_assets_retirement_check,
  drop constraint if exists media_assets_position_check,
  drop column if exists c2pa_reference,
  drop column if exists machine_readable_marking_state,
  drop column if exists visible_label_state,
  drop column if exists provenance_human_review_state,
  drop column if exists workflow_provider_reference,
  drop column if exists source_lineage_reference,
  drop column if exists origin_classification,
  drop column if exists focal_point_y,
  drop column if exists focal_point_x,
  drop column if exists is_cover,
  drop column if exists provider_cleanup_error_code,
  drop column if exists provider_cleanup_leased_until,
  drop column if exists provider_cleanup_lease_token,
  drop column if exists provider_cleanup_next_attempt_at,
  drop column if exists provider_cleanup_attempt_count,
  drop column if exists provider_cleanup_state,
  drop column if exists retirement_reason,
  drop column if exists retired_by_user_id,
  drop column if exists retired_at,
  drop column if exists required_for_release,
  drop column if exists checksum_sha256,
  drop column if exists alt_text,
  drop column if exists height_pixels,
  drop column if exists width_pixels,
  drop column if exists mime_type,
  drop column if exists position,
  drop column if exists asset_kind;

alter table content_items
  drop constraint if exists content_items_text_shape_check,
  drop constraint if exists content_items_body_text_check,
  drop constraint if exists content_items_media_type_check,
  drop column if exists asset_revision,
  drop column if exists body_text;
