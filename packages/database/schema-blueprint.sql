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
  'event_access_pass',
  'creator_subscription',
  'platform_subscription'
);
create type entitlement_type as enum (
  'content_unlock',
  'live_pass',
  'event_access_pass',
  'creator_subscription',
  'platform_subscription',
  'paid_message'
);
create type mutual_interest_action as enum ('interested', 'not_interested');

-- Deprecated HTTP compatibility aliases stay at route boundaries only.
-- Database names use launch vocabulary: support, unlock, event_access_pass,
-- membership, mutual profiles/interests, and platform subscription tiers.

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

create table identity_verifications (
  id uuid primary key,
  user_id uuid not null references users(id),
  provider text not null,
  provider_reference text not null,
  verification_type text not null,
  state text not null default 'pending',
  country_code text,
  legal_name_hash text,
  document_type text,
  liveness_state text,
  wallet_ownership_state text,
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

create table organizations (
  id uuid primary key,
  name text not null,
  state text not null default 'pending_kyb',
  plan text not null default 'enterprise',
  kyb_state text,
  created_at timestamptz not null default now()
);

create table organization_memberships (
  id uuid primary key,
  organization_id uuid not null references organizations(id),
  user_id uuid not null references users(id),
  role text not null,
  state text not null default 'active',
  invited_by_user_id uuid references users(id),
  joined_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create table tax_profiles (
  id uuid primary key,
  user_id uuid references users(id),
  organization_id uuid references organizations(id),
  subject_type text not null,
  state text not null default 'draft',
  tax_residence_country text,
  tin_hash text,
  vat_id_hash text,
  vat_id_country text,
  is_business boolean not null default false,
  dac7_reportable boolean,
  carf_reportable boolean not null default false,
  carf_reporting_required boolean not null default false,
  current_version_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table tax_profile_versions (
  id uuid primary key,
  tax_profile_id uuid not null references tax_profiles(id),
  version_number integer not null,
  snapshot jsonb not null,
  collected_by_user_id uuid references users(id),
  created_at timestamptz not null default now(),
  unique (tax_profile_id, version_number)
);

create table seller_of_record_determinations (
  id uuid primary key,
  product_type text not null,
  seller_user_id uuid references users(id),
  buyer_user_id uuid references users(id),
  seller_of_record text not null default 'undetermined',
  determination_reason text not null,
  review_state text not null default 'clear',
  created_at timestamptz not null default now()
);

create table jurisdiction_tax_rules (
  id uuid primary key,
  jurisdiction text not null,
  product_type text not null,
  rule_key text not null,
  rule_payload jsonb not null default '{}'::jsonb,
  effective_from date not null,
  effective_to date,
  state text not null default 'active',
  created_at timestamptz not null default now(),
  unique (jurisdiction, product_type, rule_key, effective_from)
);

create table product_tax_matrix (
  id uuid primary key,
  product_type text not null,
  default_seller_of_record text not null,
  dac7_candidate boolean not null default false,
  carf_candidate boolean not null default false,
  vat_review_required boolean not null default true,
  counsel_status text not null default 'pending_review',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_type)
);

create table buyer_location_evidence (
  id uuid primary key,
  buyer_user_id uuid references users(id),
  payment_intent_id uuid,
  evidence_type text not null,
  country_code text,
  region_code text,
  confidence text not null default 'low',
  evidence_hash text,
  created_at timestamptz not null default now()
);

create table vat_determinations (
  id uuid primary key,
  payment_intent_id uuid,
  product_type text not null,
  seller_of_record text not null,
  seller_country text,
  buyer_country text,
  buyer_vat_id_hash text,
  vies_status text not null default 'not_checked',
  place_of_supply text,
  vat_status text not null default 'pending',
  vat_rate_bps integer,
  vat_amount_minor bigint,
  currency text not null,
  review_state text not null default 'clear',
  created_at timestamptz not null default now()
);

create table receipts (
  id uuid primary key,
  receipt_number text unique not null,
  buyer_user_id uuid references users(id),
  seller_user_id uuid references users(id),
  payment_intent_id uuid,
  product_type text not null,
  gross_amount_minor bigint not null,
  currency text not null,
  state text not null default 'issued',
  issued_at timestamptz not null default now()
);

create unique index receipts_payment_intent_id_uidx
  on receipts (payment_intent_id)
  where payment_intent_id is not null;

create table receipt_lines (
  id uuid primary key,
  receipt_id uuid not null references receipts(id),
  line_type text not null,
  description text not null,
  amount_minor bigint not null,
  currency text not null,
  created_at timestamptz not null default now()
);

create table payment_confirmation_deliveries (
  id uuid primary key,
  payment_intent_id uuid not null references payment_intents(id),
  receipt_id uuid references receipts(id),
  user_id uuid not null references users(id),
  channel text not null check (channel in ('in_app', 'email')),
  state text not null default 'queued'
    check (state in ('queued', 'processing', 'sent', 'provider_not_configured', 'failed')),
  durable_medium boolean not null default true,
  confirmation_version text not null default 'payment-confirmation-v1',
  terms_version text not null,
  withdrawal_waiver_version text not null,
  payload jsonb not null default '{}'::jsonb,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  leased_at timestamptz,
  failure_code text,
  provider_message_id text,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (payment_intent_id, channel)
);

create index payment_confirmation_deliveries_user_created_idx
  on payment_confirmation_deliveries (user_id, created_at desc);

create index payment_confirmation_deliveries_state_created_idx
  on payment_confirmation_deliveries (state, created_at desc);

create index payment_confirmation_deliveries_provider_message_id_idx
  on payment_confirmation_deliveries (provider_message_id)
  where provider_message_id is not null;

create table platform_fee_statements (
  id uuid primary key,
  payment_intent_id uuid,
  creator_user_id uuid references users(id),
  platform_fee_minor bigint not null,
  currency text not null,
  state text not null default 'recorded',
  created_at timestamptz not null default now()
);

create table vat_invoices (
  id uuid primary key,
  invoice_number text unique not null,
  receipt_id uuid references receipts(id),
  seller_user_id uuid references users(id),
  buyer_user_id uuid references users(id),
  seller_of_record text not null,
  total_amount_minor bigint not null,
  vat_amount_minor bigint not null,
  currency text not null,
  state text not null default 'issued',
  issued_at timestamptz not null default now()
);

create table vat_invoice_lines (
  id uuid primary key,
  vat_invoice_id uuid not null references vat_invoices(id),
  description text not null,
  net_amount_minor bigint not null,
  vat_rate_bps integer,
  vat_amount_minor bigint not null,
  currency text not null,
  created_at timestamptz not null default now()
);

create table tax_adjustments (
  id uuid primary key,
  payment_intent_id uuid,
  vat_determination_id uuid references vat_determinations(id),
  adjustment_type text not null,
  amount_minor bigint not null,
  currency text not null,
  reason text not null,
  created_by_user_id uuid references users(id),
  created_at timestamptz not null default now()
);

create table compliance_ledger_entries (
  id uuid primary key,
  event_type text not null,
  product_type text not null,
  settlement_model text not null,
  seller_user_id uuid references users(id),
  buyer_user_id uuid references users(id),
  seller_tax_profile_version_id uuid references tax_profile_versions(id),
  buyer_tax_profile_version_id uuid references tax_profile_versions(id),
  payment_intent_id uuid,
  entitlement_id uuid,
  receipt_id uuid references receipts(id),
  vat_invoice_id uuid references vat_invoices(id),
  gross_amount_minor bigint not null,
  platform_fee_minor bigint,
  creator_net_amount_minor bigint,
  tax_amount_minor bigint,
  currency text not null,
  fiat_currency text not null,
  fx_rate numeric,
  fx_observed_at timestamptz,
  seller_country text,
  buyer_country text,
  seller_of_record text not null default 'undetermined',
  vat_status text not null default 'pending',
  dac7_reportable boolean not null default false,
  carf_reportable boolean not null default false,
  immutable_hash text unique,
  previous_hash text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index compliance_ledger_entries_created_at_idx
  on compliance_ledger_entries (created_at desc);

create index compliance_ledger_entries_seller_idx
  on compliance_ledger_entries (seller_user_id, created_at desc)
  where seller_user_id is not null;

create index compliance_ledger_entries_buyer_idx
  on compliance_ledger_entries (buyer_user_id, created_at desc)
  where buyer_user_id is not null;

create table dac7_reports (
  id uuid primary key,
  reporting_year integer not null,
  jurisdiction text,
  state text not null default 'draft',
  line_count integer not null default 0,
  export_id uuid,
  created_at timestamptz not null default now(),
  exported_at timestamptz,
  unique (reporting_year, jurisdiction)
);

create table dac7_report_lines (
  id uuid primary key,
  report_id uuid not null references dac7_reports(id),
  seller_user_id uuid references users(id),
  tax_profile_version_id uuid references tax_profile_versions(id),
  gross_amount_minor bigint not null,
  platform_fee_minor bigint not null default 0,
  transaction_count integer not null default 0,
  currency text not null,
  review_state text not null default 'pending',
  created_at timestamptz not null default now()
);

create table carf_reports (
  id uuid primary key,
  reporting_year integer not null,
  jurisdiction text,
  state text not null default 'draft',
  carf_reporting_required boolean not null default false,
  line_count integer not null default 0,
  export_id uuid,
  created_at timestamptz not null default now(),
  exported_at timestamptz,
  unique (reporting_year, jurisdiction)
);

create table carf_report_lines (
  id uuid primary key,
  report_id uuid not null references carf_reports(id),
  user_id uuid references users(id),
  wallet_address text,
  tax_profile_version_id uuid references tax_profile_versions(id),
  gross_amount_minor bigint not null,
  transaction_count integer not null default 0,
  currency text not null,
  review_state text not null default 'pending',
  created_at timestamptz not null default now()
);

create table compliance_review_queue (
  id uuid primary key,
  subject_type text not null,
  subject_id uuid not null,
  queue_type text not null,
  priority text not null default 'normal',
  state text not null default 'open',
  assigned_staff_user_id uuid references users(id),
  reason text not null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create table compliance_exports (
  id uuid primary key,
  export_type text not null,
  reporting_year integer,
  state text not null default 'created',
  file_uri text,
  file_hash text,
  created_by_user_id uuid references users(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz
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

create table viewer_hidden_creators (
  user_id uuid not null references users(id),
  creator_user_id uuid not null references users(id),
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, creator_user_id)
);

create table viewer_hidden_topics (
  user_id uuid not null references users(id),
  topic text not null,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, topic)
);

create table content_items (
  id uuid primary key,
  creator_user_id uuid not null references users(id),
  media_type text not null,
  state content_state not null default 'draft',
  publish_state text not null default 'draft',
  publish_requested_at timestamptz,
  published_at timestamptz,
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
  thumbnail_frame_ms integer,
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
  last_idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, content_item_id, reaction_key)
);

create table content_saves (
  user_id uuid not null references users(id),
  content_item_id uuid not null references content_items(id),
  state text not null default 'active',
  last_idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, content_item_id)
);

create table engagement_action_receipts (
  actor_user_id uuid not null references users(id),
  action text not null,
  target_id uuid not null,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  primary key (actor_user_id, action, idempotency_key)
);

create table share_records (
  id uuid primary key,
  actor_user_id uuid not null references users(id),
  target_type text not null,
  target_id uuid not null,
  mode text not null,
  referral_id uuid,
  url text,
  state text not null default 'created',
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique (actor_user_id, idempotency_key)
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
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);

create table reports (
  id uuid primary key,
  reporter_user_id uuid not null references users(id),
  subject_type text not null,
  subject_id uuid not null,
  reason text not null,
  queue text not null,
  state text not null default 'submitted'
    check (state in ('submitted', 'queued', 'reviewing', 'resolved', 'escalated', 'rejected')),
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by_user_id uuid references users(id),
  unique (reporter_user_id, idempotency_key)
);

create table blocks (
  blocker_user_id uuid not null references users(id),
  blocked_user_id uuid not null references users(id),
  idempotency_key text not null,
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

create table subscription_plans (
  id text primary key,
  scope text not null,
  creator_user_id uuid references users(id),
  label text not null,
  amount_minor bigint not null,
  currency text not null default 'USDC',
  period_days integer not null,
  billing_mode text not null default 'delegated_solana_subscription',
  provider_state text not null default 'staging_required',
  token_mint text,
  token_program text,
  provider_plan_reference text,
  state text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table subscriptions (
  id uuid primary key,
  subscriber_user_id uuid not null references users(id),
  scope text not null,
  plan_id text not null references subscription_plans(id),
  creator_user_id uuid references users(id),
  state text not null default 'authorization_pending',
  renewal_mode text not null default 'delegated_solana_subscription',
  authority_address text,
  delegation_address text,
  subscriber_token_account text,
  collector_address text,
  provider_reference text,
  current_period_starts_at timestamptz,
  current_period_ends_at timestamptz,
  next_collection_at timestamptz,
  cancel_at_period_end boolean not null default false,
  cancelled_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index subscriptions_plan_id_idx
  on subscriptions (plan_id);

create table subscription_authorization_intents (
  id uuid primary key,
  subscription_id uuid not null references subscriptions(id),
  idempotency_key text not null,
  request_hash text not null,
  state text not null default 'created',
  authorization_mode text not null default 'delegated_solana_subscription',
  setup_reference text not null unique,
  transaction_request_url text,
  submitted_signature text unique,
  verified_signature text unique,
  expires_at timestamptz not null,
  submitted_at timestamptz,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  unique (subscription_id, idempotency_key)
);

create table subscription_collections (
  id uuid primary key,
  subscription_id uuid not null references subscriptions(id),
  period_starts_at timestamptz not null,
  period_ends_at timestamptz not null,
  amount_minor bigint not null,
  currency text not null,
  state text not null default 'due',
  collection_signature text unique,
  failure_code text,
  due_at timestamptz not null,
  submitted_at timestamptz,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (subscription_id, period_starts_at)
);

create table subscription_events (
  id uuid primary key,
  subscription_id uuid not null references subscriptions(id),
  actor_user_id uuid references users(id),
  action text not null,
  authorization_intent_id uuid references subscription_authorization_intents(id),
  collection_id uuid references subscription_collections(id),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index subscription_events_authorization_intent_id_idx
  on subscription_events (authorization_intent_id)
  where authorization_intent_id is not null;

create index subscription_events_collection_id_idx
  on subscription_events (collection_id)
  where collection_id is not null;

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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index events_creator_created_at_idx
  on events (creator_user_id, created_at desc);

create index events_state_starts_at_idx
  on events (state, starts_at);

create unique index events_content_item_id_unique_idx
  on events (content_item_id)
  where content_item_id is not null;

create table event_access_pass_types (
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

create index event_access_pass_types_event_state_idx
  on event_access_pass_types (event_id, state);

create table event_access_passes (
  id uuid primary key,
  event_id uuid not null references events(id),
  access_pass_type_id uuid references event_access_pass_types(id),
  holder_user_id uuid not null references users(id),
  payment_intent_id uuid references payment_intents(id),
  qr_token text unique not null,
  qr_token_hash text unique not null,
  state text not null default 'active',
  checked_in_at timestamptz,
  created_at timestamptz not null default now()
);

create index event_access_passes_holder_idx
  on event_access_passes (holder_user_id, created_at desc);

create index event_access_passes_event_idx
  on event_access_passes (event_id, state, created_at desc);

create index event_access_passes_access_pass_type_id_idx
  on event_access_passes (access_pass_type_id);

create table event_access_reservations (
  id uuid primary key,
  event_id uuid not null references events(id),
  access_pass_type_id uuid references event_access_pass_types(id),
  user_id uuid not null references users(id),
  payment_intent_id uuid references payment_intents(id),
  expires_at timestamptz not null,
  state text not null default 'held',
  created_at timestamptz not null default now()
);

create table event_access_purchase_requests (
  payment_intent_id uuid primary key references payment_intents(id),
  event_id uuid not null references events(id),
  access_pass_type_id uuid not null references event_access_pass_types(id),
  buyer_user_id uuid not null references users(id),
  amount_minor bigint not null,
  currency text not null default 'SOL',
  state text not null default 'pending_payment',
  created_at timestamptz not null default now(),
  check (amount_minor > 0),
  check (currency in ('SOL', 'USDC')),
  constraint event_access_purchase_requests_state_check
    check (state in ('pending_payment', 'access_pass_granted', 'cancelled'))
);

create index event_access_purchase_requests_buyer_idx
  on event_access_purchase_requests (buyer_user_id, created_at desc);

create index event_access_purchase_requests_event_id_idx
  on event_access_purchase_requests (event_id);

create index event_access_purchase_requests_access_pass_type_id_idx
  on event_access_purchase_requests (access_pass_type_id);

create table event_access_requests (
  id uuid primary key,
  event_id uuid not null references events(id),
  access_pass_type_id uuid references event_access_pass_types(id),
  requester_user_id uuid not null references users(id),
  note text,
  state text not null default 'requested',
  reviewed_by_user_id uuid references users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create index event_access_requests_requester_idx
  on event_access_requests (requester_user_id, created_at desc);

create index event_access_requests_access_pass_type_id_idx
  on event_access_requests (access_pass_type_id);

create index event_access_requests_reviewed_by_user_id_idx
  on event_access_requests (reviewed_by_user_id)
  where reviewed_by_user_id is not null;

create table mutual_profiles (
  user_id uuid primary key references users(id),
  enabled boolean not null default false,
  consent_version text,
  active_match_limit integer not null default 10,
  visible_on_media boolean not null default true,
  safety_state text not null default 'clear',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table mutual_interests (
  id uuid primary key,
  actor_user_id uuid not null references users(id),
  target_user_id uuid not null references users(id),
  content_item_id uuid references content_items(id),
  action text not null,
  idempotency_key text not null,
  request_hash text not null,
  created_at timestamptz not null default now()
);

create unique index mutual_interests_content_unique
  on mutual_interests (actor_user_id, target_user_id, content_item_id)
  where content_item_id is not null;

create unique index mutual_interests_profile_unique
  on mutual_interests (actor_user_id, target_user_id)
  where content_item_id is null;

create index mutual_interests_target_action_idx
  on mutual_interests (target_user_id, actor_user_id, action, created_at desc);

create index mutual_interests_content_item_id_idx
  on mutual_interests (content_item_id)
  where content_item_id is not null;

create table mutuals (
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

create unique index mutuals_pair_unique
  on mutuals (user_a_id, user_b_id);

create index mutuals_user_a_state_idx
  on mutuals (user_a_id, state, created_at desc);

create index mutuals_user_b_state_idx
  on mutuals (user_b_id, state, created_at desc);

create index mutuals_source_content_idx
  on mutuals (source_content_item_id)
  where source_content_item_id is not null;

create index mutuals_archived_by_user_id_idx
  on mutuals (archived_by_user_id)
  where archived_by_user_id is not null;

create table provider_events (
  id uuid primary key,
  provider text not null,
  provider_event_id text not null,
  event_type text not null,
  normalized_state text not null,
  replay_payload jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (provider, provider_event_id)
);

create index provider_events_received_at_idx
  on provider_events (received_at desc);

create index provider_events_replay_payload_gin_idx
  on provider_events using gin (replay_payload);

create table provider_event_replay_requests (
  id uuid primary key,
  provider_event_id uuid not null references provider_events(id) on delete cascade,
  requested_by_user_id uuid references users(id),
  idempotency_key text not null,
  reason text not null,
  state text not null default 'queued',
  attempt_count integer not null default 0,
  leased_at timestamptz,
  processed_at timestamptz,
  failure_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider_event_id, idempotency_key)
);

create index provider_event_replay_requests_state_created_idx
  on provider_event_replay_requests (state, created_at asc);

create index provider_event_replay_requests_provider_event_idx
  on provider_event_replay_requests (provider_event_id, created_at desc);

create index provider_event_replay_requests_requested_by_user_idx
  on provider_event_replay_requests (requested_by_user_id);

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

create table notifications (
  id uuid primary key,
  user_id uuid not null references users(id),
  kind text not null,
  title text not null,
  body text,
  action_url text,
  state text not null default 'unread',
  related_resource_type text,
  related_resource_id uuid,
  idempotency_key text,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  unique (user_id, idempotency_key)
);

create table notification_preferences (
  user_id uuid primary key references users(id),
  messages_enabled boolean not null default true,
  engagement_enabled boolean not null default true,
  live_enabled boolean not null default true,
  payments_enabled boolean not null default true,
  memberships_enabled boolean not null default true,
  event_access_enabled boolean not null default true,
  mutuals_enabled boolean not null default true,
  safety_enabled boolean not null default true,
  wallet_enabled boolean not null default true,
  creator_setup_enabled boolean not null default true,
  studio_setup_enabled boolean not null default true,
  push_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

create table notification_devices (
  id uuid primary key,
  user_id uuid not null references users(id),
  provider text not null,
  platform text not null,
  endpoint_hash text not null,
  p256dh_hash text not null,
  auth_hash text not null,
  endpoint_ciphertext text,
  endpoint_iv text,
  endpoint_tag text,
  p256dh_ciphertext text,
  p256dh_iv text,
  p256dh_tag text,
  auth_ciphertext text,
  auth_iv text,
  auth_tag text,
  user_agent text,
  state text not null default 'active',
  last_seen_at timestamptz,
  idempotency_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, endpoint_hash),
  unique (user_id, idempotency_key)
);

create table notification_delivery_attempts (
  id uuid primary key,
  notification_id uuid not null references notifications(id),
  device_id uuid not null references notification_devices(id),
  user_id uuid not null references users(id),
  provider text not null,
  state text not null default 'queued',
  failure_code text,
  attempt_count integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  leased_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (notification_id, device_id)
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
  payment_intent_id uuid not null references payment_intents(id),
  entitlement_id uuid references entitlements(id),
  reporter_user_id uuid not null references users(id),
  kind text not null,
  requested_action text not null,
  reason text not null,
  state text not null default 'opened',
  resolution text,
  custody_boundary text not null default 'no_platform_custody_no_payout_queue',
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  resolved_at timestamptz
);

create table refund_remediation_evidence (
  id uuid primary key,
  refund_dispute_id uuid not null references refunds_and_disputes(id) on delete cascade,
  payment_intent_id uuid not null references payment_intents(id),
  recorded_by_user_id uuid not null references users(id),
  evidence_type text not null,
  evidence_source text not null,
  external_reference text,
  amount_minor bigint,
  currency text,
  refund_value_basis text,
  refund_wallet text,
  notes text not null,
  custody_boundary text not null default 'evidence_only_no_platform_custody_no_payout_queue',
  idempotency_key text not null,
  created_at timestamptz not null default now()
);

create table data_requests (
  id uuid primary key,
  requester_user_id uuid not null references users(id),
  type text not null,
  state text not null default 'requested',
  reason text,
  privacy_boundary text not null default 'sanitized_identity_minimized_no_raw_exports',
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  completed_at timestamptz
);

create table feature_flags (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  category text not null default 'feature',
  policy_boundary text not null default 'software_policy_only_no_payment_access_or_social_priority',
  state text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table support_cases (
  id uuid primary key,
  organization_id uuid references organizations(id),
  requester_user_id uuid references users(id),
  assigned_staff_user_id uuid references users(id),
  subject_type text not null default 'none',
  subject_id uuid,
  category text not null,
  state text not null default 'open',
  priority text not null default 'standard',
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  closed_at timestamptz
);

create table organization_support_policies (
  id uuid primary key,
  organization_id uuid not null references organizations(id) unique,
  support_state text not null default 'standard',
  sla_tier text not null default 'standard',
  state text not null default 'review_required',
  policy_reason text,
  money_boundary text not null default 'software_sla_only_no_social_priority',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
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

create table ai_sessions (
  id uuid primary key,
  actor_user_id uuid not null references users(id),
  scope text not null,
  state text not null default 'active',
  allowed_tools text[] not null,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table ai_tool_calls (
  id uuid primary key,
  session_id uuid not null references ai_sessions(id),
  actor_user_id uuid not null references users(id),
  scope text not null,
  tool_name text not null,
  state text not null default 'prepared',
  confirmation_state text not null default 'not_required',
  subject_type text,
  subject_id text,
  input_summary text not null,
  output_summary text not null,
  input_redacted jsonb not null default '{}'::jsonb,
  output_redacted jsonb not null default '{}'::jsonb,
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
-- 6. Use idempotency keys for money, access passes, age, wallet, moderation, admin, and webhook mutations.
-- 7. Verify OpenAPI product_type enums match payment_product_type exactly.
