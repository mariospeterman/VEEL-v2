-- Veel V2 schema blueprint.
-- Convert this into proper Supabase/Postgres migrations slice-by-slice.
-- This is not a generated migration file. Each slice must add RLS policies,
-- indexes, updated_at triggers, audit writes, and rollback strategy.

create type staff_role as enum ('owner', 'admin', 'trust_safety', 'support', 'finance', 'ops', 'creator_success', 'event_ops', 'ai_ops', 'readonly_auditor');
create type age_state as enum ('not_required', 'required', 'pending', 'verified', 'failed');
create type content_state as enum ('draft', 'processing', 'ready', 'blocked', 'deleted');
create type media_provider as enum ('bunny', 'livepeer');
create type payment_state as enum ('pending', 'transaction_requested', 'submitted', 'confirmed', 'failed', 'expired');
create type payment_product_type as enum (
  'tip',
  'support',
  'content_unlock',
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
  state text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table profiles (
  user_id uuid primary key references users(id),
  handle text unique not null,
  display_name text not null,
  avatar_url text,
  bio text,
  location_label text,
  visibility text not null default 'public',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table staff_memberships (
  id uuid primary key,
  user_id uuid not null references users(id),
  role staff_role not null,
  state text not null default 'active',
  granted_by_user_id uuid references users(id),
  created_at timestamptz not null default now(),
  unique (user_id, role)
);

create table staff_permissions (
  id uuid primary key,
  user_id uuid not null references users(id),
  permission_key text not null,
  scope text not null default 'global',
  granted_by_user_id uuid references users(id),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, permission_key, scope)
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

create table creator_monetisation_settings (
  user_id uuid primary key references users(id),
  state text not null default 'active',
  earning_state text not null default 'not_configured',
  kyc_state text not null default 'not_required',
  tax_profile_state text not null default 'not_required',
  earnings_recipient_wallet_id uuid references wallets(id),
  tips_enabled boolean not null default true,
  content_unlocks_enabled boolean not null default true,
  live_passes_enabled boolean not null default true,
  paid_messages_enabled boolean not null default true,
  subscriptions_enabled boolean not null default false,
  min_tip_amount_minor bigint not null default 1000000,
  default_currency text not null default 'SOL',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
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

create table content_access_rules (
  id uuid primary key,
  content_item_id uuid not null references content_items(id),
  access_type text not null,
  product_type payment_product_type,
  price_minor bigint,
  currency text,
  starts_at timestamptz,
  ends_at timestamptz,
  state text not null default 'active',
  created_at timestamptz not null default now()
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

create table content_reactions (
  user_id uuid not null references users(id),
  content_item_id uuid not null references content_items(id),
  reaction_key text not null default 'like',
  state text not null default 'active',
  created_at timestamptz not null default now(),
  primary key (user_id, content_item_id, reaction_key)
);

create table content_saves (
  user_id uuid not null references users(id),
  content_item_id uuid not null references content_items(id),
  state text not null default 'active',
  created_at timestamptz not null default now(),
  primary key (user_id, content_item_id)
);

create table share_records (
  id uuid primary key,
  actor_user_id uuid not null references users(id),
  target_type text not null,
  target_id uuid not null,
  mode text not null,
  referral_id uuid,
  destination text,
  state text not null default 'created',
  created_at timestamptz not null default now()
);

create table follows (
  follower_user_id uuid not null references users(id),
  followed_user_id uuid not null references users(id),
  state text not null default 'active',
  created_at timestamptz not null default now(),
  primary key (follower_user_id, followed_user_id)
);

create table comments (
  id uuid primary key,
  content_item_id uuid not null references content_items(id),
  user_id uuid not null references users(id),
  parent_comment_id uuid references comments(id),
  body text not null,
  moderation_state text not null default 'visible',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table reports (
  id uuid primary key,
  reporter_user_id uuid not null references users(id),
  subject_type text not null,
  subject_id uuid not null,
  reason text not null,
  state text not null default 'submitted',
  created_at timestamptz not null default now()
);

create table blocks (
  blocker_user_id uuid not null references users(id),
  blocked_user_id uuid not null references users(id),
  reason text,
  created_at timestamptz not null default now(),
  primary key (blocker_user_id, blocked_user_id)
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

create index payment_intents_created_at_idx
  on payment_intents (created_at desc);

create index payment_intents_submitted_signature_idx
  on payment_intents (submitted_signature)
  where submitted_signature is not null;

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

create table wallet_transaction_records (
  id uuid primary key,
  user_id uuid not null references users(id),
  wallet_id uuid references wallets(id),
  payment_intent_id uuid references payment_intents(id),
  chain text not null,
  direction text not null,
  amount_minor bigint not null,
  currency text not null,
  state text not null,
  source text not null default 'payment_intent',
  signature text,
  reference_address text,
  submitted_at timestamptz,
  confirmed_at timestamptz,
  created_at timestamptz not null default now()
);

create table settlement_ledger (
  id uuid primary key,
  payment_intent_id uuid not null references payment_intents(id),
  payment_transaction_id uuid references payment_transactions(id),
  account_kind text not null,
  account_user_id uuid references users(id),
  amount_minor bigint not null,
  currency text not null,
  direction text not null,
  state text not null default 'posted',
  created_at timestamptz not null default now()
);

create table payment_ledger_entries (
  id uuid primary key,
  payment_intent_id uuid not null references payment_intents(id),
  account_kind text not null,
  account_key text not null,
  account_user_id uuid references users(id),
  amount_minor bigint not null,
  currency text not null,
  direction text not null,
  state text not null default 'posted',
  created_at timestamptz not null default now(),
  unique (payment_intent_id, account_kind, account_key)
);

create table entitlements (
  id uuid primary key,
  user_id uuid not null references users(id),
  target_type text not null,
  target_id uuid not null,
  product_type payment_product_type not null,
  payment_intent_id uuid references payment_intents(id),
  state text not null default 'active',
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (payment_intent_id)
);

create index entitlements_granted_at_idx
  on entitlements (granted_at desc);

create table entitlement_events (
  id uuid primary key,
  entitlement_id uuid not null references entitlements(id),
  actor_user_id uuid references users(id),
  action text not null,
  payment_intent_id uuid references payment_intents(id),
  created_at timestamptz not null default now()
);

create table referrals (
  id uuid primary key,
  referrer_user_id uuid not null references users(id),
  referred_user_id uuid references users(id),
  token text unique not null,
  state text not null default 'link_created',
  created_at timestamptz not null default now()
);

create table referral_tokens (
  id uuid primary key,
  creator_user_id uuid not null references users(id),
  token text unique not null,
  target_type text not null,
  target_id uuid not null,
  channel text not null,
  eligibility text not null,
  state text not null default 'active',
  idempotency_key text not null,
  request_hash text not null,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  unique (creator_user_id, idempotency_key)
);

create table referral_attributions (
  id uuid primary key,
  referral_token_id uuid not null references referral_tokens(id),
  referrer_user_id uuid not null references users(id),
  referred_user_id uuid not null references users(id),
  payment_intent_id uuid not null references payment_intents(id),
  state text not null default 'attributed',
  rejection_reason text,
  created_at timestamptz not null default now(),
  unique (payment_intent_id)
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

create table referral_commissions (
  id uuid primary key,
  referral_attribution_id uuid not null references referral_attributions(id),
  referral_token_id uuid not null references referral_tokens(id),
  payment_intent_id uuid not null references payment_intents(id),
  referrer_user_id uuid not null references users(id),
  referred_user_id uuid not null references users(id),
  amount_minor bigint not null,
  currency text not null,
  state text not null default 'pending',
  created_at timestamptz not null default now(),
  unique (payment_intent_id, referral_token_id)
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
  access_rule text not null default 'public_sale',
  state text not null default 'draft',
  idempotency_key text not null,
  request_hash text not null,
  created_at timestamptz not null default now()
);

create index events_creator_created_at_idx
  on events (creator_user_id, created_at desc);

create index events_state_starts_at_idx
  on events (state, starts_at);

create table ticket_types (
  id uuid primary key,
  event_id uuid not null references events(id),
  label text not null,
  price_minor integer,
  currency text not null,
  capacity integer not null,
  sale_starts_at timestamptz,
  sale_ends_at timestamptz,
  per_user_limit integer,
  state text not null default 'active',
  created_at timestamptz not null default now()
);

create index ticket_types_event_state_idx
  on ticket_types (event_id, state);

create table ticket_entitlements (
  id uuid primary key,
  event_id uuid not null references events(id),
  ticket_type_id uuid references ticket_types(id),
  holder_user_id uuid not null references users(id),
  payment_intent_id uuid references payment_intents(id),
  qr_token text unique not null,
  qr_token_hash text unique not null,
  state text not null default 'active',
  checked_in_at timestamptz,
  created_at timestamptz not null default now()
);

create index ticket_entitlements_holder_idx
  on ticket_entitlements (holder_user_id, created_at desc);

create index ticket_entitlements_event_idx
  on ticket_entitlements (event_id, state, created_at desc);

create index ticket_entitlements_ticket_type_id_idx
  on ticket_entitlements (ticket_type_id);

create table ticket_reservations (
  id uuid primary key,
  event_id uuid not null references events(id),
  ticket_type_id uuid references ticket_types(id),
  user_id uuid not null references users(id),
  payment_intent_id uuid references payment_intents(id),
  expires_at timestamptz not null,
  state text not null default 'held',
  created_at timestamptz not null default now()
);

create table ticket_purchase_requests (
  payment_intent_id uuid primary key references payment_intents(id),
  event_id uuid not null references events(id),
  ticket_type_id uuid not null references ticket_types(id),
  buyer_user_id uuid not null references users(id),
  amount_minor bigint not null,
  currency text not null default 'SOL',
  state text not null default 'pending_payment',
  created_at timestamptz not null default now()
);

create index ticket_purchase_requests_buyer_idx
  on ticket_purchase_requests (buyer_user_id, created_at desc);

create index ticket_purchase_requests_event_id_idx
  on ticket_purchase_requests (event_id);

create index ticket_purchase_requests_ticket_type_id_idx
  on ticket_purchase_requests (ticket_type_id);

create table ticket_requests (
  id uuid primary key,
  event_id uuid not null references events(id),
  ticket_type_id uuid references ticket_types(id),
  requester_user_id uuid not null references users(id),
  note text,
  state text not null default 'requested',
  reviewed_by_user_id uuid references users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create index ticket_requests_requester_idx
  on ticket_requests (requester_user_id, created_at desc);

create index ticket_requests_ticket_type_id_idx
  on ticket_requests (ticket_type_id);

create index ticket_requests_reviewed_by_user_id_idx
  on ticket_requests (reviewed_by_user_id)
  where reviewed_by_user_id is not null;

create table dating_profiles (
  user_id uuid primary key references users(id),
  enabled boolean not null default false,
  consent_version text,
  active_match_limit integer not null default 10,
  visible_on_media boolean not null default true,
  safety_state text not null default 'clear',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table dating_swipes (
  id uuid primary key,
  actor_user_id uuid not null references users(id),
  target_user_id uuid not null references users(id),
  content_item_id uuid references content_items(id),
  action text not null,
  idempotency_key text not null,
  request_hash text not null,
  created_at timestamptz not null default now()
);

create unique index dating_swipes_content_unique
  on dating_swipes (actor_user_id, target_user_id, content_item_id)
  where content_item_id is not null;

create unique index dating_swipes_profile_unique
  on dating_swipes (actor_user_id, target_user_id)
  where content_item_id is null;

create index dating_swipes_target_action_idx
  on dating_swipes (target_user_id, actor_user_id, action, created_at desc);

create index dating_swipes_content_item_id_idx
  on dating_swipes (content_item_id)
  where content_item_id is not null;

create table dating_matches (
  id uuid primary key,
  user_a_id uuid not null references users(id),
  user_b_id uuid not null references users(id),
  source_content_item_id uuid references content_items(id),
  conversation_id uuid references conversations(id),
  state text not null default 'active',
  archived_by_user_id uuid references users(id),
  stale_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index dating_matches_pair_unique
  on dating_matches (user_a_id, user_b_id);

create index dating_matches_user_a_state_idx
  on dating_matches (user_a_id, state, created_at desc);

create index dating_matches_user_b_state_idx
  on dating_matches (user_b_id, state, created_at desc);

create index dating_matches_source_content_idx
  on dating_matches (source_content_item_id)
  where source_content_item_id is not null;

create index dating_matches_archived_by_user_id_idx
  on dating_matches (archived_by_user_id)
  where archived_by_user_id is not null;

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

create index provider_events_received_at_idx
  on provider_events (received_at desc);

create table provider_webhook_receipts (
  id uuid primary key,
  provider text not null,
  webhook_type text not null,
  signature_hash text,
  idempotency_key text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  state text not null default 'received',
  unique (provider, webhook_type, idempotency_key)
);

create table provider_reconciliation_events (
  id uuid primary key,
  provider text not null,
  subject_type text not null,
  subject_id uuid,
  normalized_state text not null,
  raw_payload_redacted jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table idempotency_keys (
  key text primary key,
  actor_user_id uuid references users(id),
  scope text not null,
  request_hash text not null,
  response_status integer,
  response_body jsonb,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table notification_preferences (
  user_id uuid primary key references users(id),
  messages_enabled boolean not null default true,
  live_enabled boolean not null default true,
  payments_enabled boolean not null default true,
  dating_enabled boolean not null default true,
  safety_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

create table notification_devices (
  id uuid primary key,
  user_id uuid not null references users(id),
  provider text not null,
  token_hash text not null,
  platform text not null,
  state text not null default 'active',
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  unique (provider, token_hash)
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

create table performer_consents (
  id uuid primary key,
  content_item_id uuid references content_items(id),
  performer_user_id uuid references users(id),
  legal_name_hash text,
  consent_reference text,
  age_verification_id uuid references age_verifications(id),
  state text not null default 'pending',
  created_at timestamptz not null default now()
);

create table moderation_appeals (
  id uuid primary key,
  moderation_review_id uuid not null references moderation_reviews(id),
  appellant_user_id uuid not null references users(id),
  body text not null,
  state text not null default 'submitted',
  decided_by_user_id uuid references users(id),
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

create table refunds_and_disputes (
  id uuid primary key,
  payment_intent_id uuid references payment_intents(id),
  reporter_user_id uuid references users(id),
  kind text not null,
  reason text not null,
  state text not null default 'opened',
  resolution text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table data_subject_requests (
  id uuid primary key,
  user_id uuid not null references users(id),
  request_type text not null,
  state text not null default 'submitted',
  requested_at timestamptz not null default now(),
  completed_at timestamptz
);

create table support_cases (
  id uuid primary key,
  requester_user_id uuid references users(id),
  assigned_staff_user_id uuid references users(id),
  subject_type text,
  subject_id uuid,
  category text not null,
  state text not null default 'open',
  created_at timestamptz not null default now(),
  closed_at timestamptz
);

create table admin_action_records (
  id uuid primary key,
  admin_user_id uuid not null references users(id),
  subject_type text not null,
  subject_id uuid,
  action text not null,
  reason text,
  confirmation_hash text,
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

-- Required migration checklist for each implemented slice:
-- 1. Enable RLS on user-visible tables before exposing direct Supabase access.
-- 2. Add policy tests for every RLS policy.
-- 3. Add indexes for foreign keys, feed queries, moderation queues, provider lookups, and audit lookups.
-- 4. Add updated_at triggers for mutable tables.
-- 5. Store provider raw payloads only in redacted/restricted reconciliation tables.
-- 6. Use idempotency keys for money, access, ticket, age, wallet, moderation, admin, and webhook mutations.
-- 7. Verify OpenAPI product_type enums match payment_product_type exactly.
