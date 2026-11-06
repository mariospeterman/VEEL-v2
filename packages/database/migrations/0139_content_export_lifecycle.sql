-- Creator-owned content export lifecycle.
--
-- data_requests remains the privacy lifecycle authority. An export request owns
-- exactly one revision-pinned, server-only export job. Provider references and
-- archive object keys never enter browser-readable tables or Realtime.

alter table data_requests
  add constraint data_requests_state_export_transition_check
  check (state in (
    'requested', 'verifying', 'processing', 'completed', 'rejected', 'cancelled', 'failed'
  )) not valid;

alter table data_requests
  validate constraint data_requests_state_export_transition_check;

alter table data_requests
  drop constraint data_requests_state_check;

alter table data_requests
  add constraint data_requests_state_check
  check (state in (
    'requested', 'verifying', 'processing', 'completed', 'rejected', 'cancelled', 'failed'
  )) not valid;

alter table data_requests
  validate constraint data_requests_state_check;

alter table data_requests
  drop constraint data_requests_state_export_transition_check;

create table content_export_jobs (
  id uuid primary key,
  data_request_id uuid not null unique references data_requests(id) on delete restrict,
  requester_user_id uuid not null references users(id) on delete restrict,
  state text not null default 'queued' check (state in (
    'queued', 'processing', 'retry', 'ready', 'cancelled', 'dead_letter', 'expired'
  )),
  progress_total_items integer not null default 0 check (progress_total_items >= 0),
  progress_completed_items integer not null default 0 check (progress_completed_items >= 0),
  progress_available_items integer not null default 0 check (progress_available_items >= 0),
  progress_unavailable_items integer not null default 0 check (progress_unavailable_items >= 0),
  attempt_count integer not null default 0 check (attempt_count between 0 and 8),
  next_attempt_at timestamptz,
  lease_token uuid,
  leased_until timestamptz,
  cancel_requested_at timestamptz,
  last_error_code text check (
    last_error_code is null or (
      char_length(last_error_code) between 1 and 120
      and last_error_code ~ '^[a-z0-9_]+$'
    )
  ),
  archive_object_key text not null unique check (
    archive_object_key ~ '^exports/[0-9a-f-]{36}/[0-9a-f-]{36}\.tar$'
  ),
  archive_byte_size bigint check (archive_byte_size is null or archive_byte_size > 0),
  archive_sha256 text check (archive_sha256 is null or archive_sha256 ~ '^[a-f0-9]{64}$'),
  archive_upload_started_at timestamptz,
  archive_ready_at timestamptz,
  downloadable_until timestamptz,
  cleanup_state text not null default 'not_ready' check (cleanup_state in (
    'not_ready', 'retained_private', 'manual_confirmation_required', 'manual_delete_confirmed'
  )),
  source_hold_until timestamptz not null,
  snapshot_created_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (progress_completed_items <= progress_total_items),
  check (progress_available_items + progress_unavailable_items <= progress_completed_items),
  check ((lease_token is null) = (leased_until is null)),
  check (source_hold_until > snapshot_created_at),
  check (
    (state = 'processing' and lease_token is not null and next_attempt_at is null)
    or (state in ('queued', 'retry') and lease_token is null and next_attempt_at is not null)
    or (state in ('ready', 'cancelled', 'dead_letter', 'expired') and lease_token is null and next_attempt_at is null)
  ),
  check (
    (
      state = 'ready'
      and archive_byte_size is not null
      and archive_sha256 is not null
      and archive_upload_started_at is not null
      and archive_ready_at is not null
      and downloadable_until is not null
      and downloadable_until > archive_ready_at
      and cleanup_state = 'retained_private'
    )
    or (
      state = 'expired'
      and archive_byte_size is not null
      and archive_sha256 is not null
      and archive_upload_started_at is not null
      and archive_ready_at is not null
      and downloadable_until is not null
      and cleanup_state in ('manual_confirmation_required', 'manual_delete_confirmed')
    )
    or (
      state in ('queued', 'processing', 'retry', 'cancelled', 'dead_letter')
      and archive_byte_size is null
      and archive_sha256 is null
      and archive_ready_at is null
      and downloadable_until is null
      and (
        (cleanup_state = 'not_ready' and archive_upload_started_at is null)
        or (
          cleanup_state = 'manual_confirmation_required'
          and archive_upload_started_at is not null
        )
      )
    )
  )
);

