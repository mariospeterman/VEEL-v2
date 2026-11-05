import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgresAgeRepository } from "../src/modules/age/age-repository";
import { createPostgresVerificationRepository } from "../src/modules/verification/verification-repository";
import { createPostgresClient } from "../src/shared/postgres";
import { guardedIntegrationDatabaseUrl } from "./integration-database.js";

const enabled = ["1", "true"].includes(process.env.VEEL_ENABLE_REAL_API_INTEGRATION_TESTS ?? "");
const describeIntegration = enabled ? describe : describe.skip;

describeIntegration("Didit verification decisions against Postgres", () => {
  let sql: ReturnType<typeof createPostgresClient> | undefined;

  beforeAll(() => {
    const databaseUrl = guardedIntegrationDatabaseUrl();
    sql = createPostgresClient(databaseUrl);
  });

  afterAll(async () => {
    await sql?.end({ timeout: 5 });
  });

  it("derives age access from an approved documentary adult-publisher decision", async () => {
    if (!sql) throw new Error("Postgres test client was not initialized");
    const userId = randomUUID();
    const supabaseUserId = userId;
    const providerReference = `didit-${randomUUID()}`;
    const providerEventId = randomUUID();
    const repository = createPostgresVerificationRepository(sql);

    await sql`insert into users (id, supabase_user_id) values (${userId}, ${supabaseUserId})`;
    await sql`
      insert into creator_monetisation_settings (
        user_id, support_enabled, content_unlocks_enabled, live_passes_enabled,
        paid_messages_enabled, subscriptions_enabled
      ) values (${userId}, true, false, false, false, false)
    `;
    await sql`
      insert into recipient_monetisation_overrides (
        user_id, kyc_requirement, reason_code
      ) values (${userId}, 'required', 'verification_integration_test')
    `;
    try {
      await repository.createPendingSession({
        supabaseUserId,
        purpose: "adult_publisher_eligibility",
        policyVersion: "adult-publisher-2026-08-v1",
        termsAcceptedAt: new Date(),
        providerSession: {
          provider: "didit",
          providerReference,
          providerSessionId: providerReference,
          launchUrl: "https://verify.didit.me/session/test",
          expiresAt: new Date(Date.now() + 86_400_000),
          method: "gov_id_selfie",
          assuranceLevel: "documentary",
          reusable: false
        }
      });

      const result = await repository.applyProviderWebhook({
        provider: "didit",
        providerEventId,
        providerReference,
        eventType: "status.updated",
        status: "valid",
        signatureHash: "a".repeat(64),
        payloadHash: "b".repeat(64),
        occurredAt: new Date(),
        identityEvidence: {
          documentApproved: true,
          livenessApproved: true,
          faceMatchApproved: true
        }
      });

      expect(result).toBe("applied");
      const status = await repository.resolveCapabilities({ supabaseUserId });
      expect(status.capabilities.canAccessApp).toBe(true);
      expect(status.capabilities.canPublishAdultMedia).toBe(true);
      expect(status.capabilities.canMonetize).toBe(false);

      const derived = await sql<Array<{ derived_from_record_id: string | null }>>`
        select derived_from_record_id
        from verification_records
        where subject_id = ${userId} and purpose = 'age_access' and status = 'valid'
        order by created_at desc
        limit 1
      `;
      expect(derived[0]?.derived_from_record_id).toBeTruthy();
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
      await sql`delete from verification_events where idempotency_key = ${providerEventId}`;
      await sql`delete from verification_records where subject_id = ${userId}`;
      await sql`delete from verification_sessions where subject_id = ${userId}`;
      await sql`delete from recipient_monetisation_overrides where user_id = ${userId}`;
      await sql`delete from creator_monetisation_settings where user_id = ${userId}`;
      await sql`delete from users where id = ${userId}`;
    }
  });

  it("reconciles a pre-attach Sumsub decision with monotonic chronology and durable evidence", async () => {
    if (!sql) throw new Error("Postgres test client was not initialized");
    const userId = randomUUID();
    const supabaseUserId = userId;
    const repository = createPostgresVerificationRepository(sql);
    await sql`
      insert into users (id, supabase_user_id, state)
      values (${userId}, ${supabaseUserId}, 'provisional')
    `;
    await sql`
      insert into profiles (user_id, handle, display_name, visibility)
      values (${userId}, ${`auth_${userId.replaceAll("-", "").slice(0, 24)}`}, 'Verification test', 'private')
    `;

    try {
      const reservation = await repository.reservePendingSession?.({
        supabaseUserId,
        purpose: "age_access",
        idempotencyKey: `age-${userId}`,
        requestHash: "1".repeat(64)
      });
      expect(reservation).toBeTruthy();
      if (!reservation) throw new Error("Missing verification reservation");

      await repository.selectPendingSessionProvider?.({
        sessionId: reservation.id,
        selection: {
          provider: "sumsub",
          method: "gov_id_selfie",
          assuranceLevel: "documentary",
          reusable: false
        }
      });

      const reservedRows = await sql<Array<{ sessions: number; records: number }>>`
        select
          (select count(*)::int from verification_sessions where id = ${reservation.id}) as sessions,
          (select count(*)::int from verification_records
            where metadata ->> 'sessionId' = ${reservation.id}) as records
      `;
      expect(reservedRows[0]).toEqual({ sessions: 1, records: 1 });

      const approvedAt = new Date("2026-11-04T12:00:00.000Z");
      const approved = await repository.applyProviderWebhook({
        provider: "sumsub",
        providerEventId: `sumsub:${"a".repeat(64)}`,
        providerReference: `applicant-${userId}`,
        providerSubjectReference: reservation.subjectReference,
        providerCorrelationId: "shared-operation",
        eventType: "applicantReviewed",
        status: "valid",
        signatureHash: "2".repeat(64),
        payloadHash: "a".repeat(64),
        occurredAt: approvedAt
      });
      expect(approved).toBe("applied");

      await repository.completePendingSession?.({
        sessionId: reservation.id,
        providerSession: {
          provider: "sumsub",
          providerReference: reservation.subjectReference,
          providerExternalUserId: reservation.subjectReference,
          launchUrl: "https://in.sumsub.example/websdk/p/test",
          expiresAt: new Date("2026-11-04T11:30:00.000Z"),
          method: "gov_id_selfie",
          assuranceLevel: "documentary",
          reusable: false
        }
      });

      const blockedAt = new Date("2026-11-04T13:00:00.000Z");
      const blocked = await repository.applyProviderWebhook({
        provider: "sumsub",
        providerEventId: `sumsub:${"b".repeat(64)}`,
        providerReference: `applicant-${userId}`,
        providerSubjectReference: reservation.subjectReference,
        providerCorrelationId: "shared-operation",
        eventType: "applicantReviewed",
        status: "blocked",
        signatureHash: "3".repeat(64),
        payloadHash: "b".repeat(64),
        occurredAt: blockedAt,
        failureReasonCode: "FINAL"
      });
      expect(blocked).toBe("applied");

      const lateApproval = await repository.applyProviderWebhook({
        provider: "sumsub",
        providerEventId: `sumsub:${"c".repeat(64)}`,
        providerReference: `applicant-${userId}`,
        providerSubjectReference: reservation.subjectReference,
        providerCorrelationId: "shared-operation",
        eventType: "applicantReviewed",
        status: "valid",
        signatureHash: "4".repeat(64),
        payloadHash: "c".repeat(64),
        occurredAt: new Date("2026-11-04T12:30:00.000Z")
      });
      expect(lateApproval).toBe("duplicate");

      const exactRetry = await repository.applyProviderWebhook({
        provider: "sumsub",
        providerEventId: `sumsub:${"b".repeat(64)}`,
        providerReference: `applicant-${userId}`,
        providerSubjectReference: reservation.subjectReference,
        providerCorrelationId: "shared-operation",
        eventType: "applicantReviewed",
        status: "blocked",
        signatureHash: "3".repeat(64),
        payloadHash: "b".repeat(64),
        occurredAt: blockedAt,
        failureReasonCode: "FINAL"
      });
      expect(exactRetry).toBe("duplicate");

      const rows = await sql<Array<{
        user_state: string;
        visibility: string;
        applicant_id: string | null;
        valid_expires_at: Date | null;
        valid_threshold: number | null;
        valid_over_threshold: boolean | null;
        final_status: string;
        event_count: number;
      }>>`
        select
          u.state as user_state,
          p.visibility,
          s.provider_applicant_id as applicant_id,
          (select expires_at from verification_records
            where subject_id = ${userId} and purpose = 'age_access' and status = 'valid'
            order by provider_event_at desc limit 1) as valid_expires_at,
          (select threshold_age from verification_records
            where subject_id = ${userId} and purpose = 'age_access' and status = 'valid'
            order by provider_event_at desc limit 1) as valid_threshold,
          (select result_over_threshold from verification_records
            where subject_id = ${userId} and purpose = 'age_access' and status = 'valid'
            order by provider_event_at desc limit 1) as valid_over_threshold,
          (select status from verification_records
            where subject_id = ${userId} and purpose = 'age_access'
            order by provider_event_at desc nulls last, created_at desc limit 1) as final_status,
          (select count(*)::int from verification_events where session_id = ${reservation.id}) as event_count
        from users u
        join profiles p on p.user_id = u.id
        join verification_sessions s on s.id = ${reservation.id}
        where u.id = ${userId}
      `;
      expect(rows[0]).toMatchObject({
        user_state: "active",
        visibility: "private",
        applicant_id: `applicant-${userId}`,
        valid_expires_at: null,
        valid_threshold: 18,
        valid_over_threshold: true,
        final_status: "blocked",
        event_count: 3
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
      await sql`delete from profiles where user_id = ${userId}`;
      await sql`delete from users where id = ${userId}`;
    }
  });

  it("keeps direct age-provider evidence durable and monotonic", async () => {
    if (!sql) throw new Error("Postgres test client was not initialized");
    const userId = randomUUID();
    const repository = createPostgresAgeRepository(sql);
    await sql`
      insert into users (id, supabase_user_id, state)
      values (${userId}, ${userId}, 'provisional')
    `;
    await sql`
      insert into profiles (user_id, handle, display_name, visibility)
      values (${userId}, ${`age_${userId.replaceAll("-", "").slice(0, 24)}`}, 'Age test', 'private')
    `;

    try {
      const reservation = await repository.reservePendingAgeVerification?.({
        userId,
        idempotencyKey: `age-direct-${userId}`,
        requestHash: "5".repeat(64)
      });
      expect(reservation).toBeTruthy();
      if (!reservation) throw new Error("Missing age-verification reservation");

      await repository.selectPendingAgeProvider?.({
        sessionId: reservation.id,
        provider: "yoti",
        method: "age_estimation",
        assuranceLevel: "medium",
        reusable: false
      });
      const approvedAt = new Date("2026-11-04T14:00:00.000Z");
      expect(await repository.applyProviderWebhook({
        provider: "yoti",
        providerEventId: `yoti-${randomUUID()}`,
        providerReference: `yoti-session-${userId}`,
        providerSubjectReference: reservation.subjectReference,
        eventType: "age_verification",
        state: "verified",
        verifiedAt: approvedAt,
        signatureHash: "6".repeat(64),
        payloadHash: "7".repeat(64)
      })).toBe("applied");

      await repository.completePendingAgeVerification?.({
        sessionId: reservation.id,
        providerSession: {
          provider: "yoti",
          providerReference: `yoti-session-${userId}`,
          providerExternalUserId: reservation.subjectReference,
          launchUrl: "https://age.yoti.example/session/test",
          expiresAt: new Date("2026-11-04T13:30:00.000Z"),
          rule: "over_18"
        }
      });
      expect(await repository.findLatestAgeStatusByUserId?.(userId)).toEqual({
        state: "verified",
        provider: "yoti"
      });

      const failedAt = new Date("2026-11-04T15:00:00.000Z");
      expect(await repository.applyProviderWebhook({
        provider: "yoti",
        providerEventId: `yoti-${randomUUID()}`,
        providerReference: `yoti-session-${userId}`,
        providerSubjectReference: reservation.subjectReference,
        eventType: "age_verification",
        state: "failed",
        verifiedAt: failedAt,
        failureCode: "REVOKED",
        signatureHash: "8".repeat(64),
        payloadHash: "9".repeat(64)
      })).toBe("applied");
      expect(await repository.updateVerificationFromWebhook({
        provider: "yoti",
        providerEventId: `yoti-${randomUUID()}`,
        providerReference: `yoti-session-${userId}`,
        providerSubjectReference: reservation.subjectReference,
        state: "verified",
        verifiedAt: new Date("2026-11-04T14:30:00.000Z")
      })).toBe(false);

      const rows = await sql<Array<{
        state: string;
        visibility: string;
        valid_expires_at: Date | null;
        threshold_age: number | null;
        result_over_threshold: boolean | null;
        final_status: string;
      }>>`
        select
          u.state,
          p.visibility,
          (select expires_at from verification_records
            where subject_id = ${userId} and purpose = 'age_access' and status = 'valid'
            order by provider_event_at desc limit 1) as valid_expires_at,
          (select threshold_age from verification_records
            where subject_id = ${userId} and purpose = 'age_access' and status = 'valid'
            order by provider_event_at desc limit 1) as threshold_age,
          (select result_over_threshold from verification_records
            where subject_id = ${userId} and purpose = 'age_access' and status = 'valid'
            order by provider_event_at desc limit 1) as result_over_threshold,
          (select status from verification_records
            where subject_id = ${userId} and purpose = 'age_access'
            order by provider_event_at desc nulls last, created_at desc limit 1) as final_status
        from users u
        join profiles p on p.user_id = u.id
        where u.id = ${userId}
      `;
      expect(rows[0]).toEqual({
        state: "active",
        visibility: "private",
        valid_expires_at: null,
        threshold_age: 18,
        result_over_threshold: true,
        final_status: "blocked"
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
      await sql`delete from profiles where user_id = ${userId}`;
      await sql`delete from users where id = ${userId}`;
    }
  });
});
