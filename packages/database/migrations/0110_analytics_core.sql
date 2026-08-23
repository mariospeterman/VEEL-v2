-- Deterministic Analytics Core projections. Canonical domain tables remain business truth;
-- these server-only tables are bounded, rebuildable read models.

alter table worker_queue_recovery_requests
  drop constraint if exists worker_queue_recovery_requests_queue_name_check;
alter table worker_queue_recovery_requests
  add constraint worker_queue_recovery_requests_queue_name_check
  check (queue_name in (
    'subscription_collections',
    'notification_deliveries',
    'payment_confirmation_emails',
    'provider_event_replays',
    'media_moderation',
    'analytics_projections'
  ));

create table analytics_creator_daily (
  bucket_date date not null,
  creator_user_id uuid not null references users(id) on delete cascade,
  published_content_count bigint not null default 0 check (published_content_count >= 0),
  follower_start_count bigint not null default 0 check (follower_start_count >= 0),
  creator_hide_count bigint not null default 0 check (creator_hide_count >= 0),
  creator_report_count bigint not null default 0 check (creator_report_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (bucket_date, creator_user_id)
);

create table analytics_creator_content_daily (
  bucket_date date not null,
  creator_user_id uuid not null references users(id) on delete cascade,
  content_item_id uuid not null references content_items(id) on delete cascade,
  media_type text not null,
  impression_count bigint not null default 0 check (impression_count >= 0),
  qualified_view_count bigint not null default 0 check (qualified_view_count >= 0),
  credited_watch_seconds bigint not null default 0 check (credited_watch_seconds >= 0),
  completed_view_count bigint not null default 0 check (completed_view_count >= 0),
  early_skip_count bigint not null default 0 check (early_skip_count >= 0),
  replay_count bigint not null default 0 check (replay_count >= 0),
  like_count bigint not null default 0 check (like_count >= 0),
  comment_count bigint not null default 0 check (comment_count >= 0),
  save_count bigint not null default 0 check (save_count >= 0),
  share_count bigint not null default 0 check (share_count >= 0),
  audience_sample_size bigint not null default 0 check (audience_sample_size >= 0),
  updated_at timestamptz not null default now(),
  primary key (bucket_date, content_item_id)
);

create table analytics_creator_product_daily (
  bucket_date date not null,
  creator_user_id uuid not null references users(id) on delete cascade,
  product_type text not null,
  currency text not null check (currency in ('SOL', 'USDC')),
  confirmed_purchase_count bigint not null default 0 check (confirmed_purchase_count >= 0),
  confirmed_gross_minor bigint not null default 0 check (confirmed_gross_minor >= 0),
  creator_earnings_minor bigint not null default 0 check (creator_earnings_minor >= 0),
  platform_fee_minor bigint not null default 0 check (platform_fee_minor >= 0),
  updated_at timestamptz not null default now(),
  primary key (bucket_date, creator_user_id, product_type, currency)
);

create table analytics_organization_creator_daily (
  bucket_date date not null,
  organization_id uuid not null references organizations(id) on delete cascade,
  creator_user_id uuid not null references users(id) on delete cascade,
  currency text not null check (currency in ('SOL', 'USDC')),
  confirmed_allocation_count bigint not null default 0 check (confirmed_allocation_count >= 0),
  creator_side_proceeds_minor bigint not null default 0 check (creator_side_proceeds_minor >= 0),
  creator_net_minor bigint not null default 0 check (creator_net_minor >= 0),
  enterprise_management_minor bigint not null default 0 check (enterprise_management_minor >= 0),
  updated_at timestamptz not null default now(),
  primary key (bucket_date, organization_id, creator_user_id, currency)
);

create table analytics_projection_jobs (
  id uuid primary key default gen_random_uuid(),
  projection_key text not null check (char_length(projection_key) between 1 and 80),
  definition_version integer not null check (definition_version > 0),
  window_starts_on date not null,
  window_ends_on date not null,
  reason text not null check (reason in ('incremental', 'late_fact', 'backfill', 'reconciliation')),
  state text not null default 'queued' check (state in ('queued', 'leased', 'retry', 'completed', 'dead_letter')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 20),
  next_attempt_at timestamptz not null default now(),
  leased_until timestamptz,
  lease_token uuid,
  last_error_code text,
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 160),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (projection_key, idempotency_key),
  check (window_ends_on >= window_starts_on),
  check ((state = 'leased') = (leased_until is not null and lease_token is not null))
);