create table content_export_job_contents (
  job_id uuid not null references content_export_jobs(id) on delete restrict,
  content_item_id uuid not null references content_items(id) on delete restrict,
  composition_revision bigint not null check (composition_revision > 0),
  media_type text not null,
  content_state text not null,
  publish_state text not null,
  visibility text not null,
  nsfw_label text not null,
  moderation_state text not null,
  caption text,
  body_text text,
  content_created_at timestamptz not null,
  content_updated_at timestamptz not null,
  primary key (job_id, content_item_id)
);

create table content_export_job_items (
  job_id uuid not null,
  content_item_id uuid not null,
  media_asset_id uuid not null references media_assets(id) on delete restrict,
  composition_revision bigint not null check (composition_revision > 0),
  asset_kind text not null check (asset_kind in ('image', 'video')),
  position smallint,
  mime_type text,
  width_pixels integer,
  height_pixels integer,
  duration_ms integer,
  source_checksum_sha256 text check (
    source_checksum_sha256 is null or source_checksum_sha256 ~ '^[a-f0-9]{64}$'
  ),
  retired_at timestamptz,
  source_provider text not null check (source_provider in ('bunny', 'livepeer')),
  source_object_reference text not null check (
    char_length(source_object_reference) between 1 and 500
    and source_object_reference !~ '[[:cntrl:]]'
  ),
  source_retention_class text not null check (source_retention_class in (
    'provider_original', 'sanitized_retained_source'
  )),
  initial_unavailable_reason text check (
    initial_unavailable_reason is null or initial_unavailable_reason in (
      'provider_original_export_not_supported', 'provider_object_retired',
      'provider_cleanup_already_leased', 'content_restricted_by_safety_or_takedown'
    )
  ),
  state text not null default 'pending' check (state in ('pending', 'exported', 'unavailable')),
  unavailable_reason text check (
    unavailable_reason is null or (
      char_length(unavailable_reason) between 1 and 120
      and unavailable_reason ~ '^[a-z0-9_]+$'
    )
  ),
  archive_path text check (
    archive_path is null or archive_path ~ '^content/[0-9a-f-]{36}/assets/[0-9a-f-]{36}\.[a-z0-9]{1,8}$'
  ),
  exported_byte_size bigint check (exported_byte_size is null or exported_byte_size > 0),
  exported_sha256 text check (exported_sha256 is null or exported_sha256 ~ '^[a-f0-9]{64}$'),
  processed_at timestamptz,
  primary key (job_id, media_asset_id),
  foreign key (job_id, content_item_id)
    references content_export_job_contents(job_id, content_item_id) on delete restrict,
  check (
    (
      state = 'pending'
      and unavailable_reason is null
      and archive_path is null
      and exported_byte_size is null
      and exported_sha256 is null
      and processed_at is null
    )
    or (
      state = 'exported'
      and unavailable_reason is null
      and archive_path is not null
      and exported_byte_size is not null
      and exported_sha256 is not null
      and processed_at is not null
    )
    or (
      state = 'unavailable'
      and unavailable_reason is not null
      and archive_path is null
      and exported_byte_size is null
      and exported_sha256 is null
      and processed_at is not null
    )
  )
);

create table content_export_download_grants (
  id uuid primary key,
  job_id uuid not null references content_export_jobs(id) on delete restrict,
  requester_user_id uuid not null references users(id) on delete restrict,
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 128),
  expires_at timestamptz not null,
  last_accessed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  unique (requester_user_id, job_id, idempotency_key),
  check (expires_at > created_at)
);

create unique index content_export_jobs_requester_active_uidx
  on content_export_jobs (requester_user_id)
  where state in ('queued', 'processing', 'retry');

create index content_export_jobs_lease_due_idx
  on content_export_jobs (next_attempt_at, created_at, id)
  where state in ('queued', 'retry');

