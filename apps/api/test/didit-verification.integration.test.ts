import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgresVerificationRepository } from "../src/modules/verification/verification-repository";
import { createPostgresClient } from "../src/shared/postgres";

const enabled = ["1", "true"].includes(process.env.VEEL_ENABLE_REAL_API_INTEGRATION_TESTS ?? "");
const describeIntegration = enabled ? describe : describe.skip;

describeIntegration("Didit verification decisions against Postgres", () => {
  let sql: ReturnType<typeof createPostgresClient> | undefined;

  beforeAll(() => {
    const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error("TEST_DATABASE_URL or DATABASE_URL is required");
    sql = createPostgresClient(databaseUrl);
  });

  afterAll(async () => {
    await sql?.end({ timeout: 5 });
  });

  it("derives age access from an approved documentary adult-publisher decision", async () => {
    if (!sql) throw new Error("Postgres test client was not initialized");
    const userId = randomUUID();
    const supabaseUserId = randomUUID();
    const providerReference = `didit-${randomUUID()}`;
    const providerEventId = randomUUID();
    const repository = createPostgresVerificationRepository(sql);

    await sql`insert into users (id, supabase_user_id) values (${userId}, ${supabaseUserId})`;
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
      await sql`delete from users where id = ${userId}`;
    }
  });
});
