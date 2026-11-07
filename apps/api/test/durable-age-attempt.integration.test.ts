import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApi } from "../src/app";
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

      const providerSelection = {
        sessionId: owner.id,
        provider: "yoti" as const,
        method: "age_estimation" as const,
        assuranceLevel: "medium",
        reusable: false
      };
      const claims = await Promise.all([
        repository.selectPendingAgeProvider!(providerSelection),
        repository.selectPendingAgeProvider!(providerSelection)
      ]);
      expect(claims.sort()).toEqual([false, true]);
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

  it("lets only one concurrent same-key route request create a provider session with native storage", async () => {
    if (!sql) throw new Error("Postgres test client was not initialized");
    const databaseUrl = guardedIntegrationDatabaseUrl();
    const routeSql = createPostgresClient(databaseUrl);
    const userId = randomUUID();
    const authToken = `native-age-route-${userId}`;
    const providerReference = `yoti-native-route-${userId}`;
    const repository = createPostgresAgeRepository(routeSql);
    let remoteCreates = 0;
    let releaseProviderCreate: (() => void) | undefined;
    let markProviderCreateStarted: (() => void) | undefined;
    const providerCreateStarted = new Promise<void>((resolve) => {
      markProviderCreateStarted = resolve;
    });
    const providerCreateRelease = new Promise<void>((resolve) => {
      releaseProviderCreate = resolve;
    });
    const app = await buildApi({
      postgresClient: routeSql,
      ageRepository: repository,
      authVerifier: {
        async verifyToken(token) {
          if (token !== authToken) return null;
          return {
            userId,
            supabaseUserId: userId,
            sessionId: randomUUID(),
            authenticatedAt: new Date(),
            authenticationMethod: "wallet"
          };
        }
      },
      ageProviderWaterfall: {
        async createSession(input) {
          await input.onProviderSelected?.({
            provider: "yoti",
            method: "age_estimation",
            assuranceLevel: "medium",
            reusable: false
          });
          remoteCreates += 1;
          markProviderCreateStarted?.();
          await providerCreateRelease;
          return {
            provider: "yoti",
            providerReference,
            launchUrl: `https://age.yoti.example/session/${userId}`,
            expiresAt: new Date(Date.now() + 15 * 60 * 1000),
            rule: "over_18"
          };
        }
      }
    });
    await sql`insert into users (id, supabase_user_id) values (${userId}, ${userId})`;

    try {
      await app.ready();
      const request = () => app.inject({
        method: "POST",
        url: "/v1/age/sessions",
        headers: {
          authorization: `Bearer ${authToken}`,
          "idempotency-key": `native-age-same-key-${userId}`
        },
        payload: { providerPreference: "yoti" }
      });
      const firstRequest = request();
      await providerCreateStarted;
      const secondResponse = await request();
      expect(secondResponse.statusCode, secondResponse.body).toBe(202);
      expect(secondResponse.json()).toMatchObject({
        provider: "yoti",
        launchState: "reconciling",
        status: "submitted"
      });
      releaseProviderCreate?.();
      const firstResponse = await firstRequest;
      expect(firstResponse.statusCode, firstResponse.body).toBe(201);
      expect(firstResponse.json()).toMatchObject({
        provider: "yoti",
        providerReference,
        launchState: "ready",
        status: "pending"
      });
      expect(remoteCreates).toBe(1);

      const rows = await sql<Array<{
        session_count: number;
        ready_count: number;
      }>>`
        select
          count(*)::int as session_count,
          count(*) filter (
            where launch_state = 'ready'
              and provider_session_id = ${providerReference}
          )::int as ready_count
        from verification_sessions
        where subject_type = 'user'
          and subject_id = ${userId}
          and purpose = 'age_access'
      `;
      expect(rows[0]).toEqual({ session_count: 1, ready_count: 1 });
    } finally {
      releaseProviderCreate?.();
      await app.close();
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
  }, 60_000);

  it("moves an unreferenced provider-create outcome to manual review without allowing a replacement", async () => {
    if (!sql) throw new Error("Postgres test client was not initialized");
    const userId = randomUUID();
    const repository = createPostgresAgeRepository(sql);
    await sql`insert into users (id, supabase_user_id) values (${userId}, ${userId})`;

    try {
      const reserved = await repository.reservePendingAgeVerification!({
        userId,
        idempotencyKey: `lost-reference-${userId}`,
        requestHash: "4".repeat(64),
        providerPreference: "yoti"
      });
      expect(await repository.selectPendingAgeProvider!({
        sessionId: reserved.id,
        provider: "yoti",
        method: "age_estimation",
        assuranceLevel: "medium",
        reusable: false
      })).toBe(true);
      await sql`
        update verification_sessions
        set expires_at = now() - interval '1 second'
        where id = ${reserved.id}
      `;

      const terminal = await repository.recordAgeVerificationReconciliationAttempt!({
        userId,
        sessionId: reserved.id
      });
      expect(terminal).toMatchObject({
        id: reserved.id,
        launchState: "reserved",
        status: "needs_review",
        resumable: false
      });
      const terminalFacts = await sql<Array<{
        record_status: string;
        failure_reason_code: string | null;
        audit_count: number;
      }>>`
        select
          record.status as record_status,
          record.failure_reason_code,
          (select count(*)::int from audit_events
            where subject_id = ${reserved.id}
              and action = 'verification.provider_create_reference_requires_review') as audit_count
        from verification_records record
        where record.metadata ->> 'sessionId' = ${reserved.id}
          and record.metadata ->> 'source' = 'verification_session_reservation'
      `;
      expect(terminalFacts[0]).toEqual({
        record_status: "pending",
        failure_reason_code: "provider_create_reference_requires_review",
        audit_count: 1
      });

      const blockedReplacement = await repository.reservePendingAgeVerification!({
        userId,
        idempotencyKey: `replacement-${userId}`,
        requestHash: "5".repeat(64),
        providerPreference: "didit"
      });
      expect(blockedReplacement).toMatchObject({
        id: reserved.id,
        shouldCreateProviderSession: false,
        attempt: {
          launchState: "reserved",
          status: "needs_review",
          resumable: false
        }
      });
      await expect(repository.completePendingAgeVerification!({
        sessionId: reserved.id,
        providerSession: {
          provider: "yoti",
          providerReference: `late-yoti-${userId}`,
          providerExternalUserId: reserved.subjectReference,
          launchUrl: "https://age.yoti.example/session/late",
          expiresAt: new Date(Date.now() + 15 * 60 * 1000),
          rule: "over_18"
        }
      })).rejects.toThrow("VERIFICATION_SESSION_RESERVATION_NOT_FOUND");
      const staleOwnerFence = await sql<Array<{
        old_launch_state: string;
        old_status: string;
        old_provider_session_id: string | null;
      }>>`
        select
          old.launch_state as old_launch_state,
          old.status as old_status,
          old.provider_session_id as old_provider_session_id
        from verification_sessions old
        where old.id = ${reserved.id}
      `;
      expect(staleOwnerFence[0]).toEqual({
        old_launch_state: "reserved",
        old_status: "needs_review",
        old_provider_session_id: null
      });
    } finally {
      const sessionIds = await sql<Array<{ id: string }>>`
        select id from verification_sessions where subject_id = ${userId}
      `;
      if (sessionIds.length > 0) {
        await sql`delete from audit_events where subject_id in ${sql(sessionIds.map((row) => row.id))}`;
        await sql`delete from verification_events where session_id in ${sql(sessionIds.map((row) => row.id))}`;
      }
      await sql`delete from verification_records where subject_id = ${userId}`;
      await sql`delete from verification_sessions where subject_id = ${userId}`;
      await sql`delete from users where id = ${userId}`;
    }
  });
});