create index content_export_jobs_expiry_idx
  on content_export_jobs (downloadable_until, id)
  where state = 'ready' and cleanup_state = 'retained_private';

create index content_export_job_contents_content_idx
  on content_export_job_contents (content_item_id, job_id);

create index content_export_job_items_media_hold_idx
  on content_export_job_items (media_asset_id, job_id);

create index content_export_download_grants_expiry_idx
  on content_export_download_grants (expires_at, job_id);

alter table content_export_jobs enable row level security;
alter table content_export_job_contents enable row level security;
alter table content_export_job_items enable row level security;
alter table content_export_download_grants enable row level security;

revoke all on table
  content_export_jobs,
  content_export_job_contents,
  content_export_job_items,
  content_export_download_grants
from public, anon, authenticated;

comment on table content_export_jobs is
  'Server-only bounded export queue linked one-to-one to the authoritative export data_request.';
comment on table content_export_job_contents is
  'Revision-pinned minimized creator-owned content metadata snapshot; no messages, identity evidence, payment, wallet, or provider payload data.';
comment on table content_export_job_items is
  'Server-only retained-source inventory. Provider object references never appear in frontend resources.';
comment on column content_export_job_items.source_retention_class is
  'provider_original for retained Stream source bytes; sanitized_retained_source for re-encoded metadata-stripped image bytes.';
comment on column content_export_jobs.cleanup_state is
  'Any started upload is tracked as requiring confirmation until a complete private archive is linked; expired archives return to that quarantine. Migration 0139 wires no automated provider deletion.';
comment on column content_export_jobs.archive_upload_started_at is
  'Durable pre-upload fence. A non-ready row with this value requires explicit provider-object cleanup confirmation.';

