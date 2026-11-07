import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = join(packageRoot, "migrations");
const sql = readFileSync(
  join(migrationsDir, "0140_verification_policy_acl_age_attempt.sql"),
  "utf8"
);
const downSql = readFileSync(
  join(migrationsDir, "0140_verification_policy_acl_age_attempt.down.sql"),
  "utf8"
);

describe("verification policy and ACL convergence migration", () => {
  it("replaces active policy readers with the canonical current selector", () => {
    for (const routine of [
      "resolve_recipient_monetisation_policy",
      "resolve_creator_kyc_state",
      "assert_recipient_monetisation_ready",
      "resolve_managed_creator_allocation",
      "content_performer_readiness",
      "eligible_content_access_base",
      "has_protected_app_access"
    ]) {
      expect(sql).toContain(`function private.${routine}`);
    }
    expect(sql.match(/private\.current_verification_decision\(/g)?.length)
      .toBeGreaterThanOrEqual(8);
    expect(sql).not.toMatch(
      /from verification_records (creator_age|viewer_age|verification|vr)\b/
    );
  });

  it("binds rounded provider time to the owning local session", () => {
    expect(sql).toContain("p_session_id uuid");
    expect(sql).toContain("current_record.metadata ->> 'sessionId' = p_session_id::text");
    expect(sql).toContain("date_trunc('second', p_provider_event_at)");
    expect(sql).toContain("p_status in ('valid', 'blocked', 'invalid', 'revoked', 'expired')");
    expect(sql).toContain("p_provider_event_at is null");
    expect(sql).toContain("p_status not in ('blocked', 'invalid', 'revoked', 'expired')");
    expect(sql).toContain(
      "coalesce(record.metadata ->> 'source', '') = 'provider_reconciliation'"
    );
    expect(sql).toContain(
      "session_decision.metadata ->> 'sessionId'\n              = record.metadata ->> 'sessionId'"
    );
    expect(sql).toContain("'provider_webhook',\n              'provider_reconciliation'");
    expect(sql).toContain(
      "date_trunc('second', session_decision.provider_event_at)\n              = date_trunc('second', record.created_at)"
    );
  });

  it("invalidates derived decisions across the complete provenance chain", () => {
    expect(sql).toContain("function private.verification_record_derivation_is_current");
    expect(sql).toContain("p_record_id = any(coalesce(p_visited, array[]::uuid[]))");
    expect(sql).toContain("candidate.derived_from_record_id is null");
    expect(sql).toMatch(
      /verification_record_derivation_is_current\(\s*candidate\.id,/
    );
    expect(sql).toMatch(
      /verification_record_derivation_is_current\(\s*record\.id,/
    );
  });

  it("bounds eligibility before current age and access evaluation", () => {
    expect(sql).toContain("private.eligible_content_access_base(");
    expect(sql).toContain("p_candidate_content_ids uuid[]");
    expect(sql).toContain("content.id = any(p_candidate_content_ids)");
    expect(sql).toContain("function private.current_verification_decision_states");
    expect(sql).toContain("function private.current_verification_decisions");
    expect(sql).toContain("select distinct on (candidate.subject_id)");
    expect(sql).toContain("join current_creator_ages creator_age");
    expect(sql).toContain("adult_no_real_person_creators as materialized");
    expect(sql).toContain("current_adult_publishers as materialized");
    expect(sql).toContain("left join current_adult_publishers current_adult");
    expect(sql).toContain("current_adult.policy_version is not null");
    expect(sql).toContain("current_adult.terms_accepted_at is not null");
    expect(sql).not.toContain("p_candidate_content_ids is null or");
    expect(sql).not.toContain("null::uuid[]");
    expect(sql).toContain("private.eligible_content(uuid, text, uuid[])");
  });

  it("requires declared performers to consent to the distribution baseline", () => {
    const declaredStart = sql.indexOf(
      "when csd.representation_mode = 'declared_performers' then"
    );
    const declaredEnd = sql.indexOf("else false", declaredStart);
    expect(declaredStart).toBeGreaterThan(-1);
    expect(declaredEnd).toBeGreaterThan(declaredStart);
    expect(sql.slice(declaredStart, declaredEnd)).toContain(
      "or not (pc.allowed_uses @> array['capture', 'upload', 'distribution']::text[])"
    );
    expect(downSql).toContain(
      "capture/upload/distribution performer-consent readiness requirement"
    );
    expect(sql.match(/when (?:content|ci)\.nsfw_label in \('adult', 'explicit'\)/g))
      .toHaveLength(3);
    expect(sql.match(/then private\.content_performer_readiness\((?:content|ci)\.id\)/g))
      .toHaveLength(2);
  });

  it("removes retained direct access to verification and operational evidence", () => {
    for (const relation of [
      "verification_sessions",
      "verification_records",
      "verification_events",
      "provider_events",
      "provider_webhook_receipts",
      "provider_event_replay_requests",
      "idempotency_keys",
      "audit_events"
    ]) {
      expect(sql).toContain(relation);
    }
    expect(sql).toContain("from public, anon, authenticated");
    expect(downSql).toContain("intentionally retained");
  });
});
