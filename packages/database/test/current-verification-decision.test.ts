import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = join(packageRoot, "migrations");

describe("canonical current verification decision migration", () => {
  const sql = readFileSync(
    join(migrationsDir, "0134_canonical_current_verification_decision.sql"),
    "utf8"
  );
  const downSql = readFileSync(
    join(migrationsDir, "0134_canonical_current_verification_decision.down.sql"),
    "utf8"
  );

  it("selects before evaluating evidence and preserves exact database timestamps", () => {
    expect(sql).toContain("create function private.current_verification_decision_state");
    expect(sql).toContain("record.provider_event_at");
    expect(sql).toContain("decision_effective_at is not null");
    expect(sql).toContain("provider_adverse_observed");
    expect(sql).toContain("when candidate.status = 'pending' then 2");
    expect(sql).toContain("current_source.id = source.id");
    expect(sql).toContain("source.purpose = 'adult_publisher_eligibility'");
    expect(sql).toContain("source.result_over_threshold is true");
    expect(sql).not.toMatch(/extract\s*\(\s*epoch|date_part|getTime/i);
  });

  it("keeps the selector read-only and private", () => {
    expect(sql).not.toMatch(/\b(update|delete from|alter table|create trigger)\s+public\.verification_records\b/i);
    expect(sql).toContain(
      "revoke all on function private.current_verification_decision(text, uuid, text)"
    );
    expect(sql).toContain(
      "from public, anon, authenticated"
    );
  });

  it("removes dependent helpers before the canonical selector on rollback", () => {
    expect(downSql.indexOf("incoming_verification_decision_is_current")).toBeLessThan(
      downSql.indexOf("current_verification_decision(text, uuid, text)")
    );
    expect(downSql.indexOf("current_verification_decision(text, uuid, text)")).toBeLessThan(
      downSql.indexOf("current_verification_decision_state(text, uuid, text)")
    );
  });
});
