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
});
