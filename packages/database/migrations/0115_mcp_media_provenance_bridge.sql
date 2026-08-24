-- Convergence 08: one-time private media handoff plus review-bound provenance.
-- Capability material is stored only as hashes. Prompts, credentials, upload signatures,
-- provider payloads, filenames, and media bytes are forbidden from this ledger.

alter table media_assets
  add column source_kind text,
  add constraint media_assets_source_kind_check check (
    source_kind is null or source_kind in ('generated', 'edited', 'composited', 'unknown')
  ),
  add constraint media_assets_assistant_origin_check check (
    source_kind is null or origin_classification <> 'human_created'
  ),
  add constraint media_assets_source_lineage_reference_check check (
    source_lineage_reference is null
    or (
      char_length(source_lineage_reference) between 1 and 500
      and source_lineage_reference !~ '%'
      and (
        source_lineage_reference ~* '^https://([a-z0-9-]+\.)*c2pa\.org/(claims|manifests|assets|lineage)/([a-f0-9]{64}|[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})$'
        or source_lineage_reference ~* '^urn:(wevid|c2pa):[a-z0-9][a-z0-9-]{0,31}:([a-f0-9]{64}|[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})$'
      )
      and source_lineage_reference !~* '(prompt|api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|password|passwd|credential|private[-_ ]?key|client[-_ ]?secr[e]t|authorization|bearer|cookie|session[-_ ]?id)'
    )
  ),
  add constraint media_assets_workflow_provider_reference_check check (
    workflow_provider_reference is null
    or (
      char_length(workflow_provider_reference) between 1 and 120
      and workflow_provider_reference ~* '^([a-f0-9]{64}|[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})$'
      and workflow_provider_reference !~* '(prompt|api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|password|passwd|credential|private[-_ ]?key|client[-_ ]?secr[e]t|authorization|bearer|cookie|session[-_ ]?id)'
    )
  ),
  add constraint media_assets_c2pa_reference_check check (
    c2pa_reference is null
    or (
      char_length(c2pa_reference) between 1 and 500
      and c2pa_reference !~ '%'
      and (
        c2pa_reference ~* '^https://([a-z0-9-]+\.)*c2pa\.org/(claims|manifests|assets|lineage)/([a-f0-9]{64}|[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})$'
        or c2pa_reference ~* '^urn:(wevid|c2pa):[a-z0-9][a-z0-9-]{0,31}:([a-f0-9]{64}|[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})$'
      )
      and c2pa_reference !~* '(prompt|api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|password|passwd|credential|private[-_ ]?key|client[-_ ]?secr[e]t|authorization|bearer|cookie|session[-_ ]?id)'
    )
  );

drop trigger media_assets_bump_asset_revision on media_assets;
create or replace function private.bump_content_asset_revision()
returns trigger
language plpgsql
security invoker
set search_path = public, private
as $$
begin
  -- A retired row may exist only to hand an unattached provider object to the
  -- canonical cleanup worker; it never became part of the composition.
  if tg_op = 'INSERT' and new.retired_at is not null then return new; end if;
  update content_items
  set asset_revision = asset_revision + 1, updated_at = now()
  where id = case when tg_op = 'DELETE' then old.content_item_id else new.content_item_id end;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
create trigger media_assets_bump_asset_revision
after insert or update of position, asset_kind, alt_text, is_cover, focal_point_x, focal_point_y,
  origin_classification, source_kind, source_lineage_reference, workflow_provider_reference,
  provenance_human_review_state, visible_label_state, machine_readable_marking_state, c2pa_reference,
  retired_at
  or delete
on media_assets
for each row execute function private.bump_content_asset_revision();