create function private.snapshot_content_export_request(p_data_request_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = public, private, pg_temp
as $$
declare
  v_maximum_snapshot_rows constant integer := 20000;
  v_job_id uuid;
  v_requester_user_id uuid;
  v_request_state text;
  v_job_state text;
  v_error_code text;
  v_content_count integer := 0;
  v_asset_count integer := 0;
  v_limit_dimension text;
  v_observed_inventory_count integer := 0;
  v_created boolean := false;
begin
  select requester_user_id, state
  into v_requester_user_id, v_request_state
  from data_requests
  where id = p_data_request_id
    and type = 'export'
  for update;

  if v_requester_user_id is null then
    return null;
  end if;

  -- The owner row is the parent of every content row. Holding FOR UPDATE
  -- serializes new owner-content inserts through their FK key-share check while
  -- the bounded snapshot inventory is established.
  perform 1
  from users
  where id = v_requester_user_id
  for update;

  select id into v_job_id
  from content_export_jobs
  where data_request_id = p_data_request_id;

  if v_job_id is not null then
    return v_job_id;
  end if;

  v_job_id := gen_random_uuid();
  v_job_state := case
    when v_request_state in ('requested', 'verifying', 'processing') then 'queued'
    when v_request_state in ('rejected', 'cancelled') then 'cancelled'
    else 'dead_letter'
  end;
  v_error_code := case
    when v_request_state in ('completed', 'failed') then 'legacy_request_had_no_archive'
    else null
  end;

  -- A pre-migration database may contain more than one active lifecycle-only
  -- request even though the API serialized new requests. Preserve every row,
  -- but queue only one export per owner and make the duplicate explicit.
  if v_job_state = 'queued' and exists (
    select 1
    from content_export_jobs
    where requester_user_id = v_requester_user_id
      and state in ('queued', 'processing', 'retry')
  ) then
    v_job_state := 'dead_letter';
    v_error_code := 'legacy_duplicate_active_request';
  end if;

  insert into content_export_jobs (
    id,
    data_request_id,
    requester_user_id,
    state,
    next_attempt_at,
    last_error_code,
    archive_object_key,
    source_hold_until
  ) values (
    v_job_id,
    p_data_request_id,
    v_requester_user_id,
    v_job_state,
    case when v_job_state = 'queued' then clock_timestamp() else null end,
    v_error_code,
    'exports/' || v_requester_user_id::text || '/' || v_job_id::text || '.tar',
    clock_timestamp() + interval '24 hours'
  );
  v_created := true;

  -- Freeze and count no more than one sentinel row beyond the supported
  -- content bound. Composer mutations take the content row before changing an
  -- asset, so this deterministic content -> asset order prevents a snapshot
  -- from pairing revision-N metadata with revision-N+1 inventory. Nothing is
  -- written to either snapshot table until both bounded preflights pass.
  perform 1
  from content_items content
  where content.creator_user_id = v_requester_user_id
  order by content.created_at, content.id
  limit v_maximum_snapshot_rows + 1
  for update of content;

  get diagnostics v_content_count = row_count;

  if v_content_count > v_maximum_snapshot_rows then
    v_limit_dimension := 'content';
    v_observed_inventory_count := v_content_count;
  else
    perform 1
    from content_items content
    join media_assets asset on asset.content_item_id = content.id
    where content.creator_user_id = v_requester_user_id
    order by content.created_at, content.id, asset.created_at, asset.id
    limit v_maximum_snapshot_rows + 1
    for update of asset;

    get diagnostics v_asset_count = row_count;

    if v_asset_count > v_maximum_snapshot_rows then
      v_limit_dimension := 'asset';
      v_observed_inventory_count := v_asset_count;
    end if;
  end if;

  if v_limit_dimension is not null then
    update content_export_jobs
    set state = case when state = 'queued' then 'dead_letter' else state end,
        next_attempt_at = null,
        last_error_code = case
          when state = 'queued' then 'export_inventory_limit_exceeded'
          else coalesce(last_error_code, 'export_inventory_limit_exceeded')
        end,
        updated_at = clock_timestamp()
    where id = v_job_id;

    if v_job_state = 'queued' then
      update data_requests
      set state = 'failed',
          reason = 'export_inventory_limit_exceeded',
          completed_at = null,
          updated_at = clock_timestamp()
      where id = p_data_request_id
        and type = 'export';
    end if;

    insert into audit_events (
      id,
      actor_user_id,
      subject_type,
      subject_id,
      action,
      idempotency_key,
      metadata
    ) values (
      gen_random_uuid(),
      v_requester_user_id,
      'content_export',
      v_job_id,
      'content_export_snapshot_rejected',
      'content-export:snapshot-rejected:' || v_job_id::text,
      jsonb_build_object(
        'dataRequestId', p_data_request_id,
        'errorCode', 'export_inventory_limit_exceeded',
        'inventoryDimension', v_limit_dimension,
        'maximumRows', v_maximum_snapshot_rows,
        'observedRowsAtLeast', v_observed_inventory_count,
        'partialSnapshotPersisted', false
      )
    )
    on conflict (actor_user_id, action, idempotency_key)
      where actor_user_id is not null and idempotency_key is not null
    do nothing;

    return v_job_id;
  end if;

  insert into content_export_job_contents (
    job_id,
    content_item_id,
    composition_revision,
    media_type,
    content_state,
    publish_state,
    visibility,
    nsfw_label,
    moderation_state,
    caption,
    body_text,
    content_created_at,
    content_updated_at
  )
  select
    v_job_id,
    content.id,
    content.asset_revision,
    content.media_type,
    content.state::text,
    content.publish_state,
    content.visibility,
    content.nsfw_label,
    content.moderation_state,
    content.caption,
    content.body_text,
    content.created_at,
    content.updated_at
  from content_items content
  where content.creator_user_id = v_requester_user_id
  order by content.created_at, content.id;

  -- The bounded preflight already locked this exact asset inventory. If
  -- provider cleanup won first, the rows below record an honest unavailable
  -- item; if this transaction won, cleanup's second hold check sees this job.
  insert into content_export_job_items (
    job_id,
    content_item_id,
    media_asset_id,
    composition_revision,
    asset_kind,
    position,
    mime_type,
    width_pixels,
    height_pixels,
    duration_ms,
    source_checksum_sha256,
    retired_at,
    source_provider,
    source_object_reference,
    source_retention_class,
    initial_unavailable_reason,
    state,
    unavailable_reason,
    processed_at
  )
  select
    v_job_id,
    asset.content_item_id,
    asset.id,
    content.composition_revision,
    asset.asset_kind,
    asset.position,
    asset.mime_type,
    asset.width_pixels,
    asset.height_pixels,
    asset.duration_ms,
    asset.checksum_sha256,
    asset.retired_at,
    asset.provider::text,
    asset.provider_asset_id,
    case
      when asset.asset_kind = 'image' then 'sanitized_retained_source'
      else 'provider_original'
    end,
    case
      when content.content_state in ('blocked', 'deleted')
      then 'content_restricted_by_safety_or_takedown'
      when asset.provider_cleanup_lease_token is not null
      then 'provider_cleanup_already_leased'
      when asset.provider_cleanup_state = 'completed' then 'provider_object_retired'
      when asset.provider <> 'bunny' then 'provider_original_export_not_supported'
      else null
    end,
    case
      when content.content_state in ('blocked', 'deleted')
        or asset.provider_cleanup_lease_token is not null
        or asset.provider_cleanup_state = 'completed' or asset.provider <> 'bunny'
      then 'unavailable'
      else 'pending'
    end,
    case
      when content.content_state in ('blocked', 'deleted')
      then 'content_restricted_by_safety_or_takedown'
      when asset.provider_cleanup_lease_token is not null
      then 'provider_cleanup_already_leased'
      when asset.provider_cleanup_state = 'completed' then 'provider_object_retired'
      when asset.provider <> 'bunny' then 'provider_original_export_not_supported'
      else null
    end,
    case
      when content.content_state in ('blocked', 'deleted')
        or asset.provider_cleanup_lease_token is not null
        or asset.provider_cleanup_state = 'completed' or asset.provider <> 'bunny'
      then clock_timestamp()
      else null
    end
  from content_export_job_contents content
  join media_assets asset on asset.content_item_id = content.content_item_id
  where content.job_id = v_job_id
  order by content.content_created_at, content.content_item_id, asset.created_at, asset.id;

  update content_export_jobs job
  set
    progress_total_items = inventory.total_items,
    progress_completed_items = inventory.unavailable_items,
    progress_unavailable_items = inventory.unavailable_items,
    updated_at = clock_timestamp()
  from (
    select
      count(*)::integer as total_items,
      count(*) filter (where state = 'unavailable')::integer as unavailable_items
    from content_export_job_items
    where job_id = v_job_id
  ) inventory
  where job.id = v_job_id;

  if v_created then
    insert into audit_events (
      id,
      actor_user_id,
      subject_type,
      subject_id,
      action,
      idempotency_key,
      metadata
    )
    select
      gen_random_uuid(),
      v_requester_user_id,
      'content_export',
      v_job_id,
      'content_export_snapshot_created',
      'content-export:snapshot:' || v_job_id::text,
      jsonb_build_object(
        'dataRequestId', p_data_request_id,
        'contentCount', (select count(*) from content_export_job_contents where job_id = v_job_id),
        'itemCount', (select count(*) from content_export_job_items where job_id = v_job_id),
        'privacyBoundary', 'owned_content_minimized_no_messages_identity_payment_wallet_or_secrets'
      )
    on conflict (actor_user_id, action, idempotency_key)
      where actor_user_id is not null and idempotency_key is not null
    do nothing;
  end if;

  return v_job_id;
end;
$$;

create function private.create_content_export_job_after_data_request()
returns trigger
language plpgsql
security invoker
set search_path = public, private, pg_temp
as $$
begin
  if new.type = 'export' then
    perform private.snapshot_content_export_request(new.id);
  end if;
  return new;
end;
$$;

create trigger data_requests_create_content_export_job
after insert on data_requests
for each row
when (new.type = 'export')
execute function private.create_content_export_job_after_data_request();

revoke all on function private.snapshot_content_export_request(uuid)
  from public, anon, authenticated;
revoke all on function private.create_content_export_job_after_data_request()
  from public, anon, authenticated;

-- Existing lifecycle-only export requests become real jobs without claiming
-- that previously completed request rows ever produced an archive.
select private.snapshot_content_export_request(request.id)
from data_requests request
where request.type = 'export'
order by request.created_at, request.id;
