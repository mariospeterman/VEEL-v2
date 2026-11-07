import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createFeatureFlagRepository } from "../src/modules/admin/admin-repository-feature-flag.js";
import { createModerationRepository } from "../src/modules/admin/admin-repository-moderation.js";
import { createPrivacyRepository } from "../src/modules/admin/admin-repository-privacy.js";
import { createSupportRepository } from "../src/modules/admin/admin-repository-support.js";
import { createProfileMutationRepositoryMethods } from "../src/modules/profile/profile-mutation-repository.js";
import { ProfileIdempotencyConflictError } from "../src/modules/profile/profile-errors.js";
import { MutationCommandIdempotencyConflictError } from "../src/shared/mutation-command-receipt.js";
import { createPostgresClient } from "../src/shared/postgres.js";
import { guardedIntegrationDatabaseUrl } from "./integration-database.js";

const enabled = ["1", "true"].includes(
  process.env.VEEL_ENABLE_REAL_API_INTEGRATION_TESTS ?? ""
);
const describeIntegration = enabled ? describe : describe.skip;

describeIntegration("durable admin/profile command idempotency against migrated Postgres", () => {
  it("replays the original profile response after a newer mutation and isolates actors", async () => {
    const sql = createPostgresClient(guardedIntegrationDatabaseUrl());
    const repository = createProfileMutationRepositoryMethods(sql);
    const actorA = randomUUID();
    const actorB = randomUUID();
    const suffix = actorA.replaceAll("-", "").slice(0, 10);
    const firstKey = `profile-a-${suffix}`;
    const secondKey = `profile-b-${suffix}`;
    const concurrentKey = `profile-concurrent-${suffix}`;
    const firstBody = {
      idempotencyKey: firstKey,
      handle: `first_${suffix}`,
      displayName: "First response"
    };

    try {
      await sql`
        insert into users (id, supabase_user_id, state) values
          (${actorA}, ${actorA}, 'active'),
          (${actorB}, ${actorB}, 'active')
      `;

      const first = await repository.upsertMyProfile(actorA, firstBody);
      const second = await repository.upsertMyProfile(actorA, {
        idempotencyKey: secondKey,
        handle: `second_${suffix}`,
        displayName: "Second response"
      });
      const replay = await repository.upsertMyProfile(actorA, firstBody);

      expect(first.displayName).toBe("First response");
      expect(second.displayName).toBe("Second response");
      expect(replay).toEqual(first);
      const canonical = await sql<Array<{ handle: string; display_name: string }>>`
        select handle, display_name from profiles where user_id = ${actorA}
      `;
      expect(canonical[0]).toEqual({
        handle: `second_${suffix}`,
        display_name: "Second response"
      });

      await expect(repository.upsertMyProfile(actorA, {
        ...firstBody,
        displayName: "Changed input"
      })).rejects.toBeInstanceOf(ProfileIdempotencyConflictError);

      await expect(repository.upsertMyProfile(actorB, {
        idempotencyKey: firstKey,
        handle: `other_${suffix}`,
        displayName: "Other actor"
      })).resolves.toMatchObject({ displayName: "Other actor" });

      const concurrentInput = {
        idempotencyKey: concurrentKey,
        handle: `parallel_${suffix}`,
        displayName: "Parallel response"
      };
      const concurrent = await Promise.all([
        repository.upsertMyProfile(actorA, concurrentInput),
        repository.upsertMyProfile(actorA, concurrentInput)
      ]);
      expect(concurrent[0]).toEqual(concurrent[1]);

      const receipts = await sql<Array<{
        actor_user_id: string;
        action: string;
        target_type: string;
        target_id: string;
        request_version: number;
        request_body_hash: string;
      }>>`
        select actor_user_id, action, target_type, target_id, request_version, request_body_hash
        from mutation_command_receipts
        where idempotency_key in (${firstKey}, ${secondKey}, ${concurrentKey})
          and action = 'profile.update'
        order by actor_user_id, idempotency_key
      `;
      expect(receipts.filter((receipt) => receipt.actor_user_id === actorA)).toHaveLength(3);
      expect(receipts).toEqual(expect.arrayContaining([
        expect.objectContaining({
          actor_user_id: actorA,
          action: "profile.update",
          target_type: "profile",
          target_id: actorA,
          request_version: 1,
          request_body_hash: expect.stringMatching(/^[a-f0-9]{64}$/)
        }),
        expect.objectContaining({ actor_user_id: actorB })
      ]));
    } finally {
      await sql`
        delete from mutation_command_receipts
        where actor_user_id in (${actorA}, ${actorB})
      `;
      await sql`delete from profiles where user_id in (${actorA}, ${actorB})`;
      await sql`delete from users where id in (${actorA}, ${actorB})`;
      await sql.end({ timeout: 5 });
    }
  });

  it("binds admin keys to body and target, preserves A after B, and serializes concurrency", async () => {
    const sql = createPostgresClient(guardedIntegrationDatabaseUrl());
    const repository = createFeatureFlagRepository(sql);
    const actorA = randomUUID();
    const actorB = randomUUID();
    const suffix = actorA.replaceAll("-", "").slice(0, 10);
    const flagA = `test.command.${suffix}.a`;
    const flagB = `test.command.${suffix}.b`;
    const keyA = `flag-a-${suffix}`;
    const keyB = `flag-b-${suffix}`;
    const concurrentKey = `flag-concurrent-${suffix}`;
    const firstBody = { value: { enabled: true, revision: 1 }, state: "active" as const, reason: "A" };

    try {
      await sql`
        insert into users (id, supabase_user_id, state) values
          (${actorA}, ${actorA}, 'active'),
          (${actorB}, ${actorB}, 'active')
      `;
      await sql`
        insert into feature_flags (key, value, category, state) values
          (${flagA}, ${JSON.stringify({ enabled: false })}::jsonb, 'feature', 'active'),
          (${flagB}, ${JSON.stringify({ enabled: false })}::jsonb, 'feature', 'active')
      `;

      const first = await repository.updateFeatureFlag({
        supabaseUserId: actorA,
        featureFlagKey: flagA,
        body: firstBody,
        idempotencyKey: keyA
      });
      const second = await repository.updateFeatureFlag({
        supabaseUserId: actorA,
        featureFlagKey: flagA,
        body: { value: { enabled: false, revision: 2 }, state: "paused", reason: "B" },
        idempotencyKey: keyB
      });
      const replay = await repository.updateFeatureFlag({
        supabaseUserId: actorA,
        featureFlagKey: flagA,
        body: firstBody,
        idempotencyKey: keyA
      });

      expect(replay).toEqual(first);
      expect(second).toMatchObject({ value: { enabled: false, revision: 2 }, state: "paused" });
      const canonical = await repository.getFeatureFlag(flagA);
      expect(canonical).toMatchObject({ value: { enabled: false, revision: 2 }, state: "paused" });

      await expect(repository.updateFeatureFlag({
        supabaseUserId: actorA,
        featureFlagKey: flagA,
        body: { ...firstBody, reason: "changed" },
        idempotencyKey: keyA
      })).rejects.toBeInstanceOf(MutationCommandIdempotencyConflictError);
      await expect(repository.updateFeatureFlag({
        supabaseUserId: actorA,
        featureFlagKey: flagB,
        body: firstBody,
        idempotencyKey: keyA
      })).rejects.toBeInstanceOf(MutationCommandIdempotencyConflictError);
      await expect(repository.updateFeatureFlag({
        supabaseUserId: actorB,
        featureFlagKey: flagB,
        body: firstBody,
        idempotencyKey: keyA
      })).resolves.toMatchObject({ key: flagB, value: { enabled: true, revision: 1 } });

      const concurrentInput = {
        supabaseUserId: actorA,
        featureFlagKey: flagA,
        body: { value: { enabled: true, revision: 3 }, state: "active" as const, reason: "C" },
        idempotencyKey: concurrentKey
      };
      const concurrent = await Promise.all([
        repository.updateFeatureFlag(concurrentInput),
        repository.updateFeatureFlag(concurrentInput)
      ]);
      expect(concurrent[0]).toEqual(concurrent[1]);

      const auditCount = await sql<{ count: number }[]>`
        select count(*)::integer as count
        from audit_events
        where actor_user_id = ${actorA}
          and action = 'feature_flag_updated'
          and metadata ->> 'idempotencyKey' = ${concurrentKey}
      `;
      expect(auditCount[0]?.count).toBe(1);
    } finally {
      await sql`delete from audit_events where actor_user_id in (${actorA}, ${actorB})`;
      await sql`delete from mutation_command_receipts where actor_user_id in (${actorA}, ${actorB})`;
      await sql`delete from feature_flags where key in (${flagA}, ${flagB})`;
      await sql`delete from users where id in (${actorA}, ${actorB})`;
      await sql.end({ timeout: 5 });
    }
  });

  it("replays durable responses across report, support, and privacy admin mutations", async () => {
    const sql = createPostgresClient(guardedIntegrationDatabaseUrl());
    const moderationRepository = createModerationRepository(sql);
    const supportRepository = createSupportRepository(sql);
    const privacyRepository = createPrivacyRepository(sql);
    const actorId = randomUUID();
    const requesterId = randomUUID();
    const organizationId = randomUUID();
    const reportId = randomUUID();
    const supportCaseId = randomUUID();
    const supportPolicyId = randomUUID();
    const dataRequestId = randomUUID();
    const suffix = actorId.replaceAll("-", "").slice(0, 10);

    try {
      await sql`
        insert into users (id, supabase_user_id, state) values
          (${actorId}, ${actorId}, 'active'),
          (${requesterId}, ${requesterId}, 'active')
      `;
      await sql`
        insert into organizations (id, name)
        values (${organizationId}, ${`AUTH-10 ${suffix}`})
      `;
      await sql`
        insert into reports (
          id, reporter_user_id, subject_type, subject_id, reason, queue, idempotency_key
        ) values (
          ${reportId}, ${requesterId}, 'user', ${requesterId}, 'Fixture report', 'user', ${`fixture-${suffix}`}
        )
      `;
      await sql`
        insert into support_cases (id, requester_user_id, category)
        values (${supportCaseId}, ${requesterId}, 'account')
      `;
      await sql`
        insert into organization_support_policies (id, organization_id)
        values (${supportPolicyId}, ${organizationId})
      `;
      await sql`
        insert into data_requests (id, requester_user_id, type, idempotency_key)
        values (${dataRequestId}, ${requesterId}, 'delete', ${`fixture-data-${suffix}`})
      `;

      const reportInput = {
        supabaseUserId: actorId,
        reportId,
        body: { state: "reviewing" as const, reason: "Review started" },
        idempotencyKey: `report-${suffix}`
      };
      const firstReport = await moderationRepository.updateReport(reportInput);
      expect(await moderationRepository.updateReport(reportInput)).toEqual(firstReport);

      const supportCaseInput = {
        supabaseUserId: actorId,
        supportCaseId,
        body: { state: "resolved" as const, reason: "Case resolved" },
        idempotencyKey: `support-case-${suffix}`
      };
      const firstCase = await supportRepository.updateSupportCase(supportCaseInput);
      expect(await supportRepository.updateSupportCase(supportCaseInput)).toEqual(firstCase);

      const supportPolicyInput = {
        supabaseUserId: actorId,
        supportPolicyId,
        body: {
          supportState: "priority" as const,
          slaTier: "priority" as const,
          state: "active" as const,
          reason: "Policy approved"
        },
        idempotencyKey: `support-policy-${suffix}`
      };
      const firstPolicy = await supportRepository.updateSupportPolicy(supportPolicyInput);
      expect(await supportRepository.updateSupportPolicy(supportPolicyInput)).toEqual(firstPolicy);

      const dataRequestInput = {
        supabaseUserId: actorId,
        dataRequestId,
        body: { state: "processing" as const, reason: "Request verified" },
        idempotencyKey: `data-request-${suffix}`
      };
      const firstDataRequest = await privacyRepository.updateDataRequest(dataRequestInput);
      expect(await privacyRepository.updateDataRequest(dataRequestInput)).toEqual(firstDataRequest);

      const receiptActions = await sql<Array<{ action: string }>>`
        select action
        from mutation_command_receipts
        where actor_user_id = ${actorId}
        order by action
      `;
      expect(receiptActions.map((receipt) => receipt.action)).toEqual([
        "admin.data_request.update",
        "admin.report.update",
        "admin.support_case.update",
        "admin.support_policy.update"
      ]);
    } finally {
      await sql`delete from audit_events where actor_user_id = ${actorId}`;
      await sql`delete from mutation_command_receipts where actor_user_id = ${actorId}`;
      await sql`delete from data_requests where id = ${dataRequestId}`;
      await sql`delete from organization_support_policies where id = ${supportPolicyId}`;
      await sql`delete from support_cases where id = ${supportCaseId}`;
      await sql`delete from reports where id = ${reportId}`;
      await sql`delete from organizations where id = ${organizationId}`;
      await sql`delete from users where id in (${actorId}, ${requesterId})`;
      await sql.end({ timeout: 5 });
    }
  });

  it("replays content moderation and refund responses without repeating side effects", async () => {
    const sql = createPostgresClient(guardedIntegrationDatabaseUrl());
    const moderationRepository = createModerationRepository(sql);
    const privacyRepository = createPrivacyRepository(sql);
    const actorId = randomUUID();
    const creatorId = randomUUID();
    const contentId = randomUUID();
    const safetyCaseId = randomUUID();
    const paymentIntentId = randomUUID();
    const paymentTargetId = randomUUID();
    const refundDisputeId = randomUUID();
    const suffix = actorId.replaceAll("-", "").slice(0, 10);

    try {
      await sql`
        insert into users (id, supabase_user_id, state) values
          (${actorId}, ${actorId}, 'active'),
          (${creatorId}, ${creatorId}, 'active')
      `;
      await sql`
        insert into profiles (user_id, handle, display_name)
        values (${creatorId}, ${`creator_${suffix}`}, 'Fixture creator')
      `;
      await sql`
        insert into content_items (
          id, creator_user_id, media_type, state, moderation_state, publish_state
        ) values (
          ${contentId}, ${creatorId}, 'image', 'ready', 'pending', 'submitted_for_review'
        )
      `;
      await sql`
        insert into media_safety_cases (
          id, content_item_id, declared_rating, state, policy_version
        ) values (
          ${safetyCaseId}, ${contentId}, 'none', 'review_required', 'auth10-test-v1'
        )
      `;
      await sql`
        insert into payment_intents (
          id,
          user_id,
          product_type,
          target_id,
          amount_minor,
          currency,
          state,
          idempotency_key,
          request_hash,
          solana_cluster,
          treasury_wallet,
          reference_address,
          expires_at,
          withdrawal_waiver_accepted_at,
          creator_wallet,
          platform_fee_wallet,
          total_amount_minor,
          creator_amount_minor,
          platform_fee_amount_minor,
          creator_side_proceeds_minor,
          platform_fee_gross_minor
        ) values (
          ${paymentIntentId},
          ${creatorId},
          'content_unlock',
          ${paymentTargetId},
          100,
          'SOL',
          'pending',
          ${`payment-${suffix}`},
          ${"a".repeat(64)},
          'devnet',
          ${`treasury-${suffix}`},
          ${`reference-${suffix}`},
          now() + interval '10 minutes',
          now(),
          ${`creator-wallet-${suffix}`},
          ${`platform-wallet-${suffix}`},
          100,
          90,
          10,
          90,
          10
        )
      `;
      await sql`
        insert into refunds_and_disputes (
          id,
          payment_intent_id,
          reporter_user_id,
          kind,
          requested_action,
          reason,
          idempotency_key,
          request_hash
        ) values (
          ${refundDisputeId},
          ${paymentIntentId},
          ${creatorId},
          'refund_request',
          'review_only',
          'Fixture refund request',
          ${`fixture-refund-${suffix}`},
          ${"b".repeat(64)}
        )
      `;

      const moderationInput = {
        supabaseUserId: actorId,
        contentId,
        body: { action: "block" as const, reason: "Policy block confirmed" },
        idempotencyKey: `moderation-${suffix}`
      };
      const firstModeration = await moderationRepository.updateContentModeration(moderationInput);
      expect(await moderationRepository.updateContentModeration(moderationInput)).toEqual(firstModeration);

      const refundInput = {
        supabaseUserId: actorId,
        refundDisputeId,
        body: {
          state: "reviewing" as const,
          resolution: "Review opened",
          reason: "Evidence under review"
        },
        idempotencyKey: `refund-${suffix}`
      };
      const firstRefund = await privacyRepository.updateRefundDispute(refundInput);
      expect(await privacyRepository.updateRefundDispute(refundInput)).toEqual(firstRefund);

      const auditCounts = await sql<Array<{ action: string; count: number }>>`
        select action, count(*)::integer as count
        from audit_events
        where actor_user_id = ${actorId}
        group by action
        order by action
      `;
      expect(auditCounts).toEqual([
        { action: "content_moderation_updated", count: 1 },
        { action: "refund_dispute_updated", count: 1 }
      ]);
    } finally {
      await sql`delete from audit_events where actor_user_id = ${actorId}`;
      await sql`delete from mutation_command_receipts where actor_user_id = ${actorId}`;
      await sql`delete from refund_remediation_evidence where refund_dispute_id = ${refundDisputeId}`;
      await sql`delete from refunds_and_disputes where id = ${refundDisputeId}`;
      await sql`delete from payment_intents where id = ${paymentIntentId}`;
      await sql`delete from content_items where id = ${contentId}`;
      await sql`delete from profiles where user_id = ${creatorId}`;
      await sql`delete from users where id in (${actorId}, ${creatorId})`;
      await sql.end({ timeout: 5 });
    }
  });
});
