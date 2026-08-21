import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = join(packageRoot, "migrations");

const readMigration = (fileName: string) => readFileSync(join(migrationsDir, fileName), "utf8");

describe("database migrations", () => {
  it("locks recurring memberships to exact noncustodial authority and replay-safe actions", () => {
    const sql = readMigration("0098_recurring_membership_authority.sql");

    expect(sql).toContain("delegation_nonce bigint");
    expect(sql).toContain("delegation_expires_at timestamptz");
    expect(sql).toContain("creator_amount_atomic + platform_fee_amount_atomic + allocation_amount_atomic = amount_atomic");
    expect(sql).toContain("create table subscription_action_receipts");
    expect(sql).toContain("alter table subscription_action_receipts enable row level security");
    expect(sql).toContain("revoke all on table subscription_action_receipts from anon, authenticated");
    expect(sql).not.toMatch(/balance|withdrawal|escrow|private_key|seed_phrase|raw_payload/i);
  });

  it("keeps every up migration paired with a rollback", () => {
    const files = readdirSync(migrationsDir).filter((file) => file.endsWith(".sql"));
    const upFiles = files.filter((file) => !file.endsWith(".down.sql"));

    for (const upFile of upFiles) {
      expect(files).toContain(upFile.replace(/\.sql$/, ".down.sql"));
    }
  });

  it("keeps the legacy Supabase column from becoming a second identity authority", () => {
    const sql = readMigration("0107_canonical_access_identity.sql");
    const downSql = readMigration("0107_canonical_access_identity.down.sql");

    expect(sql).toContain("users_legacy_supabase_id_canonical_check");
    expect(sql).toContain("supabase_user_id is null or supabase_user_id = id");
    expect(sql).toContain("not valid");
    expect(sql).toContain("validate constraint users_legacy_supabase_id_canonical_check");
    expect(sql).toContain("user_provider_identities");
    expect(sql).toContain("identity.provider_subject = u.supabase_user_id::text");
    expect(sql).toContain("set supabase_user_id = id");
    expect(downSql).toContain("drop constraint if exists users_legacy_supabase_id_canonical_check");
    expect(sql).not.toMatch(/email|raw_payload|private_key|seed_phrase|mnemonic/i);
  });

  it("requires complete normalized evidence before uploaded media release", () => {
    const sql = readMigration("0106_media_release_evidence.sql");
    const downSql = readMigration("0106_media_release_evidence.down.sql");

    expect(sql).toContain("'container_integrity'");
    expect(sql).toContain("content_safety_automated_evidence_ready");
    expect(sql).toContain("content_safety_automated_asset_evidence_ready");
    expect(sql).toContain("content_safety_automated_candidate_asset");
    expect(sql).toContain("release_media_asset_id");
    expect(sql).toContain("release_eligible");
    expect(sql).toContain("scan.media_asset_id = p_media_asset_id");
    expect(sql).toContain("provider_media_scan_events_asset_scope");
    expect(sql).toContain("provider_media_scan_event_asset_scope_invalid");
    expect(sql).toContain("content_safety_release_evidence_ready");
    expect(sql).toContain("count(*) = 4");
    expect(sql).toContain("provider = 'bunny_shield'");
    expect(sql).toContain("provider = 'bunny_stream'");
    expect(sql).toContain("normalized_signal = 'clear'");
    expect(sql).toContain("private.content_safety_release_evidence_ready(ci.id)");
    expect(sql).toContain("provider_media_scan_events_adverse_hold");
    expect(sql).toContain("publish_state = 'blocked'");
    expect(sql).toContain("known_hash_match_requires_reporting_review");
    expect(sql).toContain("required_release_evidence_incomplete");
    expect(sql).not.toMatch(/raw_payload|illegal_media|file_bytes/i);
    expect(downSql).toContain("drop function if exists private.content_safety_release_evidence_ready");
    expect(downSql).toContain("drop function if exists private.content_safety_automated_evidence_ready");
    expect(downSql).toContain("drop function if exists private.content_safety_automated_asset_evidence_ready");
    expect(downSql).toContain("drop trigger if exists provider_media_scan_events_adverse_hold");
    expect(downSql).toContain("release_requires_review_after_policy_rollback");
    expect(downSql).toContain("publish_state = 'blocked'");
  });

  it("creates the foundation tables before money, media, dating, events, or admin slices", () => {
    const sql = readMigration("0001_foundation.sql");

    expect(sql).toContain("create table users");
    expect(sql).toContain("create table profiles");
    expect(sql).toContain("create table idempotency_keys");
    expect(sql).toContain("create table audit_events");
    expect(sql).not.toContain("create table payment_intents");
    expect(sql).not.toContain("create table media_assets");
    expect(sql).not.toContain("create table dating_matches");
    expect(sql).not.toContain("create table events");
  });

  it("indexes idempotency, provider, and audit lookups used by backend policy", () => {
    const sql = readMigration("0001_foundation.sql");

    expect(sql).toContain("create index idempotency_keys_actor_user_id_idx");
    expect(sql).toContain("create index provider_events_provider_received_at_idx");
    expect(sql).toContain("create index provider_webhook_receipts_provider_received_at_idx");
    expect(sql).toContain("create index audit_events_subject_idx");
  });

  it("adds age verification state without provider payload storage", () => {
    const sql = readMigration("0002_age_verifications.sql");

    expect(sql).toContain("create type age_state as enum");
    expect(sql).toContain("create table age_verifications");
    expect(sql).toContain("provider_reference text not null");
    expect(sql).toContain("create index age_verifications_user_created_at_idx");
    expect(sql).not.toMatch(/raw_payload/i);
  });

  it("adds wallet foundation without payment proof or key custody", () => {
    const sql = readMigration("0003_wallets.sql");

    expect(sql).toContain("create type wallet_chain as enum");
    expect(sql).toContain("create type wallet_provider as enum");
    expect(sql).toContain("create table wallets");
    expect(sql).toContain("create unique index wallets_one_primary_per_user_idx");
    expect(sql).not.toMatch(/private_key|seed_phrase|mnemonic|raw_payload|payment_proof/i);
  });

  it("adds replay-safe wallet link challenges without signatures or raw keys", () => {
    const sql = readMigration("0004_wallet_link_challenges.sql");

    expect(sql).toContain("create table wallet_link_challenges");
    expect(sql).toContain("nonce_hash text not null");
    expect(sql).toContain("consumed_at timestamptz");
    expect(sql).toContain("wallet_link_challenges_nonce_hash_unique");
    expect(sql).not.toMatch(/private_key|seed_phrase|mnemonic|signature text|raw_payload/i);
  });

  it("adds age provider waterfall lookup support without identity payload storage", () => {
    const sql = readMigration("0005_age_provider_waterfall.sql");

    expect(sql).toContain("age_verifications_provider_state_idx");
    expect(sql).toContain("on age_verifications (provider, state, created_at desc)");
    expect(sql).not.toMatch(/raw_payload|document|selfie|face_image|identity_image/i);
  });

  it("adds normalized verification records without storing identity media or raw provider payloads", () => {
    const sql = readMigration("0069_normalized_verification_domain.sql");

    expect(sql).toContain("create table verification_sessions");
    expect(sql).toContain("create table verification_records");
    expect(sql).toContain("create table verification_events");
    expect(sql).toContain("purpose = 'age_access'");
    expect(sql).toContain("purpose = 'creator_kyc'");
    expect(sql).toContain("purpose = 'org_kyb'");
    expect(sql).toContain("raw_payload_hash text");
    expect(sql).not.toMatch(/raw_payload json|document_image|selfie_image|biometric_template|id_document/i);
  });

  it("adds the public profile avatar storage bucket with strict media limits", () => {
    const sql = readMigration("0070_profile_avatar_storage_bucket.sql");

    expect(sql).toContain("storage.buckets");
    expect(sql).toContain("'profile-avatars'");
    expect(sql).toContain("file_size_limit");
    expect(sql).toContain("5000000");
    expect(sql).toContain("image/jpeg");
    expect(sql).toContain("image/png");
    expect(sql).toContain("image/webp");
    expect(sql).not.toMatch(/private_key|service_role|secret/i);
  });

  it("keeps already-migrated profile avatar buckets at the 5 MB limit", () => {
    const sql = readMigration("0071_profile_avatar_storage_limit.sql");

    expect(sql).toContain("storage.buckets");
    expect(sql).toContain("file_size_limit = 5000000");
    expect(sql).toContain("id = 'profile-avatars'");
    expect(sql).not.toMatch(/private_key|service_role|secret/i);
  });

  it("covers foreign keys reported by the Supabase performance advisor", () => {
    const sql = readMigration("0074_supabase_advisor_fk_indexes.sql");

    expect(sql).toContain("mcp_connections_revoked_by_user_idx");
    expect(sql).toContain("oauth_access_tokens_code_idx");
    expect(sql).toContain("oauth_authorization_codes_actor_idx");
    expect(sql).toContain("oauth_authorization_codes_request_idx");
    expect(sql).toContain("oauth_authorization_requests_approved_by_idx");
    expect(sql).toContain("oauth_authorization_requests_denied_by_idx");
    expect(sql).toContain("payment_confirmation_deliveries_receipt_idx");
    expect(sql).toContain("refund_remediation_evidence_recorded_by_idx");
    expect(sql).toContain("verification_records_derived_from_idx");
    expect(sql).toContain("verification_sessions_source_session_idx");
    expect(sql).toContain("wallet_auth_sessions_wallet_idx");
  });

  it("covers the platform tier policy plan foreign key", () => {
    const sql = readMigration("0075_platform_tier_policy_plan_index.sql");

    expect(sql).toContain("platform_tier_policies_subscription_plan_idx");
    expect(sql).toContain("platform_tier_policies (subscription_plan_id)");
  });

  it("adds content feed foundation without playback secrets or entitlement shortcuts", () => {
    const sql = readMigration("0006_content_feed_foundation.sql");

    expect(sql).toContain("create table content_items");
    expect(sql).toContain("create table media_assets");
    expect(sql).toContain("content_items_home_feed_idx");
    expect(sql).toContain("media_assets_content_item_idx");
    expect(sql).not.toMatch(/signed_url|playback_token|entitled|payment_proof|private_key/i);
  });

  it("adds media upload provider lookup support without provider payload storage", () => {
    const sql = readMigration("0007_media_upload_boundary.sql");

    expect(sql).toContain("media_assets_provider_state_idx");
    expect(sql).toContain("on media_assets (provider, provider_state, created_at desc)");
    expect(sql).not.toMatch(/raw_payload|signed_url|stream_key|api_key|private_key/i);
  });

  it("adds content access projection rules without entitlement shortcuts", () => {
    const sql = readMigration("0008_content_access_projection.sql");

    expect(sql).toContain("create table content_access_rules");
    expect(sql).toContain("content_access_rules_active_idx");
    expect(sql).toContain("product_type text");
    expect(sql).not.toMatch(/entitled|payment_confirmed|signed_url|playback_token|private_key/i);
  });

  it("adds payment intents without treating signatures as proof", () => {
    const sql = readMigration("0009_payment_intents.sql");

    expect(sql).toContain("create table payment_intents");
    expect(sql).toContain("reference_address text not null unique");
    expect(sql).toContain("create table payment_settlement_attempts");
    expect(sql).toContain("confirmed_signature text unique");
    expect(sql).not.toMatch(/private_key|seed_phrase|mnemonic|wallet_secret|service_role/i);
  });

  it("adds backend-owned content unlock entitlements with RLS enabled", () => {
    const sql = readMigration("0010_content_unlock_entitlements.sql");

    expect(sql).toContain("create table entitlements");
    expect(sql).toContain("create table entitlement_events");
    expect(sql).toContain("unique (payment_intent_id)");
    expect(sql).toContain("entitlements_active_content_unlock_idx");
    expect(sql).toContain("alter table entitlements enable row level security");
    expect(sql).toContain("alter table entitlement_events enable row level security");
    expect(sql).not.toMatch(/payment_proof|signed_url|playback_token|private_key|raw_payload/i);
  });

  it("adds tip and support settlement ledger entries without access grants", () => {
    const sql = readMigration("0011_tip_support_settlement_ledger.sql");

    expect(sql).toContain("create table payment_ledger_entries");
    expect(sql).toContain("account_kind text not null");
    expect(sql).toContain("unique (payment_intent_id, account_kind, account_key)");
    expect(sql).toContain("alter table payment_ledger_entries enable row level security");
    expect(sql).not.toMatch(/entitlement|access_grant|payment_proof|private_key|raw_payload/i);
  });

  it("adds referral attribution and commission tables without client payout truth", () => {
    const sql = readMigration("0012_referral_attribution_commissions.sql");

    expect(sql).toContain("create table referral_tokens");
    expect(sql).toContain("create table referral_attributions");
    expect(sql).toContain("create table referral_commissions");
    expect(sql).toContain("add column referral_token_id uuid references referral_tokens(id)");
    expect(sql).toContain("alter table referral_tokens enable row level security");
    expect(sql).toContain("unique (payment_intent_id, referral_token_id)");
    expect(sql).not.toMatch(/payout_payload|client_amount|payment_proof|private_key|raw_payload/i);
  });

  it("adds Bunny playback projection columns without signed playback secrets", () => {
    const sql = readMigration("0013_bunny_vod_playback_projection.sql");

    expect(sql).toContain("add column playback_url text");
    expect(sql).toContain("add column provider_playable boolean not null default false");
    expect(sql).toContain("media_assets_playback_ready_idx");
    expect(sql).not.toMatch(/signed_url|playback_token|api_key|private_key|raw_payload/i);
  });

  it("adds Livepeer room, pass, chat, and replay tables with RLS and no raw payloads", () => {
    const sql = readMigration("0014_livepeer_live_rooms_pass_chat_replay.sql");

    expect(sql).toContain("create table live_rooms");
    expect(sql).toContain("create table live_pass_purchase_requests");
    expect(sql).toContain("create table live_passes");
    expect(sql).toContain("create table live_chat_messages");
    expect(sql).toContain("create table live_replay_assets");
    expect(sql).toContain("alter table live_rooms enable row level security");
    expect(sql).toContain("alter table live_passes enable row level security");
    expect(sql).toContain("alter table live_chat_messages enable row level security");
    expect(sql).toContain("playback_jwt_required boolean not null default true");
    expect(sql).not.toMatch(/api_key|private_key|raw_payload|payment_proof|service_role/i);
  });

  it("adds messages and paid-message delivery tables with RLS and settlement gating", () => {
    const sql = readMigration("0015_messages_paid_messages.sql");

    expect(sql).toContain("create table conversations");
    expect(sql).toContain("create table conversation_members");
    expect(sql).toContain("create table messages");
    expect(sql).toContain("create table paid_message_delivery_requests");
    expect(sql).toContain("payment_intent_id uuid primary key references payment_intents(id)");
    expect(sql).toContain("state text not null default 'pending_payment'");
    expect(sql).toContain("alter table messages enable row level security");
    expect(sql).toContain("alter table paid_message_delivery_requests enable row level security");
    expect(sql).not.toMatch(/raw_payload|private_key|service_role|payment_proof/i);
  });

  it("makes normal message delivery idempotent per sender", () => {
    const sql = readMigration("0084_message_idempotency.sql");

    expect(sql).toContain("add column if not exists idempotency_key text");
    expect(sql).toContain("messages_sender_idempotency_uidx");
    expect(sql).toContain("on messages (sender_user_id, idempotency_key)");
    expect(sql).toContain("where idempotency_key is not null");
    expect(sql).not.toMatch(/raw_payload|private_key|service_role|message_body/i);
  });

  it("adds AI/MCP scoped sessions and tool-call audit rows with RLS and redaction", () => {
    const sql = readMigration("0025_ai_mcp_scoped_assistant.sql");

    expect(sql).toContain("create table ai_sessions");
    expect(sql).toContain("create table ai_tool_calls");
    expect(sql).toContain("scope in ('user_self_service', 'creator_helper', 'admin_ops')");
    expect(sql).toContain("confirmation_state text not null default 'not_required'");
    expect(sql).toContain("foreign key (session_id, actor_user_id, scope)");
    expect(sql).toContain("input_summary text not null");
    expect(sql).toContain("output_summary text not null");
    expect(sql).toContain("input_redacted jsonb not null default '{}'::jsonb");
    expect(sql).toContain("output_redacted jsonb not null default '{}'::jsonb");
    expect(sql).toContain("alter table ai_sessions enable row level security");
    expect(sql).toContain("alter table ai_tool_calls enable row level security");
    expect(sql).toContain("grant select on table ai_sessions to authenticated");
    expect(sql).toContain("create policy ai_sessions_select_self_or_staff");
    expect(sql).toContain("create policy ai_tool_calls_select_self_or_staff");
    expect(sql).toContain("to authenticated");
    expect(sql).toContain("(select private.current_app_user_id())");
    expect(sql).not.toMatch(/to anon|using\s*\(\s*true\s*\)|with check\s*\(\s*true\s*\)/i);
    expect(sql).not.toMatch(/raw_payload|private_key|seed_phrase|mnemonic|service_role_key|api_key/i);
  });

  it("adds external MCP connections with token hashes, scoped tools, and audit rows", () => {
    const sql = readMigration("0065_external_mcp_connector_foundation.sql");

    expect(sql).toContain("create table mcp_connections");
    expect(sql).toContain("create table mcp_tool_calls");
    expect(sql).toContain("token_hash text not null unique");
    expect(sql).toContain("token_hint text not null");
    expect(sql).toContain("scopes text[] not null");
    expect(sql).toContain("idempotency_key text not null");
    expect(sql).toContain("unique (actor_user_id, idempotency_key)");
    expect(sql).toContain("'creator.drafts.write'");
    expect(sql).toContain("'admin.payments.read'");
    expect(sql).toContain("state text not null");
    expect(sql).toContain("check (state in ('allowed', 'denied', 'failed'))");
    expect(sql).toContain("risk_level text not null");
    expect(sql).toContain("input_redacted jsonb not null default '{}'::jsonb");
    expect(sql).toContain("output_redacted jsonb not null default '{}'::jsonb");
    expect(sql).toContain("alter table mcp_connections enable row level security");
    expect(sql).toContain("alter table mcp_tool_calls enable row level security");
    expect(sql).toContain("create policy mcp_connections_select_self_or_staff");
    expect(sql).toContain("create policy mcp_tool_calls_select_self_or_staff");
    expect(sql).not.toMatch(/raw_payload|private_key|seed_phrase|mnemonic|service_role_key|api_key/i);
  });

  it("adds MCP OAuth clients, authorization codes, access tokens, and revocation support", () => {
    const sql = readMigration("0066_mcp_oauth_completion.sql");
    const downSql = readMigration("0066_mcp_oauth_completion.down.sql");

    expect(sql).toContain("create table oauth_clients");
    expect(sql).toContain("create table oauth_authorization_requests");
    expect(sql).toContain("create table oauth_authorization_codes");
    expect(sql).toContain("create table oauth_access_tokens");
    expect(sql).toContain("code_hash text not null unique");
    expect(sql).toContain("token_hash text not null unique");
    expect(sql).toContain("code_challenge_method text not null check (code_challenge_method = 'S256')");
    expect(sql).toContain("alter column token_hash drop not null");
    expect(sql).toContain("auth_mode text not null default 'scoped_token'");
    expect(sql).toContain("mcp_connections_auth_mode_token_shape_check");
    expect(sql).toContain("oauth_access_tokens_connection_idx");
    expect(sql).toContain("oauth_authorization_codes_client_expires_at_idx");
    expect(sql).toContain("alter table oauth_clients enable row level security");
    expect(sql).toContain("alter table oauth_access_tokens enable row level security");
    expect(sql).toContain("create policy oauth_access_tokens_select_actor_or_staff");
    expect(downSql).toContain("drop table if exists oauth_access_tokens");
    expect(downSql).toContain("alter column token_hash set not null");
    expect(sql).not.toMatch(/raw_payload|private_key|seed_phrase|mnemonic|service_role_key|api_key/i);
  });

  it("adds wallet-first auth challenges and hashed sessions without key custody", () => {
    const sql = readMigration("0067_wallet_first_auth.sql");
    const downSql = readMigration("0067_wallet_first_auth.down.sql");

    expect(sql).toContain("create table wallet_auth_challenges");
    expect(sql).toContain("create table wallet_auth_sessions");
    expect(sql).toContain("nonce_hash text not null");
    expect(sql).toContain("token_hash text not null unique");
    expect(sql).toContain("wallet_id uuid not null references wallets(id)");
    expect(sql).toContain("wallet_auth_challenges_nonce_hash_unique");
    expect(sql).toContain("wallet_auth_sessions_expires_at_idx");
    expect(sql).toContain("alter table wallet_auth_challenges enable row level security");
    expect(sql).toContain("alter table wallet_auth_sessions enable row level security");
    expect(sql).toContain("create policy wallet_auth_sessions_staff_select");
    expect(downSql).toContain("drop table if exists wallet_auth_sessions");
    expect(downSql).toContain("drop table if exists wallet_auth_challenges");
    expect(sql).not.toMatch(/private_key|seed_phrase|mnemonic|raw_payload|payment_proof|service_role_key/i);
  });

  it("adds backend-owned profile media and link storage", () => {
    const sql = readMigration("0068_profile_media_links.sql");
    const downSql = readMigration("0068_profile_media_links.down.sql");

    expect(sql).toContain("add column if not exists profile_links jsonb");
    expect(sql).toContain("profiles_profile_links_array_chk");
    expect(downSql).toContain("drop column if exists profile_links");
  });

  it("adds transactional payment confirmation email delivery metadata without custody state", () => {
    const sql = readMigration("0060_payment_confirmation_email_delivery.sql");

    expect(sql).toContain("payment_confirmation_deliveries");
    expect(sql).toContain("'processing'");
    expect(sql).toContain("attempt_count integer not null default 0");
    expect(sql).toContain("provider_message_id text");
    expect(sql).toContain("payment_confirmation_deliveries_provider_message_id_idx");
    expect(sql).not.toMatch(/creator_balance|withdrawal_queue|withdrawal_request|payout_queue|escrow|private_key|service_role/i);
  });

  it("adds refund request idempotency without creating refund execution state", () => {
    const sql = readMigration("0057_refund_request_idempotency.sql");
    const downSql = readMigration("0057_refund_request_idempotency.down.sql");

    expect(sql).toContain("add column idempotency_key text");
    expect(sql).toContain("add column request_hash text");
    expect(sql).toContain("alter column idempotency_key set not null");
    expect(sql).toContain("alter column request_hash set not null");
    expect(sql).toContain("refunds_and_disputes_reporter_idempotency_idx");
    expect(sql).toContain("on refunds_and_disputes (reporter_user_id, idempotency_key)");
    expect(downSql).toContain("drop index if exists refunds_and_disputes_reporter_idempotency_idx");
    expect(downSql).toContain("drop column if exists idempotency_key");
    expect(downSql).toContain("drop column if exists request_hash");
    expect(sql).not.toMatch(/execute_refund|refund_transfer|creator_balance|payout_queue|escrow|private_key|service_role/i);
  });

  it("adds payment withdrawal-waiver evidence while preserving noncustodial boundaries", () => {
    const sql = readMigration("0058_payment_withdrawal_waiver_evidence.sql");
    const downSql = readMigration("0058_payment_withdrawal_waiver_evidence.down.sql");

    expect(sql).toContain("withdrawal_waiver_required boolean not null default true");
    expect(sql).toContain("withdrawal_waiver_accepted_at timestamptz not null default now()");
    expect(sql).toContain("withdrawal_waiver_version text not null default 'instant-digital-access-v1'");
    expect(sql).toContain("terms_version text not null default 'veel-terms-v1'");
    expect(sql).toContain("durable_confirmation_required boolean not null default true");
    expect(sql).toContain("refund_value_basis text not null default 'manual_resolution'");
    expect(sql).toContain("payment_intents_withdrawal_waiver_idx");
    expect(downSql).toContain("drop index if exists payment_intents_withdrawal_waiver_idx");
    expect(downSql).toContain("drop column if exists withdrawal_waiver_required");
    expect(sql).not.toMatch(/creator_balance|withdrawal_queue|payout_queue|escrow|private_key|service_role/i);
  });

  it("adds durable confirmation rows with RLS and receipt uniqueness", () => {
    const sql = readMigration("0059_payment_durable_confirmations.sql");
    const downSql = readMigration("0059_payment_durable_confirmations.down.sql");

    expect(sql).toContain("create unique index receipts_payment_intent_id_uidx");
    expect(sql).toContain("where payment_intent_id is not null");
    expect(sql).toContain("create table payment_confirmation_deliveries");
    expect(sql).toContain("payment_intent_id uuid not null references payment_intents(id)");
    expect(sql).toContain("unique (payment_intent_id, channel)");
    expect(sql).toContain("alter table payment_confirmation_deliveries enable row level security");
    expect(sql).toContain("create policy payment_confirmation_deliveries_select_self_or_staff");
    expect(sql).toContain("(select private.current_app_user_id())");
    expect(downSql).toContain("drop policy if exists payment_confirmation_deliveries_select_self_or_staff");
    expect(downSql).toContain("drop table if exists payment_confirmation_deliveries");
    expect(sql).not.toMatch(/creator_balance|withdrawal_queue|withdrawal_request|payout_queue|escrow|private_key|service_role/i);
  });

  it("extends confirmation delivery retries without storing provider secrets", () => {
    const sql = readMigration("0060_payment_confirmation_email_delivery.sql");
    const downSql = readMigration("0060_payment_confirmation_email_delivery.down.sql");

    expect(sql).toContain("drop constraint payment_confirmation_deliveries_state_check");
    expect(sql).toContain("check (state in ('queued', 'processing', 'sent', 'provider_not_configured', 'failed'))");
    expect(sql).toContain("attempt_count integer not null default 0 check (attempt_count >= 0)");
    expect(sql).toContain("leased_at timestamptz");
    expect(sql).toContain("failure_code text");
    expect(sql).toContain("provider_message_id text");
    expect(sql).toContain("payment_confirmation_deliveries_provider_message_id_idx");
    expect(downSql).toContain("drop index if exists payment_confirmation_deliveries_provider_message_id_idx");
    expect(downSql).toContain("drop column if exists provider_message_id");
    expect(sql).not.toMatch(/api_key|webhook_secret|private_key|service_role|raw_payload/i);
  });

  it("adds non-custodial creator split settlement facts and replay protections", () => {
    const sql = readMigration("0063_creator_split_payment_settlement.sql");
    const downSql = readMigration("0063_creator_split_payment_settlement.down.sql");

    expect(sql).toContain("add column settlement_kind text not null default 'creator_split'");
    expect(sql).toContain("add column buyer_wallet text");
    expect(sql).toContain("add column creator_wallet text");
    expect(sql).toContain("add column platform_fee_wallet text");
    expect(sql).toContain("add column allocation_wallet text");
    expect(sql).toContain("add column total_amount_minor bigint");
    expect(sql).toContain("add column creator_amount_minor bigint");
    expect(sql).toContain("platform_fee_amount_minor bigint not null default 0");
    expect(sql).toContain("allocation_amount_minor bigint not null default 0");
    expect(sql).toContain("settlement_kind in ('creator_split', 'platform_owned', 'dev_test')");
    expect(sql).toContain("total_amount_minor = creator_amount_minor + platform_fee_amount_minor + allocation_amount_minor");
    expect(sql).toContain("creator_wallet <> treasury_wallet");
    expect(sql).toContain("payment_intents_submitted_signature_uidx");
    expect(sql).toContain("where submitted_signature is not null");
    expect(sql).toContain("payment_intents_settlement_kind_state_idx");
    expect(downSql).toContain("drop index if exists payment_intents_submitted_signature_uidx");
    expect(downSql).toContain("drop constraint if exists payment_intents_split_total_check");
    expect(downSql).toContain("drop column if exists settlement_kind");
    expect(sql).not.toMatch(/creator_balance|withdrawal_queue|withdrawal_request|payout_queue|escrow|private_key|service_role/i);
  });

  it("hardens Solana subscription verifier state without custody surfaces", () => {
    const sql = readMigration("0064_solana_subscription_verifier_hardening.sql");
    const downSql = readMigration("0064_solana_subscription_verifier_hardening.down.sql");

    expect(sql).toContain("official_solana_subscription_program");
    expect(sql).toContain("subscription_plans_token_only_check");
    expect(sql).toContain("provider_state in ('staging_required', 'launch_approved', 'disabled')");
    expect(sql).toContain("subscription_plans_split_amounts_check");
    expect(sql).toContain("subscriber_wallet");
    expect(sql).toContain("subscription_authority_pda");
    expect(sql).toContain("subscription_pda");
    expect(sql).toContain("subscription_authorization_intents_verified_signature_uidx");
    expect(sql).toContain("subscription_collections_idempotency_uidx");
    expect(sql).toContain("subscriptions_status_expires_idx");
    expect(downSql).toContain("drop constraint if exists subscription_plans_token_only_check");
    expect(downSql).toContain("drop column if exists subscription_authority_pda");
    expect(downSql).toContain("drop index if exists subscription_collections_idempotency_uidx");
    expect(sql).not.toMatch(/private_key|seed_phrase|mnemonic|raw_payload|service_role|creator_balance|withdraw|payout_queue|escrow/i);
  });

  it("adds sanitized provider event replay payloads without raw provider payload storage", () => {
    const sql = readMigration("0061_provider_event_replay_payload.sql");

    expect(sql).toContain("add column replay_payload jsonb not null default '{}'::jsonb");
    expect(sql).toContain("provider_events_replay_payload_gin_idx");
    expect(sql).not.toMatch(/raw_payload|provider_payload|private_key|service_role|secret/i);
  });

  it("covers AI/MCP composite foreign keys for Supabase performance advisors", () => {
    const sql = readMigration("0026_ai_mcp_fk_indexes.sql");

    expect(sql).toContain("create index ai_tool_calls_session_actor_scope_idx");
    expect(sql).toContain("on ai_tool_calls (session_id, actor_user_id, scope)");
  });

  it("adds engagement feed controls reports and blocks with RLS and idempotency", () => {
    const sql = readMigration("0027_engagement_feed_safety.sql");

    expect(sql).toContain("create table viewer_feed_preferences");
    expect(sql).toContain("create table viewer_hidden_creators");
    expect(sql).toContain("create table viewer_hidden_topics");
    expect(sql).toContain("create table content_reactions");
    expect(sql).toContain("create table content_saves");
    expect(sql).toContain("create table engagement_action_receipts");
    expect(sql).toContain("create table comments");
    expect(sql).toContain("create table share_records");
    expect(sql).toContain("create table reports");
    expect(sql).toContain("create table blocks");
    expect(sql).toContain("last_idempotency_key text not null");
    expect(sql).toContain("idempotency_key text not null");
    expect(sql).toContain("primary key (actor_user_id, action, idempotency_key)");
    expect(sql).toContain("alter table engagement_action_receipts enable row level security");
    expect(sql).toContain("alter table reports enable row level security");
    expect(sql).toContain("alter table blocks enable row level security");
    expect(sql).toContain("create policy reports_select_reporter_or_staff");
    expect(sql).toContain("create policy blocks_select_blocker_or_staff");
    expect(sql).toContain("create index reports_queue_state_created_at_idx");
    expect(sql).toContain("to authenticated");
    expect(sql).toContain("(select private.current_app_user_id())");
    expect(sql).not.toMatch(/to anon|using\s*\(\s*true\s*\)|with check\s*\(\s*true\s*\)/i);
    expect(sql).not.toMatch(/raw_payload|private_key|seed_phrase|mnemonic|service_role|api_key/i);
  });

  it("adds delegated auto-renew subscription state with RLS and collection scheduling", () => {
    const sql = readMigration("0028_subscription_foundation.sql");

    expect(sql).toContain("create table subscription_plans");
    expect(sql).toContain("create table subscriptions");
    expect(sql).toContain("create table subscription_authorization_intents");
    expect(sql).toContain("create table subscription_collections");
    expect(sql).toContain("create table subscription_events");
    expect(sql).toContain("delegated_solana_subscription");
    expect(sql).toContain("request_hash text not null");
    expect(sql).toContain("authority_address text");
    expect(sql).toContain("delegation_address text");
    expect(sql).toContain("subscriber_token_account text");
    expect(sql).toContain("next_collection_at timestamptz");
    expect(sql).toContain("collection_signature text unique");
    expect(sql).toContain("subscriptions_next_collection_idx");
    expect(sql).toContain("alter table subscription_collections enable row level security");
    expect(sql).toContain("create policy subscription_authorization_intents_select_self_creator_or_staff");
    expect(sql).toContain("create policy subscription_collections_select_self_creator_or_staff");
    expect(sql).toContain("to authenticated");
    expect(sql).toContain("(select private.current_app_user_id())");
    expect(sql).not.toMatch(/helio|moonpay|merchant_checkout|to anon|using\s*\(\s*true\s*\)|with check\s*\(\s*true\s*\)/i);
    expect(sql).not.toMatch(/raw_payload|private_key|seed_phrase|mnemonic|service_role|api_key|\bcustodial\b|\bbalance\b|withdrawal/i);
  });

  it("covers subscription foreign keys reported by the Supabase performance advisor", () => {
    const sql = readMigration("0029_subscription_fk_indexes.sql");

    expect(sql).toContain("subscriptions_plan_id_idx");
    expect(sql).toContain("subscription_events_authorization_intent_id_idx");
    expect(sql).toContain("subscription_events_collection_id_idx");
    expect(sql).not.toMatch(/private_key|seed_phrase|mnemonic|raw_payload|service_role/i);
  });

  it("adds wallet transaction activity records without custody or raw provider payloads", () => {
    const sql = readMigration("0016_activity_wallet_transactions.sql");

    expect(sql).toContain("create table wallet_transaction_records");
    expect(sql).toContain("payment_intent_id uuid references payment_intents(id)");
    expect(sql).toContain("reference_address text");
    expect(sql).toContain("alter table wallet_transaction_records enable row level security");
    expect(sql).toContain("wallet_transaction_records_payment_signature_unique");
    expect(sql).toContain("wallet_transaction_records_user_created_at_idx");
    expect(sql).not.toMatch(/private_key|seed_phrase|mnemonic|raw_payload|payment_proof|custodial/i);
  });

  it("enables baseline RLS policies for public Supabase tables", () => {
    const sql = readMigration("0017_rls_policy_baseline.sql");

    expect(sql).toContain("create schema if not exists private");
    expect(sql).toContain("create or replace function private.current_app_user_id()");
    expect(sql).toContain("create or replace function private.is_staff_member()");
    expect(sql).toContain("alter table users enable row level security");
    expect(sql).toContain("alter table payment_intents enable row level security");
    expect(sql).toContain("create policy users_select_self_or_staff");
    expect(sql).toContain("create policy profiles_select_public_self_or_staff");
    expect(sql).toContain("create policy payment_intents_select_self_or_staff");
    expect(sql).toContain("create policy messages_select_conversation_member_or_staff");
    expect(sql).toContain("create policy wallet_transaction_records_select_self_or_staff");
    expect(sql).toContain("to authenticated");
    expect(sql).toContain("(select auth.uid())");
    expect(sql).not.toMatch(/to anon|using\s*\(\s*true\s*\)|with check\s*\(\s*true\s*\)/i);
    expect(sql).not.toMatch(/private_key|seed_phrase|mnemonic|raw_payload|service_role/i);
  });

  it("covers foreign keys reported by the Supabase performance advisor", () => {
    const sql = readMigration("0018_foreign_key_performance_indexes.sql");

    expect(sql).toContain("entitlement_events_actor_user_id_idx");
    expect(sql).toContain("live_pass_purchase_requests_room_id_idx");
    expect(sql).toContain("messages_sender_user_id_idx");
    expect(sql).toContain("paid_message_delivery_requests_recipient_user_id_idx");
    expect(sql).toContain("payment_intents_referral_token_id_idx");
    expect(sql).toContain("payment_ledger_entries_account_user_id_idx");
    expect(sql).toContain("referral_commissions_referral_attribution_id_idx");
    expect(sql).toContain("staff_memberships_granted_by_user_id_idx");
    expect(sql).toContain("wallet_transaction_records_wallet_id_idx");
    expect(sql).not.toMatch(/private_key|seed_phrase|mnemonic|raw_payload|service_role/i);
  });

  it("adds creator monetisation settings without balances or custody", () => {
    const sql = readMigration("0019_creator_monetisation_settings.sql");

    expect(sql).toContain("create table creator_monetisation_settings");
    expect(sql).toContain("earnings_recipient_wallet_id uuid references wallets(id)");
    expect(sql).toContain("subscriptions_enabled boolean not null default false");
    expect(sql).toContain("alter table creator_monetisation_settings enable row level security");
    expect(sql).toContain("creator_monetisation_settings_select_self_or_staff");
    expect(sql).toContain("creator_monetisation_settings_wallet_idx");
    expect(sql).not.toMatch(/balance|withdraw|payout_queue|escrow|private_key|seed_phrase|mnemonic|raw_payload|service_role/i);
  });

  it("adds admin ops indexes for payments, unlocks, and provider events", () => {
    const sql = readMigration("0020_admin_ops_indexes.sql");

    expect(sql).toContain("payment_intents_created_at_idx");
    expect(sql).toContain("payment_intents_submitted_signature_idx");
    expect(sql).toContain("entitlements_granted_at_idx");
    expect(sql).toContain("provider_events_received_at_idx");
    expect(sql).not.toMatch(/private_key|seed_phrase|mnemonic|raw_payload|service_role/i);
  });

  it("adds event ticketing tables with RLS and backend-issued tickets", () => {
    const sql = readMigration("0021_events_ticketing.sql");

    expect(sql).toContain("create table events");
    expect(sql).toContain("create table ticket_types");
    expect(sql).toContain("create table ticket_purchase_requests");
    expect(sql).toContain("create table ticket_entitlements");
    expect(sql).toContain("create table ticket_requests");
    expect(sql).toContain("alter table events enable row level security");
    expect(sql).toContain("alter table ticket_entitlements enable row level security");
    expect(sql).toContain("events_select_public_owner_or_staff");
    expect(sql).toContain("ticket_entitlements_select_self_creator_or_staff");
    expect(sql).toContain("payment_intent_id uuid unique references payment_intents(id)");
    expect(sql).toContain("qr_token_hash text unique not null");
    expect(sql).not.toMatch(/private_key|seed_phrase|mnemonic|raw_payload|service_role/i);
  });

  it("covers event ticketing foreign keys reported by the Supabase performance advisor", () => {
    const sql = readMigration("0022_event_ticketing_fk_indexes.sql");

    expect(sql).toContain("ticket_entitlements_ticket_type_id_idx");
    expect(sql).toContain("ticket_purchase_requests_event_id_idx");
    expect(sql).toContain("ticket_purchase_requests_ticket_type_id_idx");
    expect(sql).toContain("ticket_requests_ticket_type_id_idx");
    expect(sql).toContain("ticket_requests_reviewed_by_user_id_idx");
    expect(sql).not.toMatch(/private_key|seed_phrase|mnemonic|raw_payload|service_role/i);
  });

  it("adds dating opt-in, swipe, and match tables with RLS", () => {
    const sql = readMigration("0023_dating_mode.sql");

    expect(sql).toContain("create table dating_profiles");
    expect(sql).toContain("create table dating_swipes");
    expect(sql).toContain("create table dating_matches");
    expect(sql).toContain("unique (actor_user_id, idempotency_key)");
    expect(sql).toContain("dating_swipes_content_unique");
    expect(sql).toContain("dating_matches_pair_unique");
    expect(sql).toContain("alter table dating_profiles enable row level security");
    expect(sql).toContain("dating_matches_select_member_or_staff");
    expect(sql).not.toMatch(/private_key|seed_phrase|mnemonic|raw_payload|service_role|payment_proof/i);
  });

  it("covers dating foreign keys reported by the Supabase performance advisor", () => {
    const sql = readMigration("0024_dating_fk_indexes.sql");

    expect(sql).toContain("dating_swipes_content_item_id_idx");
    expect(sql).toContain("dating_matches_archived_by_user_id_idx");
    expect(sql).not.toMatch(/private_key|seed_phrase|mnemonic|raw_payload|service_role|payment_proof/i);
  });

  it("adds compliance, tax, receipt, and report tables with RLS and no custody fields", () => {
    const sql = readMigration("0030_compliance_tax_foundation.sql");

    expect(sql).toContain("create table tax_profiles");
    expect(sql).toContain("create table compliance_ledger_entries");
    expect(sql).toContain("create table receipts");
    expect(sql).toContain("create table vat_invoices");
    expect(sql).toContain("create table dac7_reports");
    expect(sql).toContain("create table carf_reports");
    expect(sql).toContain("create table compliance_exports");
    expect(sql).toContain("create table referral_programs");
    expect(sql).toContain("create table tier_waivers");
    expect(sql).toContain("create table organizations");
    expect(sql).toContain("carf_reporting_required boolean not null default false");
    expect(sql).toContain("commission_source = 'veel_platform_commission_net_of_refunds_and_tax'");
    expect(sql).toContain("alter table compliance_ledger_entries enable row level security");
    expect(sql).toContain("compliance_ledger_entries_staff_select");
    expect(sql).not.toMatch(/private_key|seed_phrase|mnemonic|raw_payload|service_role|creator_balance|withdraw|payout_queue|escrow/i);
  });

  it("adds notification projections and devices with RLS and no raw push secrets", () => {
    const sql = readMigration("0034_notifications_foundation.sql");

    expect(sql).toContain("create table notifications");
    expect(sql).toContain("create table notification_preferences");
    expect(sql).toContain("create table notification_devices");
    expect(sql).toContain("endpoint_hash text not null");
    expect(sql).toContain("p256dh_hash text not null");
    expect(sql).toContain("auth_hash text not null");
    expect(sql).toContain("alter table notifications enable row level security");
    expect(sql).toContain("notification_devices_insert_self");
    expect(sql).not.toMatch(/private_key|seed_phrase|mnemonic|raw_payload|service_role|creator_balance|withdraw|payout_queue|escrow|endpoint text|p256dh text|auth text/i);
  });

  it("adds organization memberships with RLS and no custody surfaces", () => {
    const sql = readMigration("0035_organization_memberships.sql");

    expect(sql).toContain("create table organization_memberships");
    expect(sql).toContain("unique (organization_id, user_id)");
    expect(sql).toContain("organization_memberships_user_state_idx");
    expect(sql).toContain("organization_memberships_org_state_idx");
    expect(sql).toContain("alter table organization_memberships enable row level security");
    expect(sql).toContain("organization_memberships_select_self_or_staff");
    expect(sql).toContain("organizations_member_select");
    expect(sql).not.toMatch(/private_key|seed_phrase|mnemonic|raw_payload|service_role|creator_balance|withdraw|payout_queue|escrow/i);
  });

  it("covers organization membership advisor fixes", () => {
    const sql = readMigration("0036_organization_memberships_advisor_fixes.sql");

    expect(sql).toContain("organization_memberships_invited_by_user_idx");
    expect(sql).toContain("drop policy if exists organizations_member_select");
    expect(sql).toContain("drop policy if exists organizations_staff_select");
    expect(sql).toContain("organizations_select_member_or_staff");
    expect(sql).not.toMatch(/private_key|seed_phrase|mnemonic|raw_payload|service_role|creator_balance|withdraw|payout_queue|escrow/i);
  });

  it("adds organization member admin workflow indexes without money or custody surfaces", () => {
    const sql = readMigration("0040_organization_member_admin_workflow.sql");

    expect(sql).toContain("organization_memberships_admin_lookup_idx");
    expect(sql).toContain("on organization_memberships (organization_id, id, state)");
    expect(sql).toContain("organization_memberships_recent_updates_idx");
    expect(sql).toContain("on organization_memberships (organization_id, updated_at desc, created_at desc)");
    expect(sql).not.toMatch(/private_key|seed_phrase|mnemonic|raw_payload|service_role|creator_balance|withdraw|payout_queue|escrow|payment_proof/i);
  });

  it("adds support case and organization support policy tables with RLS and social-money boundary", () => {
    const sql = readMigration("0041_support_case_policy_surface.sql");

    expect(sql).toContain("create table support_cases");
    expect(sql).toContain("create table organization_support_policies");
    expect(sql).toContain("software_sla_only_no_social_priority");
    expect(sql).toContain("alter table support_cases enable row level security");
    expect(sql).toContain("alter table organization_support_policies enable row level security");
    expect(sql).toContain("support_cases_staff_select");
    expect(sql).toContain("organization_support_policies_staff_select");
    expect(sql).not.toMatch(/private_key|seed_phrase|mnemonic|raw_payload|service_role|creator_balance|withdraw|payout_queue|escrow|payment_proof|recommendation_boost|visibility_boost|message_priority/i);
  });

  it("covers support case foreign keys reported by the Supabase performance advisor", () => {
    const sql = readMigration("0042_support_case_advisor_fixes.sql");

    expect(sql).toContain("support_cases_requester_user_idx");
    expect(sql).toContain("support_cases_assigned_staff_user_idx");
    expect(sql).not.toMatch(/private_key|seed_phrase|mnemonic|raw_payload|service_role|creator_balance|withdraw|payout_queue|escrow|payment_proof|recommendation_boost|visibility_boost|message_priority/i);
  });

  it("adds refund and dispute requests without custody or payout surfaces", () => {
    const sql = readMigration("0043_refund_dispute_request_workflow.sql");

    expect(sql).toContain("create table refunds_and_disputes");
    expect(sql).toContain("no_platform_custody_no_payout_queue");
    expect(sql).toContain("alter table refunds_and_disputes enable row level security");
    expect(sql).toContain("refunds_and_disputes_select_self_or_staff");
    expect(sql).not.toMatch(/private_key|seed_phrase|mnemonic|raw_payload|service_role|creator_balance|withdrawal|escrow|payment_proof|automatic_refund|platform_balance/i);
  });

  it("adds admin data request and feature flag surfaces with RLS boundaries", () => {
    const sql = readMigration("0044_admin_data_request_feature_flag_surfaces.sql");

    expect(sql).toContain("create table data_requests");
    expect(sql).toContain("create table feature_flags");
    expect(sql).toContain("sanitized_identity_minimized_no_raw_exports");
    expect(sql).toContain("software_policy_only_no_payment_access_or_social_priority");
    expect(sql).toContain("alter table data_requests enable row level security");
    expect(sql).toContain("alter table feature_flags enable row level security");
    expect(sql).toContain("data_requests_select_self_or_staff");
    expect(sql).toContain("feature_flags_staff_select");
    expect(sql).not.toMatch(/private_key|seed_phrase|mnemonic|raw_payload|service_role|creator_balance|withdrawal|escrow|payment_proof|recommendation_boost|visibility_boost|message_priority|mutuals_boost/i);
  });

  it("seeds CARF feature flag policy defaults as paused software controls", () => {
    const sql = readMigration("0045_seed_feature_flag_policy_defaults.sql");

    expect(sql).toContain("insert into feature_flags");
    expect(sql).toContain("compliance.carf_exports");
    expect(sql).toContain('"enabled": false');
    expect(sql).toContain("software_policy_only_no_payment_access_or_social_priority");
    expect(sql).toContain("'paused'");
    expect(sql).not.toMatch(/creator_balance|withdrawal|escrow|recommendation_boost|visibility_boost|message_priority|mutuals_boost/i);
  });

  it("adds only user-owned projections to the Supabase realtime publication", () => {
    const sql = readMigration("0039_realtime_projection_publication.sql");

    expect(sql).toContain("alter publication supabase_realtime add table notifications");
    expect(sql).toContain("alter publication supabase_realtime add table messages");
    expect(sql).toContain("alter publication supabase_realtime add table conversation_members");
    expect(sql).not.toMatch(/payment_intents|provider_events|notification_devices|notification_delivery_attempts|private_key|seed_phrase|mnemonic|raw_payload|service_role|creator_balance|withdraw|payout_queue|escrow/i);
  });

  it("renames Event Access Pass and Mutuals tables to canonical launch vocabulary", () => {
    const sql = readMigration("0049_event_access_mutuals_canonical_names.sql");

    expect(sql).toContain("rename to event_access_pass_types");
    expect(sql).toContain("rename to event_access_purchase_requests");
    expect(sql).toContain("rename to event_access_passes");
    expect(sql).toContain("rename to event_access_requests");
    expect(sql).toContain("rename column ticket_type_id to access_pass_type_id");
    expect(sql).toContain("rename to mutual_profiles");
    expect(sql).toContain("rename to mutual_interests");
    expect(sql).toContain("rename to mutuals");
    expect(sql).toContain("event_access_passes_select_self_creator_or_staff");
    expect(sql).toContain("mutuals_select_member_or_staff");
    expect(sql).not.toMatch(/creator_balance|withdrawal|escrow|payment_proof|recommendation_boost|visibility_boost|message_priority|mutuals_boost/i);
  });

  it("normalizes Event Access payment product type naming", () => {
    const sql = readMigration("0050_event_access_payment_product_type.sql");

    expect(sql).toContain("set product_type = 'event_access_pass'");
    expect(sql).toContain("where product_type = 'event_ticket'");
    expect(sql).not.toMatch(/drop table|drop column|creator_balance|withdrawal|escrow|recommendation_boost|visibility_boost|message_priority|mutuals_boost/i);
  });

  it("normalizes Event Access purchase request state naming", () => {
    const sql = readMigration("0056_event_access_purchase_request_state.sql");

    expect(sql).toContain("set state = 'access_pass_granted'");
    expect(sql).toContain("where state = 'ticket_granted'");
    expect(sql).toContain("event_access_purchase_requests_state_check");
    expect(sql).not.toMatch(/drop table|drop column|creator_balance|withdrawal|escrow|recommendation_boost|visibility_boost|message_priority|mutuals_boost/i);
  });

  it("adds refund remediation evidence without custody or payout queues", () => {
    const sql = readMigration("0062_refund_remediation_evidence.sql");

    expect(sql).toContain("create table refund_remediation_evidence");
    expect(sql).toContain("evidence_only_no_platform_custody_no_payout_queue");
    expect(sql).toContain("refund_remediation_evidence_dispute_idempotency_idx");
    expect(sql).toContain("alter table refund_remediation_evidence enable row level security");
    expect(sql).toContain("refund_remediation_evidence_select_self_or_staff");
    expect(sql).not.toMatch(/private_key|seed_phrase|mnemonic|raw_payload|service_role|creator_balance|withdrawal|automatic_refund|platform_balance|escrow/i);
  });

  it("adds backend-owned five-tier policy and one active profile membership offer", () => {
    const sql = readMigration("0072_platform_tier_authority.sql");
    const downSql = readMigration("0072_platform_tier_authority.down.sql");

    expect(sql).toContain("'veel_ultra'");
    expect(sql).toContain("create table platform_tier_policies");
    expect(sql).toContain("create table platform_usage_windows");
    expect(sql).toContain("subscription_plans_one_active_creator_offer_idx");
    expect(sql).toContain("public_media_allowance_seconds");
    expect(downSql).toContain("drop table if exists platform_usage_windows");
    expect(downSql).toContain("drop table if exists platform_tier_policies");
    expect(sql).not.toMatch(/recommendation_boost|visibility_boost|message_priority|mutuals_boost/i);
  });

  it("replaces timed live passes with three canonical live access modes", () => {
    const sql = readMigration("0073_live_access_modes.sql");
    const downSql = readMigration("0073_live_access_modes.down.sql");

    expect(sql).toContain("'public', 'profile_members', 'paid_event'");
    expect(sql).toContain("drop column pass_durations_minutes");
    expect(sql).toContain("drop column duration_minutes");
    expect(sql).toContain("members_only_chat boolean not null default false");
    expect(sql).toContain("members_included_in_paid_event boolean not null default false");
    expect(sql).toContain("replay_window_hours integer not null default 48");
    expect(downSql).toContain("add column pass_durations_minutes");
    expect(sql).not.toMatch(/recommendation_boost|visibility_boost|message_priority|mutuals_boost/i);
  });

  it("adds idempotent public-media usage accounting without changing entitlement truth", () => {
    const sql = readMigration("0083_platform_usage_accounting.sql");
    const downSql = readMigration("0083_platform_usage_accounting.down.sql");

    expect(sql).toContain("create table platform_playback_sessions");
    expect(sql).toContain("create table platform_playback_heartbeats");
    expect(sql).toContain("unique (session_id, sequence)");
    expect(sql).toContain("capabilities = capabilities - 'profile_membership'");
    expect(sql).toContain("alter table platform_playback_sessions enable row level security");
    expect(downSql).toContain("drop table if exists platform_playback_heartbeats");
    expect(sql).not.toMatch(/entitlement.*update|recommendation_boost|visibility_boost|message_priority|mutuals_boost/i);
  });

  it("adds one noncustodial recipient monetisation policy", () => {
    const sql = readMigration("0087_recipient_monetisation_policy.sql");
    const downSql = readMigration("0087_recipient_monetisation_policy.down.sql");

    expect(sql).toContain("private.assert_recipient_monetisation_ready");
    expect(sql).toContain("purpose = 'age_access'");
    expect(sql).toContain("purpose = 'creator_kyc'");
    expect(sql).toContain("earnings_recipient_wallet_id");
    expect(sql).toContain("tax_profile_state not in ('not_required', 'verified')");
    expect(sql).toContain("recipient_product_not_enabled");
    expect(downSql).toContain("drop function if exists private.assert_recipient_monetisation_ready");
    expect(sql).not.toMatch(/creator_balance|withdrawal|payout_queue|escrow|private_key|seed_phrase|mnemonic/i);
  });

  it("adds a canonical fail-closed media safety and performer consent domain", () => {
    const sql = readMigration("0088_media_safety_and_consent.sql");
    const downSql = readMigration("0088_media_safety_and_consent.down.sql");

    expect(sql).toContain("create table media_safety_cases");
    expect(sql).toContain("create table content_safety_declarations");
    expect(sql).toContain("create table performer_consents");
    expect(sql).toContain("create table provider_media_scan_events");
    expect(sql).toContain("create table media_moderation_jobs");
    expect(sql).toContain("private.content_safety_release_ready");
    expect(sql).toContain("content_items_safety_release_guard");
    expect(sql).toContain("alter table media_safety_cases enable row level security");
    expect(sql).toContain("provider_release_allowed boolean not null default false");
    expect(downSql).toContain("drop table if exists media_safety_cases");
    expect(sql).not.toMatch(/raw_provider_payload|identity_document|biometric_template|stream_key|private_key|seed_phrase|mnemonic/i);
  });

  it("covers media-safety foreign keys used by review and cleanup paths", () => {
    const sql = readMigration("0089_media_safety_fk_indexes.sql");
    const downSql = readMigration("0089_media_safety_fk_indexes.down.sql");

    expect(sql).toContain("content_safety_declarations_uploader_idx");
    expect(sql).toContain("performer_consents_performer_idx");
    expect(sql).toContain("media_moderation_jobs_case_idx");
    expect(sql).toContain("media_moderation_jobs_asset_idx");
    expect(sql).toContain("media_moderation_appeals_appellant_idx");
    expect(downSql).toContain("drop index if exists media_moderation_jobs_case_idx");
  });

  it("keeps earning, performer, and Enterprise management authorities independent", () => {
    const sql = readMigration("0090_monetisation_performer_enterprise_authorities.sql");
    const downSql = readMigration("0090_monetisation_performer_enterprise_authorities.down.sql");

    expect(sql).toContain("create table recipient_monetisation_policies");
    expect(sql).toContain("kyc_mode in ('disabled', 'risk_based', 'required')");
    expect(sql).toContain("private.assert_recipient_monetisation_ready");
    expect(sql).toContain("create table performer_consent_requests");
    expect(sql).toContain("content_revision bigint not null");
    expect(sql).toContain("create table managed_creator_relationships");
    expect(sql).toContain("create table managed_creator_agreements");
    expect(sql).toContain("unique (relationship_id, idempotency_key)");
    expect(sql).toContain("creator_share_bps + enterprise_management_share_bps = 10000");
    expect(sql).toContain("managed_creator_relationships_one_active_creator_idx");
    expect(sql).toContain("create function private.resolve_managed_creator_allocation");
    expect(sql).toContain("from tier_waivers tw");
    expect(sql).toContain("purpose = 'adult_publisher_eligibility'");
    expect(sql).toContain("purpose = 'performer_eligibility'");
    expect(sql).toContain("purpose = 'creator_kyc'");
    expect(sql).toContain("v_settings.earning_state <> 'ready'");
    expect(sql).toContain("content_items_bump_performer_revision");
    expect(sql).toContain("content_safety_declarations_bump_performer_revision");
    expect(sql).toContain("o.kyb_state = 'verified'");
    expect(sql).toContain("alter table managed_creator_allocation_records enable row level security");
    expect(sql).toContain("grant select on table managed_creator_allocation_records to authenticated");
    expect(downSql).toContain("returns table (wallet_id uuid, address text)");
    expect(downSql).toContain("drop table if exists managed_creator_relationships");
    expect(sql).not.toMatch(/creator_balance|withdrawal_queue|payout_queue|escrow|private_key|seed_phrase|mnemonic/i);
  });
  it("adds canonical provider identities, opaque sessions, and one-use recovery intents", () => {
    const sql = readMigration("0091_canonical_identity_session_security.sql");
    const downSql = readMigration("0091_canonical_identity_session_security.down.sql");

    expect(sql).toContain("create table user_provider_identities");
    expect(sql).toContain("provider text not null check (provider = 'supabase')");
    expect(sql).toContain("unique (provider, provider_subject)");
    expect(sql).toContain("user_provider_identities_one_active_provider_idx");
    expect(sql).toContain("alter table wallet_auth_sessions rename to app_sessions");
    expect(sql).toContain("update users set supabase_user_id = id");
    expect(sql).toContain("update app_sessions set authenticated_at = created_at");
    expect(sql).toContain("token_hash");
    expect(sql).toContain("create table recovery_link_intents");
    expect(sql).toContain("profiles_handle_lower_unique");
    expect(sql).toContain("profiles_handle_reserved_check");
    expect(sql).toContain("profile handle case collisions must be resolved before migration");
    expect(sql).toContain("invalid or reserved profile handles must be resolved before migration");
    expect(sql).toContain("alter column visibility set default 'private'");
    expect(downSql).toContain("alter table app_sessions rename to wallet_auth_sessions");
    expect(sql).not.toContain("'privy'");
    expect(sql).not.toMatch(/email\s*=|raw_payload|private_key|seed_phrase|mnemonic/i);
  });

  it("makes Launch 06 consent, creator readiness, and scarce inventory fail closed", () => {
    const sql = readMigration("0096_one_time_monetisation_checkout.sql");
    const downSql = readMigration("0096_one_time_monetisation_checkout.down.sql");

    expect(sql).toContain("where withdrawal_waiver_accepted_at is not null");
    expect(sql).toContain("explicit_checkout_consent_required_after_launch_06");
    expect(sql).toContain("create trigger payment_intents_explicit_checkout_consent");
    expect(sql).toContain("creator_monetisation_settings_ready_terms_check");
    expect(sql).toContain("earnings_terms_version = 'wevid-creator-earnings-v1'");
    expect(sql).toContain("event_access_purchase_requests_active_reservation_idx");
    expect(downSql).toContain("drop trigger if exists payment_intents_explicit_checkout_consent");
    expect(downSql).toContain("0096 rollback refused");
  });

  it("makes Enterprise actions replay-safe and normalized KYB authoritative", () => {
    const sql = readMigration("0099_enterprise_managed_creator_authority.sql");
    const downSql = readMigration("0099_enterprise_managed_creator_authority.down.sql");

    expect(sql).toContain("create table enterprise_action_receipts");
    expect(sql).toContain("unique (actor_user_id, action, idempotency_key)");
    expect(sql).toContain("revoke all on table enterprise_action_receipts from public, anon, authenticated");
    expect(sql).toContain("verification.subject_type = 'organization'");
    expect(sql).toContain("verification.purpose = 'org_kyb'");
    expect(sql).toContain("verification.status = 'valid'");
    expect(sql).not.toContain("organization.kyb_state = 'verified'");
    expect(downSql).toContain("organization.kyb_state = 'verified'");
    expect(downSql).toContain("drop table if exists enterprise_action_receipts");
    expect(sql).not.toMatch(/creator_balance|withdrawal_queue|payout_queue|escrow|private_key|seed_phrase|mnemonic/i);
  });

  it("promotes content-create receipts to logical-operation lifetime", () => {
    const sql = readMigration("0100_content_draft_idempotency_lifetime.sql");
    const downSql = readMigration("0100_content_draft_idempotency_lifetime.down.sql");

    expect(sql).toContain("where scope = 'content.create'");
    expect(sql).toContain("expires_at = 'infinity'::timestamptz");
    expect(downSql).toContain("expires_at = created_at + interval '24 hours'");
    expect(downSql).toContain("and expires_at = 'infinity'::timestamptz");
  });

  it("keeps canonical payment ledger values inside the JavaScript safe-integer range", () => {
    const sql = readMigration("0101_payment_ledger_atomic_safety.sql");
    const downSql = readMigration("0101_payment_ledger_atomic_safety.down.sql");

    expect(sql).toContain("payment_ledger_entries_javascript_safe_amount_check");
    expect(sql).toContain("amount_minor between 0 and 9007199254740991");
    expect(sql).toContain("payment ledger contains atomic values outside the JavaScript safe-integer range");
    expect(downSql).toContain("drop constraint if exists payment_ledger_entries_javascript_safe_amount_check");
  });

  it("promotes checkout-consent receipts to logical-operation lifetime", () => {
    const sql = readMigration("0102_checkout_consent_idempotency_lifetime.sql");
    const downSql = readMigration("0102_checkout_consent_idempotency_lifetime.down.sql");

    expect(sql).toContain("where scope = 'payment_checkout_consent'");
    expect(sql).toContain("expires_at = 'infinity'::timestamptz");
    expect(downSql).toContain("expires_at = created_at + interval '24 hours'");
    expect(downSql).toContain("and expires_at = 'infinity'::timestamptz");
  });

  it("converges deterministic recipient policy and set-based content eligibility", () => {
    const sql = readMigration("0108_policy_content_eligibility_convergence.sql");
    const downSql = readMigration("0108_policy_content_eligibility_convergence.down.sql");

    expect(sql).toContain("create function private.resolve_recipient_monetisation_policy");
    expect(sql).toContain("create function private.resolve_creator_kyc_state");
    expect(sql).toContain("vr.status = 'valid'");
    expect(sql).toContain("and vr.assurance_level in ('high', 'documentary')");
    expect(sql).toContain("create table recipient_monetisation_risk_assessments");
    expect(sql).toContain("recipient_monetisation_risk_active_lookup_idx");
    expect(sql).toContain("add column recipient_kyc_required boolean");
    expect(sql).toContain("add column recipient_kyc_policy_version text");
    expect(sql).toContain("'risk_threshold_required'");
    expect(sql).toContain("'jurisdiction_policy_required'");
    expect(sql).toContain("upper(btrim(configured_jurisdiction)) = v_jurisdiction");
    expect(sql).toContain("('live_pass', settings.live_passes_enabled)");
    expect(sql).toContain("('event_ticket', settings.live_passes_enabled)");
    expect(sql).toContain("create function private.eligible_content");
    expect(sql).toContain("case when p_viewer_user_id is null then 'sfw' else 'both' end");
    expect(sql).toContain("membership.current_period_starts_at is not null");
    expect(sql).toContain("membership.current_period_ends_at is not null");
    expect(sql).toContain("nsfw_preference = default_feed_mode");
    expect(sql).toContain("default_feed_mode in ('recommended', 'following')");
    expect(sql).toContain("subscriptions_content_eligibility_idx");
    expect(sql).not.toMatch(/creator_balance|withdrawal_queue|payout_queue|escrow|private_key|seed_phrase|mnemonic/i);
    expect(downSql).toContain("drop function if exists private.resolve_creator_kyc_state");
    expect(downSql).toContain("drop column if exists recipient_kyc_policy_version");
    expect(downSql).toContain("default_feed_mode in ('recommended', 'following', 'nsfw', 'sfw')");
  });

  it("converges ordered multi-format content and transactional polls", () => {
    const sql = readMigration("0109_universal_composer_authority.sql");
    const downSql = readMigration("0109_universal_composer_authority.down.sql");

    expect(sql).toContain("'carousel', 'text', 'poll'");
    expect(sql).toContain("create unique index media_assets_content_position_uidx");
    expect(sql).toContain("position between 0 and 9");
    expect(sql).toContain("create function private.assign_media_asset_position");
    expect(sql).toContain("where id = new.content_item_id\n  for update");
    expect(sql).toContain("select coalesce(max(asset.position) + 1, 0)");
    expect(sql).toContain("origin_classification in (");
    expect(sql).toContain("source_lineage_reference !~* '(prompt|api[_ -]?key|credential)");
    expect(sql).toContain("create table content_polls");
    expect(sql).toContain("create table content_poll_options");
    expect(sql).toContain("create table content_poll_votes");
    expect(sql).toContain("primary key (content_item_id, voter_user_id)");
    expect(sql).toContain("unique (voter_user_id, idempotency_key)");
    expect(sql).toContain("poll_options_locked_after_first_vote");
    expect(sql).toContain("create function private.clear_poll_children_for_parent_delete");
    expect(sql).toContain("delete from content_poll_votes");
    expect(sql).toContain("delete from content_poll_options");
    expect(sql).toContain("create trigger content_poll_votes_sync_counts");
    expect(sql).toContain("create function private.content_composition_provider_ready");
    expect(sql).toContain("asset.required_for_release is true");
    expect(sql).toContain("create function private.content_composition_safety_ready");
    expect(sql).toContain("private.content_safety_automated_asset_evidence_ready(content.id, asset.id)");
    expect(sql).toContain("poll_requires_two_to_four_options");
    expect(sql).toContain("v_publish_state not in ('draft', 'unpublished')");
    expect(sql).toContain("text_body_required");
    expect(sql).toContain("update of media_type, publish_state, body_text");
    expect(sql).toContain("alter table content_poll_votes enable row level security");
    expect(sql).not.toMatch(/creator_balance|withdrawal_queue|payout_queue|escrow|private_key|seed_phrase|mnemonic/i);
    expect(downSql).toContain("drop table if exists content_poll_votes");
    expect(downSql).toContain("drop function if exists private.clear_poll_children_for_parent_delete");
    expect(downSql).toContain("drop function if exists private.assign_media_asset_position");
    expect(downSql).toContain("drop function if exists private.content_composition_safety_ready");
    expect(downSql).toContain("drop column if exists origin_classification");
    expect(downSql).toContain("drop column if exists body_text");
  });
});
