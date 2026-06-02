-- Veel V2 schema blueprint.
-- Convert this into proper migrations slice-by-slice.

create type user_role as enum ('user', 'creator', 'moderator', 'admin', 'owner');
create type age_state as enum ('not_required', 'required', 'pending', 'verified', 'failed');
create type content_state as enum ('draft', 'processing', 'ready', 'blocked', 'deleted');
create type media_provider as enum ('bunny', 'livepeer');
create type payment_state as enum ('pending', 'transaction_requested', 'confirmed', 'failed', 'expired');
create type payment_product_type as enum (
  'tip',
  'support',
  'unlock',
  'paid_message',
  'live_pass',
  'event_ticket',
  'creator_subscription',
  'platform_subscription'
);
create type entitlement_type as enum (
  'content_unlock',
  'live_pass',
  'event_ticket',
  'creator_subscription',
  'platform_subscription',
  'paid_message'
);
create type dating_action as enum ('yes', 'not_interested');

create table users (
  id uuid primary key,
  supabase_user_id uuid unique not null,
  handle text unique not null,
  display_name text not null,
  avatar_url text,
  role user_role not null default 'user',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table wallets (
  id uuid primary key,
  user_id uuid not null references users(id),
  provider text not null,
  address text not null,
  chain text not null,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  unique (chain, address)
);

create table age_verifications (
  id uuid primary key,
  user_id uuid not null references users(id),
  provider text not null,
  provider_reference text not null,
  state age_state not null,
  jurisdiction text,
  rule text,
  verified_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  unique (provider, provider_reference)
);

create table creator_accounts (
  user_id uuid primary key references users(id),
  monetisation_enabled boolean not null default false,
  kyc_required boolean not null default false,
  kyc_state text not null default 'not_required',
  payout_wallet_id uuid references wallets(id),
  created_at timestamptz not null default now()
);

create table user_badges (
  id uuid primary key,
  user_id uuid not null references users(id),
  badge_key text not null,
  badge_group text not null,
  visibility text not null default 'public',
  granted_by_user_id uuid references users(id),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, badge_key)
);

create table ranking_snapshots (
  id uuid primary key,
  scope text not null,
  subject_user_id uuid not null references users(id),
  rank integer not null,
  score numeric not null,
  reason text,
  visible boolean not null default true,
  calculated_at timestamptz not null default now()
);