create table analytics_projection_watermarks (
  projection_key text primary key,
  definition_version integer not null check (definition_version > 0),
  data_through timestamptz not null,
  last_job_id uuid references analytics_projection_jobs(id) on delete set null,
  state text not null check (state in ('healthy', 'stale', 'reconciling', 'failed')),
  projected_row_count bigint not null default 0 check (projected_row_count >= 0),
  updated_at timestamptz not null default now()
);

create table analytics_reconciliation_runs (
  id uuid primary key default gen_random_uuid(),
  projection_key text not null,
  definition_version integer not null check (definition_version > 0),
  job_id uuid references analytics_projection_jobs(id) on delete set null,
  window_starts_on date not null,
  window_ends_on date not null,
  state text not null check (state in ('matched', 'mismatch', 'failed')),
  source_row_count bigint not null default 0 check (source_row_count >= 0),
  projected_row_count bigint not null default 0 check (projected_row_count >= 0),
  variance_count bigint not null default 0,
  details jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz not null default now(),
  check (window_ends_on >= window_starts_on),
  check (jsonb_typeof(details) = 'object')
);

create table analytics_privacy_suppression_daily (
  bucket_date date not null,
  metric_key text not null,
  scope_type text not null check (scope_type in ('creator', 'organization', 'platform')),
  suppression_count bigint not null default 0 check (suppression_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (bucket_date, metric_key, scope_type)
);

create index analytics_creator_daily_creator_date_idx
  on analytics_creator_daily (creator_user_id, bucket_date desc);
create index analytics_creator_content_creator_date_idx
  on analytics_creator_content_daily (creator_user_id, bucket_date desc, content_item_id);
create index analytics_creator_product_creator_date_idx
  on analytics_creator_product_daily (creator_user_id, bucket_date desc, currency, product_type);
create index analytics_organization_creator_org_date_idx
  on analytics_organization_creator_daily (organization_id, bucket_date desc, creator_user_id, currency);
create index analytics_projection_jobs_lease_idx
  on analytics_projection_jobs (state, next_attempt_at, leased_until, created_at)
  where state in ('queued', 'retry', 'leased');
create index analytics_reconciliation_projection_date_idx
  on analytics_reconciliation_runs (projection_key, completed_at desc);

alter table analytics_creator_daily enable row level security;
alter table analytics_creator_content_daily enable row level security;
alter table analytics_creator_product_daily enable row level security;
alter table analytics_organization_creator_daily enable row level security;
alter table analytics_projection_jobs enable row level security;
alter table analytics_projection_watermarks enable row level security;
alter table analytics_reconciliation_runs enable row level security;
alter table analytics_privacy_suppression_daily enable row level security;

revoke all on table analytics_creator_daily from public, anon, authenticated;
revoke all on table analytics_creator_content_daily from public, anon, authenticated;
revoke all on table analytics_creator_product_daily from public, anon, authenticated;
revoke all on table analytics_organization_creator_daily from public, anon, authenticated;
revoke all on table analytics_projection_jobs from public, anon, authenticated;
revoke all on table analytics_projection_watermarks from public, anon, authenticated;
revoke all on table analytics_reconciliation_runs from public, anon, authenticated;
revoke all on table analytics_privacy_suppression_daily from public, anon, authenticated;

comment on table analytics_creator_daily is
  'Server-only rebuildable creator daily projection; canonical content, follow, hide, and report facts remain authoritative.';
comment on table analytics_creator_content_daily is
  'Server-only content performance projection. No viewer identity or private-message content is stored.';
comment on table analytics_creator_product_daily is
  'Server-only confirmed commerce projection separated by native currency; never a balance or payout authority.';
comment on table analytics_organization_creator_daily is
  'Server-only confirmed managed-creator allocation projection gated by current organization and agreement authorization.';
comment on table analytics_projection_jobs is
  'Bounded leased analytics backfill/reconciliation work with retry ceilings and deterministic idempotency.';
comment on table analytics_projection_watermarks is
  'Explicit definition version, freshness, and data-through evidence for Analytics Core.';
comment on table analytics_reconciliation_runs is
  'Privacy-minimized source-to-projection parity evidence; mismatches are reported rather than silently hidden.';
comment on table analytics_privacy_suppression_daily is
  'Aggregate count of privacy-suppressed queries; contains no actor, viewer, or audience identifiers.';
