import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = join(packageRoot, "migrations");
const sql = readFileSync(join(migrationsDir, "0141_content_export_attempt_fencing.sql"), "utf8");
const downSql = readFileSync(join(migrationsDir, "0141_content_export_attempt_fencing.down.sql"), "utf8");

describe("content export attempt fencing migration", () => {
  it("tracks one immutable private object identity per worker lease", () => {
    expect(sql).toContain("create table content_export_archive_attempts");
    expect(sql).toContain("add column archive_attempt_sequence bigint not null default 0");
    expect(sql).toContain("attempt_sequence bigint not null check (attempt_sequence > 0)");
    expect(sql).toContain("lease_token uuid not null unique");
    expect(sql).toContain("object_key text not null unique");
    expect(sql).toContain("unique (job_id, attempt_sequence)");
    expect(sql).not.toContain("unique (job_id, attempt_count)");
    expect(sql).toContain("Unlike attempt_count, it never resets");
    expect(sql).toContain("cleanup_required");
    expect(sql).toContain("published");
    expect(sql).toContain("enable row level security");
    expect(sql).toContain("from public, anon, authenticated");
    expect(sql).toContain("Provider deletion is intentionally not automated here");
  });

  it("retains cleanup evidence and refuses destructive rollback", () => {
    expect(sql).toContain("where state = 'cleanup_required'");
    expect(sql).toContain("job.state in ('queued', 'retry', 'cancelled', 'dead_letter')");
    expect(sql).toContain("job.cleanup_state = 'manual_confirmation_required'");
    expect(sql).toContain("else 'cleanup_required'");
    expect(sql).toContain("set archive_attempt_sequence = attempts.latest_attempt_sequence");
    expect(sql).toContain("Migration 0141 does not call provider deletion");
    expect(downSql).toContain("0141 rollback refused because content export archive-attempt evidence exists");
    expect(downSql.indexOf("if exists (select 1 from content_export_archive_attempts)"))
      .toBeLessThan(downSql.indexOf("drop table content_export_archive_attempts"));
    expect(downSql.indexOf("drop table content_export_archive_attempts"))
      .toBeLessThan(downSql.indexOf("drop column archive_attempt_sequence"));
  });
});