create table viewer_feed_preferences (
  user_id uuid primary key references users(id),
  default_feed_mode text not null default 'recommended',
  nsfw_preference text not null default 'recommended',
  updated_at timestamptz not null default now()
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

create table hashtags (
  id uuid primary key,
  slug text unique not null,
  display_name text not null,
  state text not null default 'active',
  created_at timestamptz not null default now()
);

create table content_hashtags (
  content_item_id uuid not null references content_items(id),
  hashtag_id uuid not null references hashtags(id),
  primary key (content_item_id, hashtag_id)
);

create table content_mentions (
  id uuid primary key,
  content_item_id uuid not null references content_items(id),
  mentioned_user_id uuid not null references users(id),
  source text not null,
  state text not null default 'pending',
  created_at timestamptz not null default now()
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

create table live_rooms (
  id uuid primary key,
  creator_user_id uuid not null references users(id),
  content_item_id uuid references content_items(id),
  provider media_provider not null default 'livepeer',
  provider_stream_id text unique,
  state text not null default 'scheduled',
  access_rule text not null default 'pass_required',
  teaser_seconds integer not null default 60,
  pass_durations_minutes integer[] not null default array[30, 60, 180],
  starts_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now()
);

create table engagement_events (
  id uuid primary key,
  user_id uuid not null references users(id),
  content_item_id uuid not null references content_items(id),
  kind text not null,
  state text not null default 'active',
  created_at timestamptz not null default now(),
  unique (user_id, content_item_id, kind)
);

create table conversations (
  id uuid primary key,
  type text not null,
  created_at timestamptz not null default now()
);

create table conversation_members (
  conversation_id uuid not null references conversations(id),
  user_id uuid not null references users(id),
  role text not null default 'member',
  primary key (conversation_id, user_id)
);

create table messages (
  id uuid primary key,
  conversation_id uuid not null references conversations(id),
  sender_user_id uuid not null references users(id),
  body text not null,
  paid_access_state text,
  created_at timestamptz not null default now()
);

create table payment_intents (
  id uuid primary key,
  product_type payment_product_type not null,
  payer_user_id uuid not null references users(id),
  creator_user_id uuid references users(id),
  target_id uuid not null,
  amount_minor bigint not null,
  currency text not null,
  solana_reference text unique not null,
  state payment_state not null default 'pending',
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table payment_splits (
  id uuid primary key,
  payment_intent_id uuid not null references payment_intents(id),
  recipient_kind text not null,
  recipient_wallet_address text not null,
  amount_minor bigint not null
);

create table payment_transactions (
  id uuid primary key,
  payment_intent_id uuid not null references payment_intents(id),
  signature text unique not null,
  payer_wallet_address text not null,
  raw_confirmed_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table entitlements (
  id uuid primary key,
  user_id uuid not null references users(id),
  type entitlement_type not null,
  target_id uuid not null,
  payment_intent_id uuid references payment_intents(id),
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  state text not null default 'active',
  unique (user_id, type, target_id)
);

create table referrals (
  id uuid primary key,
  referrer_user_id uuid not null references users(id),
  referred_user_id uuid references users(id),
  token text unique not null,
  state text not null default 'link_created',
  created_at timestamptz not null default now()
);

create table partner_referral_campaigns (
  id uuid primary key,
  created_by_admin_user_id uuid not null references users(id),
  code text unique not null,
  label text not null,
  commission_rule jsonb not null default '{}'::jsonb,
  cap_amount_minor bigint,
  expires_at timestamptz,
  state text not null default 'active',
  created_at timestamptz not null default now()
);

create table commissions (
  id uuid primary key,
  referral_id uuid not null references referrals(id),
  payment_intent_id uuid not null references payment_intents(id),
  referrer_user_id uuid not null references users(id),
  amount_minor bigint not null,
  currency text not null,
  state text not null default 'pending',
  created_at timestamptz not null default now(),
  unique (payment_intent_id, referral_id)
);

create table platform_subscriptions (
  id uuid primary key,
  user_id uuid not null references users(id),
  tier text not null,
  provider text not null,
  provider_reference text,
  state text not null,
  renews_at timestamptz,
  created_at timestamptz not null default now()
);

create table creator_subscriptions (
  id uuid primary key,
  subscriber_user_id uuid not null references users(id),
  creator_user_id uuid not null references users(id),
  provider text not null,
  provider_reference text,
  state text not null,
  renews_at timestamptz,
  created_at timestamptz not null default now(),
  unique (subscriber_user_id, creator_user_id)
);

create table events (
  id uuid primary key,
  creator_user_id uuid not null references users(id),
  content_item_id uuid references content_items(id),
  title text not null,
  description text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  event_type text not null default 'physical',
  location_type text not null,
  location_label text,
  location_lat numeric,
  location_lng numeric,
  location_provider text,
  location_provider_ref text,
  capacity integer not null,
  ticket_price_minor integer,
  access_rule text not null default 'public_sale',
  state text not null default 'draft',
  created_at timestamptz not null default now()
);

create table ticket_entitlements (
  id uuid primary key,
  event_id uuid not null references events(id),
  holder_user_id uuid not null references users(id),
  payment_intent_id uuid references payment_intents(id),
  qr_token_hash text unique not null,
  state text not null default 'active',
  checked_in_at timestamptz,
  created_at timestamptz not null default now()
);

create table dating_profiles (
  user_id uuid primary key references users(id),
  enabled boolean not null default false,
  consent_version text,
  active_match_limit integer not null default 20,
  visible_on_media boolean not null default true,
  created_at timestamptz not null default now()
);

create table dating_swipes (
  id uuid primary key,
  actor_user_id uuid not null references users(id),
  target_user_id uuid not null references users(id),
  content_item_id uuid references content_items(id),
  action dating_action not null,
  created_at timestamptz not null default now(),
  unique (actor_user_id, target_user_id, content_item_id)
);

create table dating_matches (
  id uuid primary key,
  user_a_id uuid not null references users(id),
  user_b_id uuid not null references users(id),
  conversation_id uuid references conversations(id),
  state text not null default 'active',
  created_at timestamptz not null default now()
);

create table provider_events (
  id uuid primary key,
  provider text not null,
  provider_event_id text not null,
  event_type text not null,
  normalized_state text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (provider, provider_event_id)
);

create table moderation_reviews (
  id uuid primary key,
  subject_type text not null,
  subject_id uuid not null,
  reason text not null,
  state text not null default 'queued',
  assigned_admin_user_id uuid references users(id),
  decision text,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

create table ai_tool_calls (
  id uuid primary key,
  actor_user_id uuid references users(id),
  role_scope text not null,
  tool_name text not null,
  subject_type text,
  subject_id uuid,
  input_redacted jsonb not null default '{}'::jsonb,
  output_redacted jsonb not null default '{}'::jsonb,
  confirmation_required boolean not null default false,
  confirmed_at timestamptz,
  created_at timestamptz not null default now()
);

create table audit_events (
  id uuid primary key,
  actor_user_id uuid references users(id),
  subject_type text not null,
  subject_id uuid,
  action text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
