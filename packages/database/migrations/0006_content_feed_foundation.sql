-- Home feed read-model foundation.
-- Provider playback URLs and entitlement decisions are added in later media/payment slices.

create type content_state as enum (
  'draft',
  'processing',
  'ready',
  'blocked',
  'deleted'
);

create type media_provider as enum (
  'bunny',
  'livepeer'
);

create table content_items (
  id uuid primary key,
  creator_user_id uuid not null references users(id),
  media_type text not null,
  state content_state not null default 'draft',
  caption text,
  visibility text not null default 'public',
  nsfw_label text not null default 'none',
  moderation_state text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table media_assets (
  id uuid primary key,
  content_item_id uuid not null references content_items(id),
  provider media_provider not null,
  provider_asset_id text not null,
  provider_state text not null,
  poster_url text,
  teaser_start_ms integer,
  teaser_end_ms integer,
  duration_ms integer,
  created_at timestamptz not null default now(),
  unique (provider, provider_asset_id)
);

create index content_items_home_feed_idx
  on content_items (created_at desc)
  where state = 'ready' and visibility = 'public' and moderation_state = 'approved';

create index content_items_creator_created_idx
  on content_items (creator_user_id, created_at desc);

create index media_assets_content_item_idx
  on media_assets (content_item_id, created_at asc);
