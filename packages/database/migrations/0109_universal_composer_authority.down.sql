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

drop trigger if exists media_assets_assign_position on media_assets;
drop function if exists private.assign_media_asset_position();

drop index if exists media_assets_content_release_idx;
drop index if exists media_assets_content_cover_uidx;
drop index if exists media_assets_content_position_uidx;

alter table media_assets
  drop constraint if exists media_assets_provenance_privacy_check,
  drop constraint if exists media_assets_focal_point_check,
  drop constraint if exists media_assets_checksum_check,
  drop constraint if exists media_assets_alt_text_check,
  drop constraint if exists media_assets_dimensions_check,
  drop constraint if exists media_assets_mime_type_check,
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
