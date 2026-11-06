import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgresAgeRepository } from "../src/modules/age/age-repository";
import { createPostgresClient } from "../src/shared/postgres";
import { guardedIntegrationDatabaseUrl } from "./integration-database.js";

const enabled = ["1", "true"].includes(process.env.VEEL_ENABLE_REAL_API_INTEGRATION_TESTS ?? "");
const describeIntegration = enabled ? describe : describe.skip;

describeIntegration("durable age provider attempts against Postgres", () => {
  let sql: ReturnType<typeof createPostgresClient> | undefined;

  beforeAll(() => {
    sql = createPostgresClient(guardedIntegrationDatabaseUrl());
  });

  afterAll(async () => {
    await sql?.end({ timeout: 5 });
  });

  it("serializes concurrent keys, replays exact handoffs, and persists launch facts", async () => {
    if (!sql) throw new Error("Postgres test client was not initialized");
    const userId = randomUUID();
    const repository = createPostgresAgeRepository(sql);
    await sql`insert into users (id, supabase_user_id) values (${userId}, ${userId})`;

    try {
      const [first, second] = await Promise.all([
        repository.reservePendingAgeVerification!({
          userId,
          idempotencyKey: `first-${userId}`,
          requestHash: "1".repeat(64),
          providerPreference: "yoti"
        }),
        repository.reservePendingAgeVerification!({
          userId,
          idempotencyKey: `second-${userId}`,
          requestHash: "2".repeat(64),
          providerPreference: "didit"
        })
      ]);

      expect(new Set([first.id, second.id]).size).toBe(1);
      expect([first.shouldCreateProviderSession, second.shouldCreateProviderSession].filter(Boolean)).toHaveLength(1);
      const owner = first.shouldCreateProviderSession ? first : second;
      const reused = first.shouldCreateProviderSession ? second : first;
      expect(reused.attempt).toMatchObject({ id: owner.id, launchState: "reserved" });

      const exactReplay = await repository.reservePendingAgeVerification!({
        userId,
        idempotencyKey: owner.idempotencyKey!,
        requestHash: owner.idempotencyKey?.startsWith("first-") ? "1".repeat(64) : "2".repeat(64),
        ...(owner.providerPreference ? { providerPreference: owner.providerPreference } : {})
      });
      expect(exactReplay.id).toBe(owner.id);
      expect(exactReplay.shouldCreateProviderSession).toBe(true);

      await expect(repository.reservePendingAgeVerification!({
        userId,
        idempotencyKey: owner.idempotencyKey!,
        requestHash: "f".repeat(64),
        ...(owner.providerPreference ? { providerPreference: owner.providerPreference } : {})
      })).rejects.toThrow("IDEMPOTENCY_KEY_REUSED");

      await repository.selectPendingAgeProvider!({
        sessionId: owner.id,
        provider: "yoti",
        method: "age_estimation",
        assuranceLevel: "medium",
        reusable: false
      });
      const reconciling = await repository.findAgeVerificationAttempt!({ userId, sessionId: owner.id });
      expect(reconciling).toMatchObject({
        id: owner.id,
        provider: "yoti",
        launchState: "reconciling",
        status: "submitted"
      });

      await repository.recordAgeVerificationReconciliationAttempt!({
        userId,
        sessionId: owner.id
      });
      const selectorRows = await sql<Array<{
        reconciliation_attempts: number;
        last_reconciled_at: Date | null;
      }>>`
        select reconciliation_attempts, last_reconciled_at
        from private.current_verification_attempt('user', ${userId}, 'age_access')
      `;
      expect(selectorRows[0]?.reconciliation_attempts).toBe(1);
      expect(selectorRows[0]?.last_reconciled_at).toBeInstanceOf(Date);

      const differentKey = await repository.reservePendingAgeVerification!({
        userId,
        idempotencyKey: `third-${userId}`,
        requestHash: "3".repeat(64),
        providerPreference: "didit"
      });
      expect(differentKey.id).toBe(owner.id);
      expect(differentKey.shouldCreateProviderSession).toBe(false);

      await repository.completePendingAgeVerification!({
        sessionId: owner.id,
        providerSession: {
          provider: "yoti",
          providerReference: `yoti-${userId}`,
          providerExternalUserId: owner.subjectReference,
          launchUrl: `https://age.yoti.example/session/${userId}`,
          expiresAt: new Date("2026-12-01T12:15:00.123456Z"),
          rule: "over_18"
        }
      });
      const ready = await repository.findAgeVerificationAttempt!({ userId, sessionId: owner.id });
      expect(ready).toEqual({
        id: owner.id,
        provider: "yoti",
        providerReference: `yoti-${userId}`,
        launchUrl: `https://age.yoti.example/session/${userId}`,
        expiresAt: "2026-12-01T12:15:00.123Z",
        launchState: "ready",
        status: "pending",
        resumable: true
      });

      const stored = await sql<Array<{ launch_url: string | null; session_count: number }>>`
        select
          metadata ->> 'launchUrl' as launch_url,
          (select count(*)::int from verification_sessions
            where subject_type = 'user' and subject_id = ${userId} and purpose = 'age_access') as session_count
        from verification_records
        where metadata ->> 'sessionId' = ${owner.id}
          and metadata ->> 'source' = 'verification_session_reservation'
        limit 1
      `;
      expect(stored[0]).toEqual({
        launch_url: `https://age.yoti.example/session/${userId}`,
        session_count: 1
      });
    } finally {
      const recordIds = await sql<Array<{ id: string }>>`
        select id from verification_records where subject_id = ${userId}
      `;
      const sessionIds = await sql<Array<{ id: string }>>`
        select id from verification_sessions where subject_id = ${userId}
      `;
      const auditSubjectIds = [...recordIds, ...sessionIds].map((row) => row.id);
      if (auditSubjectIds.length > 0) {
        await sql`delete from audit_events where subject_id in ${sql(auditSubjectIds)}`;
      }
      if (sessionIds.length > 0) {
        await sql`delete from verification_events where session_id in ${sql(sessionIds.map((row) => row.id))}`;
      }
      await sql`delete from verification_records where subject_id = ${userId}`;
      await sql`delete from verification_sessions where subject_id = ${userId}`;
      await sql`delete from users where id = ${userId}`;
    }
  });
});
