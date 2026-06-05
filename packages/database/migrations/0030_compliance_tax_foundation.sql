-- DAC7/DAC8(CARF)/VAT readiness, receipt, invoice, and admin compliance foundation.
-- These tables are admin/staff visible first. User-facing receipt and tax-profile
-- policies are added in the later UX/API slices that expose those resources.

create table identity_verifications (
  id uuid primary key,
  user_id uuid not null references users(id),
  provider text not null,
  provider_reference text not null,
  verification_type text not null check (verification_type in ('age', 'identity', 'liveness', 'wallet_ownership', 'kyc', 'kyb')),
  state text not null default 'pending' check (state in ('pending', 'verified', 'failed', 'expired', 'cancelled')),
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

create table tax_profiles (
  id uuid primary key,
  user_id uuid references users(id),
  organization_id uuid,
  subject_type text not null check (subject_type in ('user', 'creator', 'organization', 'partner')),
  state text not null default 'draft' check (state in ('draft', 'submitted', 'verified', 'needs_review', 'rejected', 'archived')),
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
  updated_at timestamptz not null default now(),
  check (user_id is not null or organization_id is not null)
);

create table tax_profile_versions (
  id uuid primary key,
  tax_profile_id uuid not null references tax_profiles(id),
  version_number integer not null check (version_number > 0),
  snapshot jsonb not null,
  collected_by_user_id uuid references users(id),
  created_at timestamptz not null default now(),
  unique (tax_profile_id, version_number)
);

alter table tax_profiles
  add constraint tax_profiles_current_version_id_fkey
  foreign key (current_version_id) references tax_profile_versions(id);

create table seller_of_record_determinations (
  id uuid primary key,
  product_type text not null,
  seller_user_id uuid references users(id),
  buyer_user_id uuid references users(id),
  seller_of_record text not null default 'undetermined'
    check (seller_of_record in ('creator', 'veel', 'enterprise_merchant', 'undetermined')),
  determination_reason text not null,
  review_state text not null default 'clear' check (review_state in ('clear', 'needs_review', 'resolved')),
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
  state text not null default 'active' check (state in ('draft', 'active', 'retired')),
  created_at timestamptz not null default now(),
  unique (jurisdiction, product_type, rule_key, effective_from)
);

create table product_tax_matrix (
  id uuid primary key,
  product_type text not null unique,
  default_seller_of_record text not null check (default_seller_of_record in ('creator', 'veel', 'enterprise_merchant', 'undetermined')),
  dac7_candidate boolean not null default false,
  carf_candidate boolean not null default false,
  vat_review_required boolean not null default true,
  counsel_status text not null default 'pending_review' check (counsel_status in ('pending_review', 'approved', 'blocked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table buyer_location_evidence (
  id uuid primary key,
  buyer_user_id uuid references users(id),
  payment_intent_id uuid references payment_intents(id),
  evidence_type text not null check (evidence_type in ('billing_country', 'ip_country', 'wallet_country', 'self_declared', 'provider')),
  country_code text,
  region_code text,
  confidence text not null default 'low' check (confidence in ('low', 'medium', 'high')),
  evidence_hash text,
  created_at timestamptz not null default now()
);

create table vat_determinations (
  id uuid primary key,
  payment_intent_id uuid references payment_intents(id),
  product_type text not null,
  seller_of_record text not null check (seller_of_record in ('creator', 'veel', 'enterprise_merchant', 'undetermined')),
  seller_country text,
  buyer_country text,
  buyer_vat_id_hash text,
  vies_status text not null default 'not_checked' check (vies_status in ('not_checked', 'valid', 'invalid', 'unavailable')),
  place_of_supply text,
  vat_status text not null default 'pending'
    check (vat_status in ('not_applicable', 'pending', 'reverse_charge', 'taxable', 'exempt', 'out_of_scope', 'review_required')),
  vat_rate_bps integer check (vat_rate_bps is null or vat_rate_bps >= 0),
  vat_amount_minor bigint check (vat_amount_minor is null or vat_amount_minor >= 0),
  currency text not null,
  review_state text not null default 'clear' check (review_state in ('clear', 'needs_review', 'resolved')),
  created_at timestamptz not null default now()
);

create table receipts (
  id uuid primary key,
  receipt_number text unique not null,
  buyer_user_id uuid references users(id),
  seller_user_id uuid references users(id),
  payment_intent_id uuid references payment_intents(id),
  product_type text not null,
  gross_amount_minor bigint not null check (gross_amount_minor >= 0),
  currency text not null,
  state text not null default 'issued' check (state in ('issued', 'voided', 'corrected')),
  issued_at timestamptz not null default now()
);

create table receipt_lines (
  id uuid primary key,
  receipt_id uuid not null references receipts(id),
  line_type text not null,
  description text not null,
  amount_minor bigint not null,
  currency text not null,
  created_at timestamptz not null default now()
);

create table platform_fee_statements (
  id uuid primary key,
  payment_intent_id uuid references payment_intents(id),
  creator_user_id uuid references users(id),
  platform_fee_minor bigint not null check (platform_fee_minor >= 0),
  currency text not null,
  state text not null default 'recorded' check (state in ('recorded', 'voided', 'corrected')),
  created_at timestamptz not null default now()
);

create table vat_invoices (
  id uuid primary key,
  invoice_number text unique not null,
  receipt_id uuid references receipts(id),
  seller_user_id uuid references users(id),
  buyer_user_id uuid references users(id),
  seller_of_record text not null check (seller_of_record in ('creator', 'veel', 'enterprise_merchant', 'undetermined')),
  total_amount_minor bigint not null check (total_amount_minor >= 0),
  vat_amount_minor bigint not null check (vat_amount_minor >= 0),
  currency text not null,
  state text not null default 'issued' check (state in ('draft', 'issued', 'voided', 'corrected')),
  issued_at timestamptz not null default now()
);

create table vat_invoice_lines (
  id uuid primary key,
  vat_invoice_id uuid not null references vat_invoices(id),
  description text not null,
  net_amount_minor bigint not null,
  vat_rate_bps integer check (vat_rate_bps is null or vat_rate_bps >= 0),
  vat_amount_minor bigint not null check (vat_amount_minor >= 0),
  currency text not null,
  created_at timestamptz not null default now()
);

create table tax_adjustments (
  id uuid primary key,
  payment_intent_id uuid references payment_intents(id),
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
  event_type text not null
    check (event_type in ('payment_settled', 'refund_recorded', 'entitlement_granted', 'fee_recorded', 'referral_commission_recorded', 'tax_adjusted')),
  product_type text not null,
  settlement_model text not null
    check (settlement_model in ('user_to_creator_split', 'user_to_platform', 'platform_fee_only', 'referral_commission_only')),
  seller_user_id uuid references users(id),
  buyer_user_id uuid references users(id),
  seller_tax_profile_version_id uuid references tax_profile_versions(id),
  buyer_tax_profile_version_id uuid references tax_profile_versions(id),
  payment_intent_id uuid references payment_intents(id),
  entitlement_id uuid,
  receipt_id uuid references receipts(id),
  vat_invoice_id uuid references vat_invoices(id),
  gross_amount_minor bigint not null check (gross_amount_minor >= 0),
  platform_fee_minor bigint check (platform_fee_minor is null or platform_fee_minor >= 0),
  creator_net_amount_minor bigint check (creator_net_amount_minor is null or creator_net_amount_minor >= 0),
  tax_amount_minor bigint check (tax_amount_minor is null or tax_amount_minor >= 0),
  currency text not null,
  fiat_currency text not null,
  fx_rate numeric,
  fx_observed_at timestamptz,
  seller_country text,
  buyer_country text,
  seller_of_record text not null default 'undetermined'
    check (seller_of_record in ('creator', 'veel', 'enterprise_merchant', 'undetermined')),
  vat_status text not null default 'pending'
    check (vat_status in ('not_applicable', 'pending', 'reverse_charge', 'taxable', 'exempt', 'out_of_scope', 'review_required')),
  dac7_reportable boolean not null default false,
  carf_reportable boolean not null default false,
  immutable_hash text unique,
  previous_hash text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table dac7_reports (
  id uuid primary key,
  reporting_year integer not null check (reporting_year >= 2026),
  jurisdiction text,
  state text not null default 'draft' check (state in ('draft', 'collecting', 'ready_for_review', 'exported', 'filed', 'blocked')),
  line_count integer not null default 0 check (line_count >= 0),
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
  gross_amount_minor bigint not null check (gross_amount_minor >= 0),
  platform_fee_minor bigint not null default 0 check (platform_fee_minor >= 0),
  transaction_count integer not null default 0 check (transaction_count >= 0),
  currency text not null,
  review_state text not null default 'pending' check (review_state in ('pending', 'ready', 'needs_review', 'blocked')),
  created_at timestamptz not null default now()
);

create table carf_reports (
  id uuid primary key,
  reporting_year integer not null check (reporting_year >= 2026),
  jurisdiction text,
  state text not null default 'draft' check (state in ('draft', 'collecting', 'ready_for_review', 'exported', 'filed', 'blocked')),
  carf_reporting_required boolean not null default false,
  line_count integer not null default 0 check (line_count >= 0),
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
  gross_amount_minor bigint not null check (gross_amount_minor >= 0),
  transaction_count integer not null default 0 check (transaction_count >= 0),
  currency text not null,
  review_state text not null default 'pending' check (review_state in ('pending', 'ready', 'needs_review', 'blocked')),
  created_at timestamptz not null default now()
);

create table compliance_review_queue (
  id uuid primary key,
  subject_type text not null,
  subject_id uuid not null,
  queue_type text not null,
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  state text not null default 'open' check (state in ('open', 'in_review', 'resolved', 'dismissed')),
  assigned_staff_user_id uuid references users(id),
  reason text not null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create table compliance_exports (
  id uuid primary key,
  export_type text not null check (export_type in ('dac7', 'carf', 'vat', 'receipts', 'invoices', 'ledger')),
  reporting_year integer,
  state text not null default 'created' check (state in ('created', 'processing', 'ready', 'failed', 'expired')),
  file_uri text,
  file_hash text,
  created_by_user_id uuid references users(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table referral_programs (
  id uuid primary key,
  name text not null,
  state text not null default 'draft' check (state in ('draft', 'active', 'paused', 'archived')),
  priority text not null check (priority in ('partner', 'invite', 'share')),
  commission_source text not null default 'veel_platform_commission_net_of_refunds_and_tax'
    check (commission_source = 'veel_platform_commission_net_of_refunds_and_tax'),
  created_at timestamptz not null default now()
);

create table partner_campaigns (
  id uuid primary key,
  name text not null,
  partner_name text not null,
  state text not null default 'draft' check (state in ('draft', 'active', 'paused', 'archived')),
  contract_id uuid,
  created_at timestamptz not null default now()
);

create table partner_contracts (
  id uuid primary key,
  partner_name text not null,
  state text not null default 'draft' check (state in ('draft', 'active', 'terminated', 'expired')),
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now()
);

alter table partner_campaigns
  add constraint partner_campaigns_contract_id_fkey
  foreign key (contract_id) references partner_contracts(id);

create table referral_abuse_flags (
  id uuid primary key,
  referral_token_id uuid references referral_tokens(id),
  user_id uuid references users(id),
  reason text not null,
  state text not null default 'open' check (state in ('open', 'reviewing', 'resolved', 'dismissed')),
  created_at timestamptz not null default now()
);

create table tier_waivers (
  id uuid primary key,
  subject_type text not null check (subject_type in ('user', 'creator', 'organization', 'partner_campaign')),
  subject_id uuid not null,
  tier_key text not null check (tier_key in ('free_verified', 'veel_plus', 'veel_studio', 'enterprise')),
  state text not null default 'active' check (state in ('active', 'expired', 'revoked')),
  starts_at timestamptz not null,
  ends_at timestamptz,
  created_at timestamptz not null default now()
);

create table organizations (
  id uuid primary key,
  name text not null,
  state text not null default 'pending_kyb' check (state in ('pending_kyb', 'active', 'suspended', 'archived')),
  plan text not null default 'enterprise' check (plan = 'enterprise'),
  kyb_state text check (kyb_state in ('not_started', 'pending', 'verified', 'rejected')),
  created_at timestamptz not null default now()
);

insert into product_tax_matrix (id, product_type, default_seller_of_record, dac7_candidate, carf_candidate, vat_review_required, counsel_status)
values
  (gen_random_uuid(), 'support', 'creator', true, false, true, 'pending_review'),
  (gen_random_uuid(), 'content_unlock', 'creator', true, false, true, 'pending_review'),
  (gen_random_uuid(), 'paid_message', 'creator', true, false, true, 'pending_review'),
  (gen_random_uuid(), 'live_pass', 'creator', true, false, true, 'pending_review'),
  (gen_random_uuid(), 'event_access_pass', 'creator', true, false, true, 'pending_review'),
  (gen_random_uuid(), 'membership', 'creator', true, false, true, 'pending_review'),
  (gen_random_uuid(), 'platform_plus', 'veel', false, false, true, 'pending_review'),
  (gen_random_uuid(), 'platform_studio', 'veel', false, false, true, 'pending_review'),
  (gen_random_uuid(), 'enterprise', 'veel', false, false, true, 'pending_review'),
  (gen_random_uuid(), 'platform_fee', 'veel', false, false, true, 'pending_review'),
  (gen_random_uuid(), 'referral_commission', 'veel', false, false, true, 'pending_review')
on conflict (product_type) do nothing;

create index identity_verifications_user_idx on identity_verifications (user_id, created_at desc);
create index tax_profiles_user_idx on tax_profiles (user_id, created_at desc) where user_id is not null;
create index tax_profile_versions_profile_idx on tax_profile_versions (tax_profile_id, version_number desc);
create index buyer_location_evidence_payment_idx on buyer_location_evidence (payment_intent_id, created_at desc) where payment_intent_id is not null;
create index vat_determinations_payment_idx on vat_determinations (payment_intent_id, created_at desc) where payment_intent_id is not null;
create index receipts_payment_idx on receipts (payment_intent_id) where payment_intent_id is not null;
create index vat_invoices_receipt_idx on vat_invoices (receipt_id) where receipt_id is not null;
create index compliance_ledger_entries_created_at_idx on compliance_ledger_entries (created_at desc);
create index compliance_ledger_entries_payment_idx on compliance_ledger_entries (payment_intent_id) where payment_intent_id is not null;
create index compliance_ledger_entries_seller_idx on compliance_ledger_entries (seller_user_id, created_at desc) where seller_user_id is not null;
create index compliance_ledger_entries_buyer_idx on compliance_ledger_entries (buyer_user_id, created_at desc) where buyer_user_id is not null;
create index dac7_report_lines_report_idx on dac7_report_lines (report_id, created_at desc);
create index carf_report_lines_report_idx on carf_report_lines (report_id, created_at desc);
create index compliance_review_queue_state_idx on compliance_review_queue (state, priority, created_at desc);

alter table identity_verifications enable row level security;
alter table tax_profiles enable row level security;
alter table tax_profile_versions enable row level security;
alter table seller_of_record_determinations enable row level security;
alter table jurisdiction_tax_rules enable row level security;
alter table product_tax_matrix enable row level security;
alter table buyer_location_evidence enable row level security;
alter table vat_determinations enable row level security;
alter table receipts enable row level security;
alter table receipt_lines enable row level security;
alter table platform_fee_statements enable row level security;
alter table vat_invoices enable row level security;
alter table vat_invoice_lines enable row level security;
alter table tax_adjustments enable row level security;
alter table compliance_ledger_entries enable row level security;
alter table dac7_reports enable row level security;
alter table dac7_report_lines enable row level security;
alter table carf_reports enable row level security;
alter table carf_report_lines enable row level security;
alter table compliance_review_queue enable row level security;
alter table compliance_exports enable row level security;
alter table referral_programs enable row level security;
alter table partner_campaigns enable row level security;
alter table partner_contracts enable row level security;
alter table referral_abuse_flags enable row level security;
alter table tier_waivers enable row level security;
alter table organizations enable row level security;

grant select on table identity_verifications, tax_profiles, tax_profile_versions, seller_of_record_determinations,
  jurisdiction_tax_rules, product_tax_matrix, buyer_location_evidence, vat_determinations, receipts, receipt_lines,
  platform_fee_statements, vat_invoices, vat_invoice_lines, tax_adjustments, compliance_ledger_entries,
  dac7_reports, dac7_report_lines, carf_reports, carf_report_lines, compliance_review_queue, compliance_exports,
  referral_programs, partner_campaigns, partner_contracts, referral_abuse_flags, tier_waivers, organizations
to authenticated;

create policy identity_verifications_staff_select on identity_verifications for select to authenticated using ((select private.is_staff_member()));
create policy tax_profiles_staff_select on tax_profiles for select to authenticated using ((select private.is_staff_member()));
create policy tax_profile_versions_staff_select on tax_profile_versions for select to authenticated using ((select private.is_staff_member()));
create policy seller_of_record_determinations_staff_select on seller_of_record_determinations for select to authenticated using ((select private.is_staff_member()));
create policy jurisdiction_tax_rules_staff_select on jurisdiction_tax_rules for select to authenticated using ((select private.is_staff_member()));
create policy product_tax_matrix_staff_select on product_tax_matrix for select to authenticated using ((select private.is_staff_member()));
create policy buyer_location_evidence_staff_select on buyer_location_evidence for select to authenticated using ((select private.is_staff_member()));
create policy vat_determinations_staff_select on vat_determinations for select to authenticated using ((select private.is_staff_member()));
create policy receipts_staff_select on receipts for select to authenticated using ((select private.is_staff_member()));
create policy receipt_lines_staff_select on receipt_lines for select to authenticated using ((select private.is_staff_member()));
create policy platform_fee_statements_staff_select on platform_fee_statements for select to authenticated using ((select private.is_staff_member()));
create policy vat_invoices_staff_select on vat_invoices for select to authenticated using ((select private.is_staff_member()));
create policy vat_invoice_lines_staff_select on vat_invoice_lines for select to authenticated using ((select private.is_staff_member()));
create policy tax_adjustments_staff_select on tax_adjustments for select to authenticated using ((select private.is_staff_member()));
create policy compliance_ledger_entries_staff_select on compliance_ledger_entries for select to authenticated using ((select private.is_staff_member()));
create policy dac7_reports_staff_select on dac7_reports for select to authenticated using ((select private.is_staff_member()));
create policy dac7_report_lines_staff_select on dac7_report_lines for select to authenticated using ((select private.is_staff_member()));
create policy carf_reports_staff_select on carf_reports for select to authenticated using ((select private.is_staff_member()));
create policy carf_report_lines_staff_select on carf_report_lines for select to authenticated using ((select private.is_staff_member()));
create policy compliance_review_queue_staff_select on compliance_review_queue for select to authenticated using ((select private.is_staff_member()));
create policy compliance_exports_staff_select on compliance_exports for select to authenticated using ((select private.is_staff_member()));
create policy referral_programs_staff_select on referral_programs for select to authenticated using ((select private.is_staff_member()));
create policy partner_campaigns_staff_select on partner_campaigns for select to authenticated using ((select private.is_staff_member()));
create policy partner_contracts_staff_select on partner_contracts for select to authenticated using ((select private.is_staff_member()));
create policy referral_abuse_flags_staff_select on referral_abuse_flags for select to authenticated using ((select private.is_staff_member()));
create policy tier_waivers_staff_select on tier_waivers for select to authenticated using ((select private.is_staff_member()));
create policy organizations_staff_select on organizations for select to authenticated using ((select private.is_staff_member()));
