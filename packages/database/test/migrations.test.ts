import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = join(packageRoot, "migrations");

const readMigration = (fileName: string) => readFileSync(join(migrationsDir, fileName), "utf8");

describe("database migrations", () => {
  it("keeps every up migration paired with a rollback", () => {
    const files = readdirSync(migrationsDir).filter((file) => file.endsWith(".sql"));
    const upFiles = files.filter((file) => !file.endsWith(".down.sql"));

    for (const upFile of upFiles) {
      expect(files).toContain(upFile.replace(/\.sql$/, ".down.sql"));
    }
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

  it("adds transactional payment confirmation email delivery metadata without custody state", () => {
    const sql = readMigration("0060_payment_confirmation_email_delivery.sql");

    expect(sql).toContain("payment_confirmation_deliveries");
    expect(sql).toContain("'processing'");
    expect(sql).toContain("attempt_count integer not null default 0");
    expect(sql).toContain("provider_message_id text");
    expect(sql).toContain("payment_confirmation_deliveries_provider_message_id_idx");
    expect(sql).not.toMatch(/creator_balance|withdraw|payout_queue|escrow|private_key|service_role/i);
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
});
