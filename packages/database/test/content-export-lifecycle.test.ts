import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = join(packageRoot, "migrations");
const sql = readFileSync(join(migrationsDir, "0139_content_export_lifecycle.sql"), "utf8");
const downSql = readFileSync(join(migrationsDir, "0139_content_export_lifecycle.down.sql"), "utf8");

describe("content export lifecycle migration", () => {
  it("pins minimized owned content and retained-source inventory behind server-only tables", () => {
    expect(sql).toContain("create table content_export_jobs");
    expect(sql).toContain("create table content_export_job_contents");
    expect(sql).toContain("create table content_export_job_items");
    expect(sql).toContain("create table content_export_download_grants");
    expect(sql).toContain("content.creator_user_id = v_requester_user_id");
    expect(sql).toContain("content.asset_revision");
    expect(sql).toContain("sanitized_retained_source");
    expect(sql).toContain("provider_original_export_not_supported");
    expect(sql).toContain("content_restricted_by_safety_or_takedown");
    expect(sql).toContain("provider_cleanup_already_leased");
    expect(sql).toMatch(
      /from users\s+where id = v_requester_user_id\s+for update;/
    );
    expect(sql).toMatch(
      /from content_items content\s+where content\.creator_user_id = v_requester_user_id\s+order by content\.created_at, content\.id\s+limit v_maximum_snapshot_rows \+ 1\s+for update of content;/
    );
    expect(sql).toMatch(
      /from content_items content\s+join media_assets asset on asset\.content_item_id = content\.id\s+where content\.creator_user_id = v_requester_user_id\s+order by content\.created_at, content\.id, asset\.created_at, asset\.id\s+limit v_maximum_snapshot_rows \+ 1\s+for update of asset;/
    );
    expect(sql).toContain("for update of asset");
    expect(sql).toContain("enable row level security");
    expect(sql).toContain("from public, anon, authenticated");
    expect(sql).not.toMatch(/\b(message_body|identity_document|wallet_address|payment_signature|stream_key|api_key|private_key)\b/i);
  });

  it("uses finite due leases, bounded attempts, source holds, and explicit archive quarantine", () => {
    expect(sql).toContain("attempt_count between 0 and 8");
    expect(sql).toContain("lease_token uuid");
    expect(sql).toContain("leased_until timestamptz");
    expect(sql).toContain("source_hold_until timestamptz not null");
    expect(sql).toContain("content_export_jobs_lease_due_idx");
    expect(sql).toContain("content_export_jobs_expiry_idx");
    expect(sql).toContain("manual_confirmation_required");
    expect(sql).toContain("archive_upload_started_at timestamptz");
    expect(sql).toMatch(/cleanup_state = 'manual_confirmation_required'[\s\S]*archive_upload_started_at is not null/);
    expect(sql).toContain("Durable pre-upload fence");
    expect(sql).toContain("Migration 0139 wires no automated provider deletion");
  });

  it("rejects oversized content or asset inventory before persisting a partial snapshot", () => {
    expect(sql).toContain("v_maximum_snapshot_rows constant integer := 20000");
    expect(sql).toContain("get diagnostics v_content_count = row_count");
    expect(sql).toContain("get diagnostics v_asset_count = row_count");
    expect(sql).toContain("export_inventory_limit_exceeded");
    expect(sql).toContain("content_export_snapshot_rejected");
    expect(sql).toContain("'partialSnapshotPersisted', false");
    expect(sql.indexOf("if v_limit_dimension is not null then"))
      .toBeLessThan(sql.indexOf("insert into content_export_job_contents"));
  });

  it("creates one idempotent export snapshot per data request and preserves durable evidence", () => {
    expect(sql).toContain("data_request_id uuid not null unique");
    expect(sql).toContain("content_export_jobs_requester_active_uidx");
    expect(sql).toContain("create trigger data_requests_create_content_export_job");
    expect(sql).toContain("private.snapshot_content_export_request");
    expect(sql).toContain("content_export_snapshot_created");
    expect(downSql).toContain("0139 rollback refused because content export evidence exists");
  });
});
