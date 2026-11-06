import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createPostgresClient,
  type PostgresSql
} from "../src/shared/postgres.js";
import { guardedIntegrationDatabaseUrl } from "./integration-database.js";

const enabled = ["1", "true"].includes(
  process.env.VEEL_ENABLE_REAL_API_INTEGRATION_TESTS ?? ""
);
const describeIntegration = enabled ? describe : describe.skip;

describeIntegration("canonical current verification decision", () => {
  it("orders exact provider time, fail-closed ties, local authority, and derived evidence", async () => {
    const sql = createPostgresClient(guardedIntegrationDatabaseUrl());
    const orderedSubject = randomUUID();
    const tiedSubject = randomUUID();
    const missingTimeSubject = randomUUID();
    const legacySubject = randomUUID();
    const manualSubject = randomUUID();
    const internalSubject = randomUUID();
    const derivedSubject = randomUUID();
    const subjectIds = [
      orderedSubject,
      tiedSubject,
      missingTimeSubject,
      legacySubject,
      manualSubject,
      internalSubject,
      derivedSubject
    ];

    try {
      await insertDecision(sql, {
        subjectId: orderedSubject,
        status: "valid",
        providerEventAt: "2026-11-06 10:00:00.000001+00"
      });
      expect(await currentDecision(sql, orderedSubject)).toMatchObject({ status: "valid" });

      await insertDecision(sql, {
        subjectId: orderedSubject,
        status: "blocked",
        providerEventAt: "2026-11-06 10:00:00.000003+00"
      });
      expect(await currentDecision(sql, orderedSubject)).toMatchObject({ status: "blocked" });

      await insertDecision(sql, {
        subjectId: orderedSubject,
        status: "valid",
        providerEventAt: "2026-11-06 10:00:00.000002+00",
        createdAt: "2026-11-06 11:00:00+00"
      });
      expect(await currentDecision(sql, orderedSubject)).toMatchObject({ status: "blocked" });
      expect(await incomingDecisionWins(
        sql,
        orderedSubject,
        "valid",
        "2026-11-06 10:00:00.000002+00"
      )).toBe(false);
      expect(await incomingDecisionWins(
        sql,
        orderedSubject,
        "pending",
        "2026-11-06 10:00:00.000004+00"
      )).toBe(true);

      await insertDecision(sql, {
        subjectId: orderedSubject,
        status: "pending",
        providerEventAt: "2026-11-06 10:00:00.000004+00"
      });
      expect(await currentDecision(sql, orderedSubject)).toMatchObject({ status: "pending" });

      await insertDecision(sql, {
        subjectId: orderedSubject,
        status: "revoked",
        providerEventAt: "2026-11-06 10:00:00.000005+00"
      });
      expect(await currentDecision(sql, orderedSubject)).toMatchObject({ status: "revoked" });

      await insertDecision(sql, {
        subjectId: orderedSubject,
        status: "expired",
        providerEventAt: "2026-11-06 10:00:00.000006+00"
      });
      expect(await currentDecision(sql, orderedSubject)).toMatchObject({ status: "expired" });

      await insertDecision(sql, {
        subjectId: tiedSubject,
        status: "valid",
        providerEventAt: "2026-11-06 12:00:00.100001+00",
        createdAt: "2026-11-06 12:05:00+00"
      });
      await insertDecision(sql, {
        subjectId: tiedSubject,
        status: "blocked",
        providerEventAt: "2026-11-06 12:00:00.100001+00",
        createdAt: "2026-11-06 12:04:00+00"
      });
      expect(await currentDecision(sql, tiedSubject)).toMatchObject({ status: "blocked" });

      await insertDecision(sql, {
        subjectId: missingTimeSubject,
        status: "valid",
        providerEventAt: "2026-11-06 13:00:00+00"
      });
      await insertDecision(sql, {
        subjectId: missingTimeSubject,
        status: "blocked",
        providerEventAt: null,
        createdAt: "2026-11-06 13:01:00+00"
      });
      expect(await currentDecision(sql, missingTimeSubject)).toMatchObject({
        decision_authority: "provider_adverse_observed",
        status: "blocked"
      });

      await insertDecision(sql, {
        subjectId: legacySubject,
        status: "valid",
        providerEventAt: "2026-11-06 14:00:00+00"
      });
      await insertDecision(sql, {
        subjectId: legacySubject,
        status: "blocked",
        provider: "internal",
        providerEventAt: null,
        source: "legacy_age_final_backfill",
        createdAt: "2026-11-06 14:01:00+00"
      });
      expect(await currentDecision(sql, legacySubject)).toMatchObject({ status: "valid" });

      await insertDecision(sql, {
        subjectId: manualSubject,
        status: "valid",
        providerEventAt: "2026-11-06 15:00:00+00"
      });
      await insertDecision(sql, {
        subjectId: manualSubject,
        status: "blocked",
        provider: "manual",
        providerEventAt: null,
        source: "admin_kyb_override",
        createdAt: "2026-11-06 15:01:00+00"
      });
      expect(await currentDecision(sql, manualSubject)).toMatchObject({
        decision_authority: "manual",
        status: "blocked"
      });

      await insertDecision(sql, {
        subjectId: internalSubject,
        status: "valid",
        providerEventAt: "2026-11-06 16:00:00+00"
      });
      await insertDecision(sql, {
        subjectId: internalSubject,
        status: "pending",
        provider: "internal",
        providerEventAt: null,
        source: "verification_session_reservation",
        createdAt: "2026-11-06 16:01:00+00"
      });
      expect(await currentDecision(sql, internalSubject)).toMatchObject({
        decision_authority: "internal_transition",
        status: "pending"
      });

      const sourceRecordId = randomUUID();
      await sql`
        insert into verification_records (
          id, subject_type, subject_id, purpose, status, provider, method,
          threshold_age, result_over_threshold, assurance_level, reusable,
          policy_version, terms_accepted_at, provider_event_at, metadata, created_at
        ) values (
          ${sourceRecordId}, 'user', ${derivedSubject}, 'adult_publisher_eligibility',
          'valid', 'didit', 'gov_id_selfie', 18, true, 'documentary', false,
          'integration-policy-v1', '2026-11-06 17:00:00+00'::timestamptz,
          '2026-11-06 17:00:00.000001+00'::timestamptz,
          ${sql.json({ source: "provider_webhook" })},
          '2026-11-06 17:00:01+00'::timestamptz
        )
      `;
      await sql`
        insert into verification_records (
          subject_type, subject_id, purpose, status, provider, method,
          threshold_age, result_over_threshold, assurance_level, reusable,
          derived_from_record_id, metadata, created_at
        ) values (
          'user', ${derivedSubject}, 'age_access', 'valid', 'didit',
          'gov_id_selfie', 18, true, 'documentary', false, ${sourceRecordId},
          ${sql.json({ source: "adult_publisher_eligibility" })},
          '2026-11-06 17:00:02+00'::timestamptz
        )
      `;
      expect(await currentDecision(sql, derivedSubject)).toMatchObject({
        decision_authority: "derived",
        status: "valid"
      });

      await sql`
        insert into verification_records (
          subject_type, subject_id, purpose, status, provider, method,
          assurance_level, reusable, provider_event_at, metadata, created_at
        ) values (
          'user', ${derivedSubject}, 'adult_publisher_eligibility', 'revoked',
          'didit', 'gov_id_selfie', 'documentary', false,
          '2026-11-06 17:00:00.000002+00'::timestamptz,
          ${sql.json({ source: "provider_webhook" })},
          '2026-11-06 17:00:03+00'::timestamptz
        )
      `;
      expect(await currentDecision(sql, derivedSubject)).toBeNull();
    } finally {
      await sql`
        delete from verification_records
        where subject_id in ${sql(subjectIds)}
      `;
      await sql.end({ timeout: 5 });
    }
  });
});

