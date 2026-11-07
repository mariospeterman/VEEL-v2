import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgresAgeRepository } from "../src/modules/age/age-repository";
import { createContentPublishRepositoryMethods } from "../src/modules/content/content-publish-repository";
import { recordContentSafetyDeclaration } from "../src/modules/content/content-safety-repository";
import { createPostgresVerificationRepository } from "../src/modules/verification/verification-repository";
import { hashIdempotencyPayload } from "../src/shared/idempotency";
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

  it("does not fabricate age access from an approved documentary adult-publisher decision", async () => {
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
      expect(status.capabilities.canAccessApp).toBe(false);
      expect(status.capabilities.canPublishAdultMedia).toBe(false);
      expect(status.capabilities.canMonetize).toBe(false);
      expect(status.verificationSummary.adultPublisherEligibility).toMatchObject({
        status: "valid",
        thresholdAge: null,
        resultOverThreshold: null
      });

      await sql`
        insert into verification_records (
          subject_type, subject_id, purpose, status, provider, method,
          threshold_age, result_over_threshold, assurance_level, verified_at,
          reusable, metadata
        ) values (
          'user', ${userId}, 'age_access', 'valid', 'manual', 'manual_review',
          18, true, 'high', now(), false,
          ${sql.json({ source: "integration_test_independent_age_fact" })}
        )
      `;

      const statusWithIndependentAge = await repository.resolveCapabilities({ supabaseUserId });
      expect(statusWithIndependentAge.capabilities.canAccessApp).toBe(true);
      expect(statusWithIndependentAge.capabilities.canPublishMedia).toBe(true);
      expect(statusWithIndependentAge.capabilities.canPublishAdultMedia).toBe(false);

      const derived = await sql<Array<{ derived_from_record_id: string | null }>>`
        select derived_from_record_id
        from verification_records
        where subject_id = ${userId}
          and purpose = 'age_access'
          and status = 'valid'
          and derived_from_record_id is not null
        order by created_at desc
        limit 1
      `;
      expect(derived).toEqual([]);
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

  it("normalizes adult approval into an exact-revision release and denies republish after source revocation", async () => {
    if (!sql) throw new Error("Postgres test client was not initialized");
    const userId = randomUUID();
    const contentId = randomUUID();
    const mediaAssetId = randomUUID();
    const providerReference = `didit-${randomUUID()}`;
    const providerEventId = randomUUID();
    const ageRecordId = randomUUID();
    const repository = createPostgresVerificationRepository(sql);
    const publishRepository = createContentPublishRepositoryMethods(sql);
    await sql`insert into users (id, supabase_user_id) values (${userId}, ${userId})`;
    await sql`
      insert into profiles (user_id, handle, display_name, visibility)
      values (
        ${userId}, ${`adult_release_${userId.replaceAll("-", "").slice(0, 12)}`},
        'Adult release creator', 'public'
      )
    `;

    try {
      await sql`
        insert into verification_records (
          id, subject_type, subject_id, purpose, status, provider, method,
          threshold_age, result_over_threshold, assurance_level, verified_at,
          reusable, metadata
        ) values (
          ${ageRecordId}, 'user', ${userId}, 'age_access', 'valid', 'manual',
          'manual_review', 18, true, 'high', now(), false,
          ${sql.json({ source: "integration_test_explicit_age_fact" })}
        )
      `;
      await repository.createPendingSession({
        supabaseUserId: userId,
        purpose: "adult_publisher_eligibility",
        policyVersion: "adult-publisher-2026-08-v1",
        termsAcceptedAt: new Date(),
        providerSession: {
          provider: "didit",
          providerReference,
          providerSessionId: providerReference,
          launchUrl: "https://verify.didit.me/session/linked-age",
          expiresAt: new Date(Date.now() + 86_400_000),
          method: "gov_id_selfie",
          assuranceLevel: "documentary",
          reusable: false
        }
      });
      expect(await repository.applyProviderWebhook({
        provider: "didit",
        providerEventId,
        providerReference,
        eventType: "status.updated",
        status: "valid",
        signatureHash: "c".repeat(64),
        payloadHash: "d".repeat(64),
        occurredAt: new Date(),
        identityEvidence: {
          documentApproved: true,
          livenessApproved: true,
          faceMatchApproved: true
        }
      })).toBe("applied");

      const linked = await repository.findLatestUserVerification({
        supabaseUserId: userId,
        purpose: "adult_publisher_eligibility"
      });
      expect(linked).toMatchObject({
        status: "valid",
        thresholdAge: 18,
        resultOverThreshold: true
      });
      expect((await repository.resolveCapabilities({ supabaseUserId: userId }))
        .capabilities.canPublishAdultMedia).toBe(true);
      const storedLink = await sql<Array<{ id: string; derived_from_record_id: string | null }>>`
        select id, derived_from_record_id
        from verification_records
        where subject_id = ${userId}
          and purpose = 'adult_publisher_eligibility'
          and status = 'valid'
        order by created_at desc
        limit 1
      `;
      expect(storedLink[0]?.derived_from_record_id).toBe(ageRecordId);
      const adultRecordId = storedLink[0]?.id;
      if (!adultRecordId) throw new Error("Adult-publisher normalization did not create a record");

      await sql`
        insert into content_items (
          id, creator_user_id, media_type, state, visibility, caption,
          nsfw_label, moderation_state, publish_state
        ) values (
          ${contentId}, ${userId}, 'image', 'draft', 'public',
          'Adult normalization release fixture', 'adult', 'pending', 'draft'
        )
      `;
      await sql`
        insert into media_assets (
          id, content_item_id, provider, provider_asset_id, provider_state,
          asset_kind, mime_type, provider_playable, ready_at, provider_checked_at
        ) values (
          ${mediaAssetId}, ${contentId}, 'bunny', ${`adult-release-${contentId}`},
          'stored_private', 'image', 'image/jpeg', true, now(), now()
        )
      `;
      await sql.begin((transaction) => recordContentSafetyDeclaration(transaction, {
        contentId,
        creatorUserId: userId,
        rating: "adult",
        representationMode: "self_only",
        policyAccepted: true
      }));

      const performerRows = await sql<Array<{ id: string }>>`
        select id
        from performer_subjects
        where owner_user_id = ${userId} and linked_user_id = ${userId}
      `;
      const performerSubjectId = performerRows[0]?.id;
      if (!performerSubjectId) throw new Error("Adult source did not produce a performer subject");

      const performerDecision = await sql<Array<{ derived_from_record_id: string | null }>>`
        select derived_from_record_id
        from private.current_verification_decision(
          'performer', ${performerSubjectId}, 'performer_eligibility'
        )
      `;
      expect(performerDecision).toEqual([{ derived_from_record_id: adultRecordId }]);

      const releaseRevision = await sql<Array<{
        declaration_revision: string;
        consent_revision: string;
        consent_state: string;
      }>>`
        select
          declaration.content_revision::text as declaration_revision,
          consent.content_revision::text as consent_revision,
          consent.state as consent_state
        from content_safety_declarations declaration
        join performer_consents consent
          on consent.content_item_id = declaration.content_item_id
         and consent.performer_subject_id = ${performerSubjectId}
        where declaration.content_item_id = ${contentId}
      `;
      expect(releaseRevision).toEqual([{
        declaration_revision: "1",
        consent_revision: "1",
        consent_state: "active"
      }]);

      await sql`
        update media_safety_cases
        set state = 'approved',
            decision_source = 'staff',
            reason_code = 'integration_fixture_approved',
            provider_release_allowed = true,
            decided_at = now(),
            updated_at = now()
        where content_item_id = ${contentId}
          and state <> 'superseded'
      `;
      await sql`
        insert into provider_media_scan_events (
          media_safety_case_id, media_asset_id, provider, provider_event_id,
          scan_type, normalized_signal, payload_hash, model_or_ruleset_version,
          observed_at
        )
        select
          safety.id,
          ${mediaAssetId},
          evidence.provider,
          evidence.provider_event_id,
          evidence.scan_type,
          'clear',
          ${"e".repeat(64)},
          evidence.ruleset,
          now()
        from media_safety_cases safety
        cross join (values
          ('bunny_stream', ${`adult-container-${contentId}`}, 'container_integrity', 'bunny-stream-playability-v1'),
          ('bunny_shield', ${`adult-malware-${contentId}`}, 'malware', 'shield-antivirus-v1'),
          ('bunny_shield', ${`adult-known-hash-${contentId}`}, 'known_hash', 'shield-known-hash-v1'),
          ('internal', ${`adult-classification-${contentId}`}, 'content_classification', 'fixture-classifier-v1'),
          ('internal', ${`adult-manual-review-${contentId}`}, 'manual_review', 'media-safety-v2')
        ) as evidence(provider, provider_event_id, scan_type, ruleset)
        where safety.content_item_id = ${contentId}
          and safety.state <> 'superseded'
      `;
      await sql`
        update content_items
        set state = 'ready',
            moderation_state = 'approved',
            release_media_asset_id = ${mediaAssetId},
            updated_at = now()
        where id = ${contentId}
      `;

      await expect(contentReleaseReady(sql, contentId)).resolves.toBe(true);
      const publishBody = { confirmation: "submit_for_review" } as const;
      await expect(publishRepository.publishOwnedContent!({
        supabaseUserId: userId,
        contentId,
        idempotencyKey: `adult-publish-${contentId}`,
        requestHash: hashIdempotencyPayload({ contentId, body: publishBody }),
        scheduledFor: null,
        scheduledForProvided: false
      })).resolves.toMatchObject({ id: contentId });
      await expect(contentPublishState(sql, contentId)).resolves.toBe("published");

      await sql`
        insert into verification_records (
          subject_type, subject_id, purpose, status, provider, method,
          threshold_age, result_over_threshold, assurance_level, reusable,
          metadata, created_at
        ) values (
          'user', ${userId}, 'age_access', 'revoked', 'manual', 'manual_review',
          18, false, 'high', false,
          ${sql.json({ source: "integration_test_age_revoked" })},
          clock_timestamp() + interval '1 second'
        )
      `;
      expect((await repository.resolveCapabilities({ supabaseUserId: userId }))
        .capabilities.canPublishAdultMedia).toBe(false);
      await expect(currentValidDecisionExists(
        sql, "user", userId, "adult_publisher_eligibility"
      )).resolves.toBe(false);
      await expect(currentValidDecisionExists(
        sql, "performer", performerSubjectId, "performer_eligibility"
      )).resolves.toBe(false);
      await expect(contentReleaseReady(sql, contentId)).resolves.toBe(false);

      await sql`
        update content_items
        set publish_state = 'unpublished', published_at = null, updated_at = now()
        where id = ${contentId}
      `;
      await expect(publishRepository.publishOwnedContent!({
        supabaseUserId: userId,
        contentId,
        idempotencyKey: `adult-republish-revoked-${contentId}`,
        requestHash: hashIdempotencyPayload({ contentId, body: publishBody }),
        scheduledFor: null,
        scheduledForProvided: false
      })).resolves.toMatchObject({ id: contentId });
      await expect(contentPublishState(sql, contentId)).resolves.toBe("submitted_for_review");
    } finally {
      const performerRows = await sql<Array<{ id: string }>>`
        select id from performer_subjects where owner_user_id = ${userId}
      `;
      const performerIds = performerRows.map((row) => row.id);
      const recordIds = await sql<Array<{ id: string }>>`
        select id
        from verification_records
        where subject_id = ${userId}
          or (${performerIds.length > 0}
            and subject_id = any(${performerIds.length > 0 ? performerIds : [userId]}::uuid[]))
      `;
      const sessionIds = await sql<Array<{ id: string }>>`
        select id from verification_sessions where subject_id = ${userId}
      `;
      const auditSubjectIds = [...recordIds, ...sessionIds].map((row) => row.id);
      if (auditSubjectIds.length > 0) {
        await sql`
          delete from audit_events
          where actor_user_id = ${userId}
             or subject_id = ${contentId}
             or subject_id in ${sql(auditSubjectIds)}
        `;
      }
      if (sessionIds.length > 0) {
        await sql`delete from verification_events where session_id in ${sql(sessionIds.map((row) => row.id))}`;
      }
      await sql`delete from mutation_command_receipts where actor_user_id = ${userId}`;
      await sql`
        update content_items set release_media_asset_id = null where id = ${contentId}
      `;
      await sql`delete from provider_media_scan_events where media_asset_id = ${mediaAssetId}`;
      await sql`delete from media_assets where content_item_id = ${contentId}`;
      await sql`delete from content_items where id = ${contentId}`;
      if (performerIds.length > 0) {
        await sql`delete from performer_subjects where id in ${sql(performerIds)}`;
        await sql`
          delete from verification_records
          where subject_type = 'performer' and subject_id in ${sql(performerIds)}
        `;
      }
      await sql`delete from verification_records where subject_id = ${userId}`;
      await sql`delete from verification_sessions where subject_id = ${userId}`;
      await sql`delete from profiles where user_id = ${userId}`;
      await sql`delete from users where id = ${userId}`;
    }
  }, 60_000);

  it("bounds an unreferenced contextual provider-create attempt into manual review without replacement", async () => {
    if (!sql) throw new Error("Postgres test client was not initialized");
    const userId = randomUUID();
    const repository = createPostgresVerificationRepository(sql);
    await sql`insert into users (id, supabase_user_id) values (${userId}, ${userId})`;

    try {
      const first = await repository.reservePendingSession!({
        supabaseUserId: userId,
        purpose: "creator_kyc",
        idempotencyKey: `creator-kyc-lost-${userId}`,
        requestHash: "e".repeat(64)
      });
      expect(await repository.selectPendingSessionProvider!({
        sessionId: first.id,
        selection: {
          provider: "didit",
          method: "gov_id_selfie",
          assuranceLevel: "documentary",
          reusable: false
        }
      })).toBe(true);
      await expect(repository.reservePendingSession!({
        supabaseUserId: userId,
        purpose: "creator_kyc",
        idempotencyKey: `creator-kyc-too-early-${userId}`,
        requestHash: "f".repeat(64)
      })).rejects.toThrow("VERIFICATION_SESSION_ALREADY_RESERVED");
      await sql`
        update verification_sessions
        set expires_at = now() - interval '1 second'
        where id = ${first.id}
      `;

      const blockedReplacement = await repository.reservePendingSession!({
        supabaseUserId: userId,
        purpose: "creator_kyc",
        idempotencyKey: `creator-kyc-replacement-${userId}`,
        requestHash: "1".repeat(64)
      });
      expect(blockedReplacement).toEqual({
        id: first.id,
        subjectReference: first.subjectReference,
        requiresManualReview: true
      });
      await expect(repository.completePendingSession!({
        sessionId: first.id,
        providerSession: {
          provider: "didit",
          providerReference: `late-didit-${userId}`,
          providerSessionId: `late-didit-${userId}`,
          launchUrl: "https://verification.didit.example/session/late",
          expiresAt: new Date(Date.now() + 15 * 60 * 1000),
          method: "gov_id_selfie",
          assuranceLevel: "documentary",
          reusable: false
        }
      })).rejects.toThrow("VERIFICATION_SESSION_RESERVATION_NOT_FOUND");
      const terminal = await sql<Array<{
        launch_state: string;
        session_status: string;
        provider_session_id: string | null;
        record_status: string;
        failure_reason_code: string | null;
        audit_count: number;
      }>>`
        select
          session.launch_state,
          session.status as session_status,
          session.provider_session_id,
          record.status as record_status,
          record.failure_reason_code,
          (select count(*)::int from audit_events
            where subject_id = ${first.id}
              and action = 'verification.provider_create_reference_requires_review') as audit_count
        from verification_sessions session
        join verification_records record
          on record.metadata ->> 'sessionId' = session.id::text
         and record.metadata ->> 'source' = 'verification_session_reservation'
        where session.id = ${first.id}
      `;
      expect(terminal[0]).toEqual({
        launch_state: "reserved",
        session_status: "needs_review",
        provider_session_id: null,
        record_status: "pending",
        failure_reason_code: "provider_create_reference_requires_review",
        audit_count: 1
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

      const timeline = await sql<Array<{ approved_at: Date }>>`
        select clock_timestamp() as approved_at
      `;
      const approvedAt = timeline[0]?.approved_at;
      if (!approvedAt) throw new Error("Missing verification timeline anchor");
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
      expect(approved).toBe("unmatched");

      await repository.completePendingSession?.({
        sessionId: reservation.id,
        providerSession: {
          provider: "sumsub",
          providerReference: reservation.subjectReference,
          providerExternalUserId: reservation.subjectReference,
          launchUrl: "https://in.sumsub.example/websdk/p/test",
          expiresAt: new Date(approvedAt.getTime() + 30 * 60 * 1000),
          method: "gov_id_selfie",
          assuranceLevel: "documentary",
          reusable: false
        }
      });

      const blockedAt = new Date(approvedAt.getTime() + 60 * 60 * 1000);
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
        occurredAt: new Date(approvedAt.getTime() + 30 * 60 * 1000)
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
    const verifiedEventId = `yoti-${randomUUID()}`;
    const revokedEventId = `yoti-${randomUUID()}`;
    const staleValidEventId = `yoti-${randomUUID()}`;
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
      const timeline = await sql<Array<{ approved_at: Date }>>`
        select clock_timestamp() as approved_at
      `;
      const approvedAt = timeline[0]?.approved_at;
      if (!approvedAt) throw new Error("Missing age-verification timeline anchor");
      expect(await repository.applyProviderWebhook({
        provider: "yoti",
        providerEventId: verifiedEventId,
        providerReference: `yoti-session-${userId}`,
        providerSubjectReference: reservation.subjectReference,
        eventType: "age_verification",
        state: "verified",
        verifiedAt: approvedAt,
        signatureHash: "6".repeat(64),
        payloadHash: hashIdempotencyPayload({ userId, event: "verified" })
      })).toBe("unmatched");

      await repository.completePendingAgeVerification?.({
        sessionId: reservation.id,
        providerSession: {
          provider: "yoti",
          providerReference: `yoti-session-${userId}`,
          providerExternalUserId: reservation.subjectReference,
          launchUrl: "https://age.yoti.example/session/test",
          expiresAt: new Date(approvedAt.getTime() + 30 * 60 * 1000),
          rule: "over_18"
        }
      });
      expect(await repository.findLatestAgeStatusByUserId?.(userId)).toEqual({
        state: "verified",
        provider: "yoti"
      });

      const failedAt = new Date(approvedAt.getTime() + 60 * 60 * 1000);
      expect(await repository.applyProviderWebhook({
        provider: "yoti",
        providerEventId: revokedEventId,
        providerReference: `yoti-session-${userId}`,
        providerSubjectReference: reservation.subjectReference,
        eventType: "age_verification",
        state: "failed",
        verifiedAt: failedAt,
        failureCode: "REVOKED",
        signatureHash: "8".repeat(64),
        payloadHash: hashIdempotencyPayload({ userId, event: "revoked" })
      })).toBe("applied");
      expect(await repository.updateVerificationFromWebhook({
        provider: "yoti",
        providerEventId: staleValidEventId,
        providerReference: `yoti-session-${userId}`,
        providerSubjectReference: reservation.subjectReference,
        state: "verified",
        verifiedAt: new Date(approvedAt.getTime() + 30 * 60 * 1000)
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
      await sql`
        delete from verification_events
        where idempotency_key in ${sql([verifiedEventId, revokedEventId, staleValidEventId])}
      `;
      await sql`delete from verification_records where subject_id = ${userId}`;
      await sql`delete from verification_sessions where subject_id = ${userId}`;
      await sql`delete from profiles where user_id = ${userId}`;
      await sql`delete from users where id = ${userId}`;
    }
  });
});

async function contentReleaseReady(
  sql: ReturnType<typeof createPostgresClient>,
  contentId: string
): Promise<boolean> {
  const rows = await sql<Array<{ ready: boolean }>>`
    select private.content_safety_release_ready(${contentId}) as ready
  `;
  return rows[0]?.ready === true;
}

async function contentPublishState(
  sql: ReturnType<typeof createPostgresClient>,
  contentId: string
): Promise<string | undefined> {
  const rows = await sql<Array<{ publish_state: string }>>`
    select publish_state from content_items where id = ${contentId}
  `;
  return rows[0]?.publish_state;
}

async function currentValidDecisionExists(
  sql: ReturnType<typeof createPostgresClient>,
  subjectType: "user" | "performer",
  subjectId: string,
  purpose: "adult_publisher_eligibility" | "performer_eligibility"
): Promise<boolean> {
  const rows = await sql<Array<{ id: string }>>`
    select id
    from private.current_verification_decision(${subjectType}, ${subjectId}, ${purpose})
    where status = 'valid'
  `;
  return rows.length > 0;
}
