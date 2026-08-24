do $$
begin
  if to_regclass('public.mcp_media_upload_capabilities') is not null
     and exists (select 1 from mcp_media_upload_capabilities limit 1) then
    raise exception '0115 rollback requires retained MCP media capability records to be migrated before downgrade';
  end if;

  if exists (select 1 from media_assets where source_kind is not null limit 1) then
    raise exception '0115 rollback requires retained media provenance source kinds to be migrated before downgrade';
  end if;
end
$$;

create or replace function private.content_safety_release_ready(p_content_item_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = public, private
as $$
  select private.content_composition_safety_ready(p_content_item_id);
$$;

drop function if exists private.content_composition_provenance_ready(uuid);
drop table if exists mcp_media_upload_capabilities;

drop trigger media_assets_bump_asset_revision on media_assets;
create or replace function private.bump_content_asset_revision()
returns trigger
language plpgsql
security invoker
set search_path = public, private
as $$
begin
  update content_items
  set asset_revision = asset_revision + 1, updated_at = now()
  where id = case when tg_op = 'DELETE' then old.content_item_id else new.content_item_id end;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
create trigger media_assets_bump_asset_revision
after insert or update of position, asset_kind, alt_text, is_cover, focal_point_x, focal_point_y,
  origin_classification, source_lineage_reference, workflow_provider_reference,
  provenance_human_review_state, visible_label_state, machine_readable_marking_state, c2pa_reference,
  retired_at
  or delete
on media_assets
for each row execute function private.bump_content_asset_revision();

alter table media_assets
  drop constraint if exists media_assets_c2pa_reference_check,
  drop constraint if exists media_assets_workflow_provider_reference_check,
  drop constraint if exists media_assets_source_kind_check,
  drop column if exists source_kind;

comment on function private.content_safety_release_ready(uuid) is
  'Canonical publication trigger predicate for text, poll, and provider-backed media compositions.';
