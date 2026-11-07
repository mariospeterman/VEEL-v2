import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = join(packageRoot, "migrations");

describe("durable verification attempt migration", () => {
  const sql = readFileSync(
    join(migrationsDir, "0138_durable_verification_attempt_resume.sql"),
    "utf8"
  );
  const downSql = readFileSync(
    join(migrationsDir, "0138_durable_verification_attempt_resume.down.sql"),
    "utf8"
  );

  it("derives recoverable launch state from existing immutable session facts", () => {
    expect(sql).toContain("create function private.current_verification_attempt");
    expect(sql).toContain("session.status = 'submitted'");
    expect(sql).toContain("then 'reconciling'");
    expect(sql).toContain("reservation.metadata ->> 'launchUrl'");
    expect(sql).toContain("reservation.metadata ->> 'providerPreference'");
    expect(sql).toContain("session.expires_at > now()");
  });

  it("adds only read paths and does not rewrite verification history", () => {
    expect(sql).not.toMatch(/\b(update|delete\s+from|alter\s+table)\b/i);
    expect(sql).not.toContain("unique index verification_sessions_active_attempt");
    expect(sql).toContain("verification_sessions_active_attempt_lookup_idx");
    expect(sql).toContain("verification_records_session_attempt_metadata_idx");
  });

  it("removes the selector before its supporting indexes", () => {
    expect(downSql.indexOf("drop function")).toBeLessThan(
      downSql.indexOf("verification_records_session_attempt_metadata_idx")
    );
  });
});
