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
});
