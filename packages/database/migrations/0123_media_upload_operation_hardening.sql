-- Reserve one durable logical operation before creating a Bunny Stream video.
-- Provider object identifiers are retained server-side so an HTTP retry can
-- re-sign the same object instead of provisioning a duplicate.

create table media_upload_operations (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references users(id) on delete cascade,
  content_item_id uuid not null references content_items(id) on delete cascade,
  media_asset_id uuid not null unique,
  idempotency_key text not null check (length(idempotency_key) between 1 and 255),
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  mime_type text not null check (mime_type in ('video/mp4', 'video/quicktime', 'video/webm')),
  provider media_provider not null default 'bunny' check (provider = 'bunny'),
  provider_asset_id text,
  state text not null check (
    state in (
      'provider_creation_claimed',
      'provider_created',
      'completed',
      'compensation_pending',
      'compensated'
    )
  ),
  failure_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (actor_user_id, idempotency_key),
  check (
    (state = 'provider_creation_claimed' and provider_asset_id is null)
    or (state <> 'provider_creation_claimed' and provider_asset_id is not null)
  )
);

create unique index media_upload_operations_provider_asset_uidx
  on media_upload_operations (provider, provider_asset_id)
  where provider_asset_id is not null;

create index media_upload_operations_content_state_idx
  on media_upload_operations (content_item_id, state, created_at);

create index media_upload_operations_actor_created_idx
  on media_upload_operations (actor_user_id, created_at);

alter table media_upload_operations enable row level security;
revoke all on table media_upload_operations from public, anon, authenticated;

comment on table media_upload_operations is
  'Server-only idempotency and compensation authority for direct creator video provisioning.';
comment on column media_upload_operations.provider_asset_id is
  'Opaque server-side Bunny VideoId; never serialize this reference to clients.';