interface DecisionInput {
  subjectId: string;
  status: "valid" | "blocked" | "pending" | "revoked" | "expired";
  providerEventAt: string | null;
  provider?: "didit" | "internal" | "manual";
  source?: string;
  createdAt?: string;
}

async function insertDecision(sql: PostgresSql, input: DecisionInput): Promise<void> {
  const provider = input.provider ?? "didit";
  const source = input.source ?? "provider_webhook";
  await sql`
    insert into verification_records (
      subject_type, subject_id, purpose, status, provider, method,
      threshold_age, result_over_threshold, assurance_level, reusable,
      provider_event_at, metadata, created_at
    ) values (
      'user', ${input.subjectId}, 'age_access', ${input.status}, ${provider},
      ${provider === "internal" || provider === "manual" ? "manual_review" : "gov_id_selfie"},
      18, ${input.status === "valid"}, 'documentary', false,
      ${input.providerEventAt}::timestamptz,
      ${sql.json({ source, providerOccurredAtMissing: input.providerEventAt === null })},
      ${input.createdAt ?? "2026-11-06 10:00:01+00"}::timestamptz
    )
  `;
}

async function currentDecision(
  sql: PostgresSql,
  subjectId: string
): Promise<{ status: string; decision_authority: string } | null> {
  const rows = await sql<Array<{ status: string; decision_authority: string }>>`
    select status, decision_authority
    from private.current_verification_decision_state(
      'user', ${subjectId}, 'age_access'
    )
  `;
  return rows[0] ?? null;
}

async function incomingDecisionWins(
  sql: PostgresSql,
  subjectId: string,
  status: DecisionInput["status"],
  providerEventAt: string | null
): Promise<boolean> {
  const rows = await sql<Array<{ wins: boolean }>>`
    select private.incoming_verification_decision_is_current(
      'user', ${subjectId}, 'age_access', ${status}, ${providerEventAt}::timestamptz
    ) as wins
  `;
  return rows[0]?.wins === true;
}