create table mcp_media_upload_capabilities (
  id uuid primary key,
  connection_id uuid not null references mcp_connections(id) on delete restrict,
  actor_user_id uuid not null references users(id) on delete cascade,
  content_item_id uuid not null references content_items(id) on delete cascade,
  reserved_media_asset_id uuid not null unique,
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  media_kind text not null check (media_kind in ('image', 'video')),
  mime_type text not null check (mime_type in (
    'image/jpeg', 'image/png', 'image/webp',
    'video/mp4', 'video/quicktime', 'video/webm'
  )),
  origin_classification text not null check (origin_classification in (
    'ai_assisted', 'ai_generated', 'materially_ai_manipulated'
  )),
  source_kind text not null check (source_kind in ('generated', 'edited', 'composited', 'unknown')),
  source_lineage_reference text,
  workflow_provider_reference text,
  c2pa_reference text,
  state text not null default 'pending' check (state in ('pending', 'provisioning', 'consumed', 'revoked')),
  lease_token uuid,
  leased_until timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_failure_code text,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, request_hash),
  check (expires_at > created_at),
  check ((lease_token is null) = (leased_until is null)),
  check (
    (state = 'provisioning' and lease_token is not null and consumed_at is null)
    or (state = 'consumed' and lease_token is null and consumed_at is not null)
    or (state in ('pending', 'revoked') and lease_token is null and consumed_at is null)
  ),
  check (
    source_lineage_reference is null
    or (
      char_length(source_lineage_reference) between 1 and 500
      and source_lineage_reference !~ '%'
      and (
        source_lineage_reference ~* '^https://([a-z0-9-]+\.)*c2pa\.org/(claims|manifests|assets|lineage)/([a-f0-9]{64}|[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})$'
        or source_lineage_reference ~* '^urn:(wevid|c2pa):[a-z0-9][a-z0-9-]{0,31}:([a-f0-9]{64}|[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})$'
      )
      and source_lineage_reference !~* '(prompt|api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|password|passwd|credential|private[-_ ]?key|client[-_ ]?secr[e]t|authorization|bearer|cookie|session[-_ ]?id)'
    )
  ),
  check (
    workflow_provider_reference is null
    or (
      char_length(workflow_provider_reference) between 1 and 120
      and workflow_provider_reference ~* '^([a-f0-9]{64}|[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})$'
      and workflow_provider_reference !~* '(prompt|api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|password|passwd|credential|private[-_ ]?key|client[-_ ]?secr[e]t|authorization|bearer|cookie|session[-_ ]?id)'
    )
  ),
  check (
    c2pa_reference is null
    or (
      char_length(c2pa_reference) between 1 and 500
      and c2pa_reference !~ '%'
      and (
        c2pa_reference ~* '^https://([a-z0-9-]+\.)*c2pa\.org/(claims|manifests|assets|lineage)/([a-f0-9]{64}|[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})$'
        or c2pa_reference ~* '^urn:(wevid|c2pa):[a-z0-9][a-z0-9-]{0,31}:([a-f0-9]{64}|[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})$'
      )
      and c2pa_reference !~* '(prompt|api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|password|passwd|credential|private[-_ ]?key|client[-_ ]?secr[e]t|authorization|bearer|cookie|session[-_ ]?id)'
    )
  ),
  check (last_failure_code is null or char_length(last_failure_code) between 1 and 120)
);

create index mcp_media_upload_capabilities_actor_created_idx
  on mcp_media_upload_capabilities (actor_user_id, created_at desc);

create index mcp_media_upload_capabilities_connection_state_idx
  on mcp_media_upload_capabilities (connection_id, state, expires_at);

create index mcp_media_upload_capabilities_recovery_idx
  on mcp_media_upload_capabilities (leased_until, updated_at)
  where state = 'provisioning';

alter table mcp_media_upload_capabilities enable row level security;
revoke all on table mcp_media_upload_capabilities from public, anon, authenticated;

create function private.content_composition_provenance_ready(p_content_item_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = public, private
as $$
  select coalesce(not exists (
    select 1
    from media_assets asset
    where asset.content_item_id = p_content_item_id
      and asset.retired_at is null
      and asset.required_for_release is true
      and asset.provenance_human_review_state in ('pending', 'rejected')
  ), false);
$$;

create or replace function private.content_safety_release_ready(p_content_item_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = public, private
as $$
  select
    private.content_composition_safety_ready(p_content_item_id)
    and private.content_composition_provenance_ready(p_content_item_id);
$$;

revoke all on function private.content_composition_provenance_ready(uuid)
  from public, anon, authenticated;

comment on table mcp_media_upload_capabilities is
  'Hash-only, one-time capability ledger for MCP media handoff. Never stores prompts, credentials, upload signatures, provider payloads, filenames, or media bytes.';
comment on column media_assets.source_kind is
  'Bounded creator-visible source category; opaque lineage remains separate and private.';
comment on function private.content_composition_provenance_ready(uuid) is
  'Fails release closed while any required active asset has pending or rejected provenance review.';
comment on function private.content_safety_release_ready(uuid) is
  'Canonical publication predicate requiring both normalized media safety and provenance readiness.';
