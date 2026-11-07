import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createPostgresAgeRepository } from "../src/modules/age/age-repository.js";
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
  it("keeps protected realtime access closed after a stale valid delivery", async () => {
    const sql = createPostgresClient(guardedIntegrationDatabaseUrl());
    const subjectId = randomUUID();
    const identityId = randomUUID();
    const walletId = randomUUID();
    const suffix = subjectId.replaceAll("-", "").slice(0, 20);

    try {
      await sql`
        insert into users (id, supabase_user_id, state)
        values (${subjectId}, ${subjectId}, 'active')
      `;
      await sql`
        insert into user_provider_identities (
          id, provider, provider_subject, user_id, status, linked_at
        ) values (
          ${identityId}, 'supabase', ${subjectId}, ${subjectId}, 'active', now()
        )
      `;
      await sql`
        insert into profiles (user_id, handle, display_name, visibility)
        values (${subjectId}, ${`protected_${suffix}`}, 'Protected Access Probe', 'public')
      `;
      await sql`
        insert into wallets (id, user_id, provider, address, chain, is_primary)
        values (
          ${walletId}, ${subjectId}, 'wallet_adapter',
          ${`protected-wallet-${suffix}`}, 'solana_devnet', true
        )
      `;

      await insertDecision(sql, {
        subjectId,
        status: "valid",
        providerEventAt: "2026-11-07 10:00:01+00",
        createdAt: "2026-11-07 10:00:02+00"
      });
      expect(await protectedAppAccess(sql, subjectId)).toBe(true);

      await insertDecision(sql, {
        subjectId,
        status: "blocked",
        providerEventAt: "2026-11-07 10:00:03+00",
        createdAt: "2026-11-07 10:00:03+00"
      });
      expect(await protectedAppAccess(sql, subjectId)).toBe(false);

      await insertDecision(sql, {
        subjectId,
        status: "valid",
        providerEventAt: "2026-11-07 10:00:02+00",
        createdAt: "2026-11-07 10:00:04+00"
      });
      expect(await currentDecision(sql, subjectId)).toMatchObject({ status: "blocked" });
      expect(await protectedAppAccess(sql, subjectId)).toBe(false);
    } finally {
      await sql`delete from verification_records where subject_id = ${subjectId}`;
      await sql`delete from wallets where id = ${walletId}`;
      await sql`delete from profiles where user_id = ${subjectId}`;
      await sql`delete from user_provider_identities where id = ${identityId}`;
      await sql`delete from users where id = ${subjectId}`;
      await sql.end({ timeout: 5 });
    }
  });

  it("promotes only owning same-second provider completions to the canonical decision", async () => {
    const sql = createPostgresClient(guardedIntegrationDatabaseUrl());
    const repository = createPostgresAgeRepository(sql);
    const cases = [
      {
        subjectId: randomUUID(),
        sessionId: randomUUID(),
        providerReference: `yoti-rounded-${randomUUID()}`,
        providerEventId: `yoti-rounded-${randomUUID()}`,
        reservationAt: "2026-11-07 18:00:00.900000+00",
        providerEventAt: "2026-11-07T18:00:00.000Z",
        signatureHash: "a".repeat(64),
        payloadHash: "b".repeat(64)
      },
      {
        subjectId: randomUUID(),
        sessionId: randomUUID(),
        providerReference: `yoti-exact-${randomUUID()}`,
        providerEventId: `yoti-exact-${randomUUID()}`,
        reservationAt: "2026-11-07 19:00:00+00",
        providerEventAt: "2026-11-07T19:00:00.000Z",
        signatureHash: "c".repeat(64),
        payloadHash: "d".repeat(64)
      }
    ];

    try {
      for (const testCase of cases) {
        const subjectReference =
          `wevid:user:${testCase.subjectId}:age_access:${testCase.sessionId}`;
        await sql`
          insert into users (id, supabase_user_id, state)
          values (${testCase.subjectId}, ${testCase.subjectId}, 'active')
        `;
        await sql`
          insert into verification_sessions (
            id, subject_type, subject_id, purpose, provider,
            provider_external_user_id, provider_session_id, requested_method,
            status, threshold_age, assurance_level, reusable, launch_state,
            created_at
          ) values (
            ${testCase.sessionId}, 'user', ${testCase.subjectId}, 'age_access', 'yoti',
            ${subjectReference}, ${testCase.providerReference}, 'age_estimation',
            'pending', 18, 'medium', false, 'ready',
            ${testCase.reservationAt}::timestamptz
          )
        `;
        await sql`
          insert into verification_records (
            subject_type, subject_id, purpose, status, provider, method,
            threshold_age, assurance_level, reusable, metadata, created_at
          ) values (
            'user', ${testCase.subjectId}, 'age_access', 'pending', 'yoti',
            'age_estimation', 18, 'medium', false,
            ${sql.json({
              source: "verification_session_reservation",
              sessionId: testCase.sessionId
            })},
            ${testCase.reservationAt}::timestamptz
          )
        `;

        expect(await incomingDecisionWins(
          sql,
          testCase.subjectId,
          "valid",
          testCase.providerEventAt,
          testCase.sessionId
        )).toBe(true);
        expect(await incomingDecisionWins(
          sql,
          testCase.subjectId,
          "valid",
          testCase.providerEventAt,
          randomUUID()
        )).toBe(false);

        expect(await repository.applyProviderWebhook({
          provider: "yoti",
          providerEventId: testCase.providerEventId,
          providerReference: testCase.providerReference,
          providerSubjectReference: subjectReference,
          eventType: "age_verification",
          state: "verified",
          verifiedAt: new Date(testCase.providerEventAt),
          signatureHash: testCase.signatureHash,
          payloadHash: testCase.payloadHash
        })).toBe("applied");

        const stored = await sql<Array<{ session_id: string | null }>>`
          select metadata ->> 'sessionId' as session_id
          from verification_records
          where subject_id = ${testCase.subjectId}
            and metadata ->> 'providerEventId' = ${testCase.providerEventId}
        `;
        expect(stored).toEqual([{ session_id: testCase.sessionId }]);
        expect(await currentDecision(sql, testCase.subjectId)).toEqual({
          status: "valid",
          decision_authority: "provider_authenticated"
        });
      }

      const exact = cases[1];
      if (!exact) throw new Error("Missing exact-time provider case");
      await sql`
        insert into verification_records (
          subject_type, subject_id, purpose, status, provider, method,
          threshold_age, assurance_level, reusable, metadata, created_at
        ) values (
          'user', ${exact.subjectId}, 'age_access', 'pending', 'internal',
          'manual_review', 18, 'low', false,
          ${sql.json({
            source: "verification_session_reservation",
            sessionId: randomUUID()
          })},
          ${exact.providerEventAt}::timestamptz
        )
      `;
      expect(await currentDecision(sql, exact.subjectId)).toEqual({
        status: "pending",
        decision_authority: "internal_transition"
      });

      await insertDecision(sql, {
        subjectId: exact.subjectId,
        status: "blocked",
        providerEventAt: exact.providerEventAt
      });
      expect(await currentDecision(sql, exact.subjectId)).toEqual({
        status: "blocked",
        decision_authority: "provider_authenticated"
      });
    } finally {
      const subjectIds = cases.map((testCase) => testCase.subjectId);
      const sessionIds = cases.map((testCase) => testCase.sessionId);
      const eventIds = cases.map((testCase) => testCase.providerEventId);
      const recordIds = await sql<Array<{ id: string }>>`
        select id from verification_records where subject_id in ${sql(subjectIds)}
      `;
      const auditSubjectIds = [...recordIds.map((row) => row.id), ...sessionIds];
      if (auditSubjectIds.length > 0) {
        await sql`delete from audit_events where subject_id in ${sql(auditSubjectIds)}`;
      }
      await sql`
        delete from verification_events
        where session_id in ${sql(sessionIds)} or idempotency_key in ${sql(eventIds)}
      `;
      await sql`delete from verification_records where subject_id in ${sql(subjectIds)}`;
      await sql`delete from verification_sessions where id in ${sql(sessionIds)}`;
      await sql`delete from user_social_counts where user_id in ${sql(subjectIds)}`;
      await sql`delete from users where id in ${sql(subjectIds)}`;
      await sql.end({ timeout: 5 });
    }
  });

  it("orders exact provider time, fail-closed ties, local authority, and derived evidence", async () => {
    const sql = createPostgresClient(guardedIntegrationDatabaseUrl());
    const orderedSubject = randomUUID();
    const tiedSubject = randomUUID();
    const missingTimeSubject = randomUUID();
    const legacySubject = randomUUID();
    const manualSubject = randomUUID();
    const internalSubject = randomUUID();
    const derivedSubject = randomUUID();
    const roundedSubject = randomUUID();
    const incompleteReconciliationSubject = randomUUID();
    const provenanceUserSubject = randomUUID();
    const provenancePerformerSubject = randomUUID();
    const readinessCreator = randomUUID();
    const readinessContentId = randomUUID();
    const readinessRequestId = randomUUID();
    const readinessConsentId = randomUUID();
    const subjectIds = [
      orderedSubject,
      tiedSubject,
      missingTimeSubject,
      legacySubject,
      manualSubject,
      internalSubject,
      derivedSubject,
      roundedSubject,
      incompleteReconciliationSubject,
      provenanceUserSubject,
      provenancePerformerSubject,
      readinessCreator
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

      await sql`
        insert into users (id, supabase_user_id, state) values
          (${readinessCreator}, ${readinessCreator}, 'active'),
          (${provenanceUserSubject}, ${provenanceUserSubject}, 'active')
      `;
      await sql`
        insert into content_items (
          id, creator_user_id, media_type, state, publish_state,
          visibility, nsfw_label, moderation_state
        ) values (
          ${readinessContentId}, ${readinessCreator}, 'image', 'draft', 'draft',
          'private', 'adult', 'pending'
        )
      `;
      await sql`
        insert into content_safety_declarations (
          content_item_id, uploader_user_id, representation_mode,
          policy_version, state, accepted_at, content_revision
        ) values (
          ${readinessContentId}, ${readinessCreator}, 'declared_performers',
          'integration-safety-v1', 'active', now(), 1
        )
      `;
      await sql`
        insert into performer_subjects (
          id, owner_user_id, linked_user_id, subject_kind, display_label
        ) values (
          ${provenancePerformerSubject}, ${readinessCreator},
          ${provenanceUserSubject}, 'wevid_user', 'Provenance performer'
        )
      `;
      await sql`
        insert into verification_records (
          subject_type, subject_id, purpose, status, provider, method,
          threshold_age, result_over_threshold, assurance_level, reusable,
          policy_version, terms_accepted_at, provider_event_at, metadata, created_at
        ) values (
          'user', ${readinessCreator}, 'adult_publisher_eligibility', 'valid',
          'manual', 'manual_review', 18, true, 'documentary', false,
          'integration-adult-v1', '2026-11-07 09:00:00+00'::timestamptz,
          null, ${sql.json({ source: "admin_kyb_override" })},
          '2026-11-07 09:00:00+00'::timestamptz
        )
      `;

      const ageSourceId = randomUUID();
      const adultDerivedId = randomUUID();
      const performerDerivedId = randomUUID();
      await sql`
        insert into verification_records (
          id, subject_type, subject_id, purpose, status, provider, method,
          threshold_age, result_over_threshold, assurance_level, reusable,
          provider_event_at, metadata, created_at
        ) values (
          ${ageSourceId}, 'user', ${provenanceUserSubject}, 'age_access', 'valid',
          'didit', 'reusable_age', 18, true, 'documentary', false,
          '2026-11-07 10:00:00+00'::timestamptz,
          ${sql.json({ source: "provider_webhook" })},
          '2026-11-07 10:00:01+00'::timestamptz
        )
      `;
      await sql`
        insert into verification_records (
          id, subject_type, subject_id, purpose, status, provider, method,
          threshold_age, result_over_threshold, assurance_level, reusable,
          policy_version, terms_accepted_at, derived_from_record_id,
          provider_event_at, metadata, created_at
        ) values (
          ${adultDerivedId}, 'user', ${provenanceUserSubject},
          'adult_publisher_eligibility', 'valid', 'didit', 'gov_id_selfie',
          18, true, 'documentary', false, 'integration-adult-v1',
          '2026-11-07 10:00:00+00'::timestamptz, ${ageSourceId},
          '2026-11-07 10:00:00+00'::timestamptz,
          ${sql.json({ source: "age_access" })},
          '2026-11-07 10:00:02+00'::timestamptz
        )
      `;
      await sql`
        insert into verification_records (
          id, subject_type, subject_id, purpose, status, provider, method,
          threshold_age, result_over_threshold, assurance_level, reusable,
          derived_from_record_id, provider_event_at, metadata, created_at
        ) values (
          ${performerDerivedId}, 'performer', ${provenancePerformerSubject},
          'performer_eligibility', 'valid', 'didit', 'gov_id_selfie',
          18, true, 'documentary', false, ${adultDerivedId},
          '2026-11-07 10:00:00+00'::timestamptz,
          ${sql.json({ source: "performer_evidence_reuse", evidence_reuse: true })},
          '2026-11-07 10:00:03+00'::timestamptz
        )
      `;
      await sql`
        insert into performer_consent_requests (
          id, content_item_id, performer_subject_id, requested_by_user_id,
          idempotency_key, state, allowed_uses, policy_version,
          release_version, content_revision, responded_at
        ) values (
          ${readinessRequestId}, ${readinessContentId}, ${provenancePerformerSubject},
          ${readinessCreator}, ${`provenance-${readinessRequestId}`}, 'accepted',
          array['promotion'], 'integration-safety-v1',
          'integration-release-v1', 1, now()
        )
      `;
      await sql`
        insert into performer_consents (
          id, content_item_id, performer_subject_id, recorded_by_user_id,
          allowed_uses, policy_version, release_version, state,
          evidence_hash, evidence_reference, accepted_at, content_revision
        ) values (
          ${readinessConsentId}, ${readinessContentId}, ${provenancePerformerSubject},
          ${provenanceUserSubject}, array['promotion'],
          'integration-safety-v1', 'integration-release-v1', 'active',
          ${"d".repeat(64)}, ${`performer_consent_request:${readinessRequestId}`},
          now(), 1
        )
      `;

      expect(await currentDecisionFor(
        sql, "user", provenanceUserSubject, "adult_publisher_eligibility"
      )).toMatchObject({ status: "valid" });
      expect(await currentDecisionFor(
        sql, "performer", provenancePerformerSubject, "performer_eligibility"
      )).toMatchObject({ status: "valid" });
      expect(await contentPerformerReadiness(sql, readinessContentId)).toBe(false);

      await sql`
        update performer_consent_requests
        set allowed_uses = array['capture', 'upload', 'distribution']
        where id = ${readinessRequestId}
      `;
      await sql`
        update performer_consents
        set allowed_uses = array['capture', 'upload', 'distribution']
        where id = ${readinessConsentId}
      `;
      expect(await contentPerformerReadiness(sql, readinessContentId)).toBe(true);

      await insertDecision(sql, {
        subjectId: provenanceUserSubject,
        status: "blocked",
        providerEventAt: "2026-11-07 10:00:01+00",
        createdAt: "2026-11-07 10:00:04+00"
      });
      expect(await currentDecisionFor(
        sql, "user", provenanceUserSubject, "adult_publisher_eligibility"
      )).toBeNull();
      expect(await currentDecisionFor(
        sql, "performer", provenancePerformerSubject, "performer_eligibility"
      )).toBeNull();
      const cachedProjection = await sql<Array<{ verification_status: string }>>`
        select verification_status
        from performer_subjects
        where id = ${provenancePerformerSubject}
      `;
      expect(cachedProjection).toEqual([{ verification_status: "valid" }]);
      expect(await contentPerformerReadiness(sql, readinessContentId)).toBe(false);

      const roundedSessionId = randomUUID();
      await sql`
        insert into verification_sessions (
          id, subject_type, subject_id, purpose, provider,
          provider_external_user_id, requested_method, status,
          threshold_age, assurance_level, reusable, launch_state, created_at
        ) values (
          ${roundedSessionId}, 'user', ${roundedSubject}, 'age_access', 'internal',
          ${`wevid:user:${roundedSubject}:age_access:${roundedSessionId}`},
          'manual_review', 'created', 18, 'low', false, 'reserved',
          '2026-11-06 18:00:00.900000+00'::timestamptz
        )
      `;
      await sql`
        insert into verification_records (
          subject_type, subject_id, purpose, status, provider, method,
          threshold_age, assurance_level, reusable, metadata, created_at
        ) values (
          'user', ${roundedSubject}, 'age_access', 'pending', 'internal',
          'manual_review', 18, 'low', false,
          ${sql.json({ source: "verification_session_reservation", sessionId: roundedSessionId })},
          '2026-11-06 18:00:00.900000+00'::timestamptz
        )
      `;
      expect(await incomingDecisionWins(
        sql,
        roundedSubject,
        "valid",
        "2026-11-06 18:00:00+00",
        roundedSessionId
      )).toBe(true);
      expect(await incomingDecisionWins(
        sql,
        roundedSubject,
        "valid",
        "2026-11-06 18:00:00+00",
        randomUUID()
      )).toBe(false);
      expect(await incomingDecisionWins(
        sql,
        roundedSubject,
        "valid",
        "2026-11-06 17:59:59+00",
        roundedSessionId
      )).toBe(false);

      await insertDecision(sql, {
        subjectId: incompleteReconciliationSubject,
        status: "valid",
        providerEventAt: null,
        source: "provider_reconciliation"
      });
      expect(await currentDecision(sql, incompleteReconciliationSubject)).toBeNull();
    } finally {
      await sql`delete from performer_consents where id = ${readinessConsentId}`;
      await sql`delete from performer_consent_requests where id = ${readinessRequestId}`;
      await sql`delete from content_items where id = ${readinessContentId}`;
      await sql`delete from performer_subjects where id = ${provenancePerformerSubject}`;
      await sql`
        delete from verification_records
        where subject_id in ${sql(subjectIds)}
      `;
      await sql`
        delete from verification_sessions
        where subject_id in ${sql(subjectIds)}
      `;
      await sql`
        delete from users
        where id in (${readinessCreator}, ${provenanceUserSubject})
      `;
      await sql.end({ timeout: 5 });
    }
  });

  it("keeps plural decisions identical to scalar decisions for ties, retries, and provenance", async () => {
    const sql = createPostgresClient(guardedIntegrationDatabaseUrl());
    const tiedSubject = randomUUID();
    const retrySubject = randomUUID();
    const retrySessionId = randomUUID();
    const provenanceSourceSubject = randomUUID();
    const provenanceTargetSubject = randomUUID();
    const provenanceSourceRecordId = randomUUID();
    const provenanceMiddleRecordId = randomUUID();
    const provenanceTargetRecordId = randomUUID();
    const subjectIds = [
      tiedSubject,
      retrySubject,
      provenanceSourceSubject,
      provenanceTargetSubject
    ];

    try {
      await insertDecision(sql, {
        subjectId: tiedSubject,
        status: "valid",
        providerEventAt: "2026-11-08 09:00:00.100001+00",
        createdAt: "2026-11-08 09:00:02+00"
      });
      await insertDecision(sql, {
        subjectId: tiedSubject,
        status: "blocked",
        providerEventAt: "2026-11-08 09:00:00.100001+00",
        createdAt: "2026-11-08 09:00:01+00"
      });

      await sql`
        insert into verification_records (
          subject_type, subject_id, purpose, status, provider, method,
          threshold_age, result_over_threshold, assurance_level, reusable,
          provider_event_at, metadata, created_at
        ) values
          (
            'user', ${retrySubject}, 'age_access', 'valid', 'didit',
            'gov_id_selfie', 18, true, 'documentary', false,
            '2026-11-08 10:00:00.100000+00'::timestamptz,
            ${sql.json({ source: "provider_webhook", sessionId: retrySessionId })},
            '2026-11-08 10:00:00.200000+00'::timestamptz
          ),
          (
            'user', ${retrySubject}, 'age_access', 'pending', 'internal',
            'manual_review', 18, null, 'low', false, null,
            ${sql.json({ source: "verification_session_reservation", sessionId: retrySessionId })},
            '2026-11-08 10:00:01.100000+00'::timestamptz
          )
      `;

      await sql`
        insert into verification_records (
          id, subject_type, subject_id, purpose, status, provider, method,
          threshold_age, result_over_threshold, assurance_level, reusable,
          provider_event_at, metadata, created_at
        ) values (
          ${provenanceSourceRecordId}, 'user', ${provenanceSourceSubject},
          'age_access', 'valid', 'didit', 'gov_id_selfie', 18, true,
          'documentary', false, '2026-11-08 11:00:00+00'::timestamptz,
          ${sql.json({ source: "provider_webhook" })},
          '2026-11-08 11:00:01+00'::timestamptz
        )
      `;
      await sql`
        insert into verification_records (
          id, subject_type, subject_id, purpose, status, provider, method,
          threshold_age, result_over_threshold, assurance_level, reusable,
          policy_version, terms_accepted_at, derived_from_record_id,
          provider_event_at, metadata, created_at
        ) values (
          ${provenanceMiddleRecordId}, 'user', ${provenanceSourceSubject},
          'adult_publisher_eligibility', 'valid', 'didit', 'gov_id_selfie',
          18, true, 'documentary', false, 'integration-plural-v1',
          '2026-11-08 11:00:00+00'::timestamptz, ${provenanceSourceRecordId},
          '2026-11-08 11:00:00+00'::timestamptz,
          ${sql.json({ source: "age_access" })},
          '2026-11-08 11:00:02+00'::timestamptz
        )
      `;
      await sql`
        insert into verification_records (
          id, subject_type, subject_id, purpose, status, provider, method,
          threshold_age, result_over_threshold, assurance_level, reusable,
          derived_from_record_id, provider_event_at, metadata, created_at
        ) values (
          ${provenanceTargetRecordId}, 'user', ${provenanceTargetSubject},
          'age_access', 'valid', 'didit', 'gov_id_selfie', 18, true,
          'documentary', false, ${provenanceMiddleRecordId},
          '2026-11-08 11:00:00+00'::timestamptz,
          ${sql.json({ source: "adult_publisher_eligibility" })},
          '2026-11-08 11:00:03+00'::timestamptz
        )
      `;

      const duplicatedIds = [
        tiedSubject,
        retrySubject,
        provenanceTargetSubject,
        tiedSubject,
        provenanceSourceSubject
      ];
      const initial = await expectPluralScalarParity(sql, duplicatedIds);
      expect(initial).toEqual(expect.arrayContaining([
        expect.objectContaining({ subject_id: tiedSubject, status: "blocked" }),
        expect.objectContaining({ subject_id: retrySubject, status: "pending" }),
        expect.objectContaining({
          record_id: provenanceTargetRecordId,
          subject_id: provenanceTargetSubject,
          status: "valid"
        })
      ]));
      await expect(expectPluralScalarParity(sql, [])).resolves.toEqual([]);

      await insertDecision(sql, {
        subjectId: provenanceSourceSubject,
        status: "blocked",
        providerEventAt: "2026-11-08 11:00:01+00",
        createdAt: "2026-11-08 11:00:04+00"
      });

      const afterSourceRevocation = await expectPluralScalarParity(sql, duplicatedIds);
      expect(afterSourceRevocation).toEqual(expect.arrayContaining([
        expect.objectContaining({
          subject_id: provenanceSourceSubject,
          status: "blocked"
        })
      ]));
      expect(afterSourceRevocation).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ subject_id: provenanceTargetSubject })
      ]));
    } finally {
      await sql`
        delete from verification_records
        where subject_type = 'user' and subject_id in ${sql(subjectIds)}
      `;
      await sql.end({ timeout: 5 });
    }
  }, 30_000);
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

async function currentDecisionFor(
  sql: PostgresSql,
  subjectType: "user" | "performer",
  subjectId: string,
  purpose: "adult_publisher_eligibility" | "performer_eligibility"
): Promise<{ status: string } | null> {
  const rows = await sql<Array<{ status: string }>>`
    select status
    from private.current_verification_decision(
      ${subjectType}, ${subjectId}, ${purpose}
    )
  `;
  return rows[0] ?? null;
}

interface CurrentDecisionStateProjection {
  decision_authority: string;
  decision_effective_at: Date | null;
  record_id: string;
  status: string;
  subject_id: string;
}

async function expectPluralScalarParity(
  sql: PostgresSql,
  subjectIds: string[]
): Promise<CurrentDecisionStateProjection[]> {
  const scalar = await sql<CurrentDecisionStateProjection[]>`
    with requested_subjects as (
      select distinct requested.subject_id
      from unnest(${subjectIds}::uuid[]) requested(subject_id)
    )
    select
      requested.subject_id,
      decision.record_id,
      decision.status,
      decision.decision_effective_at,
      decision.decision_authority
    from requested_subjects requested
    cross join lateral private.current_verification_decision_state(
      'user', requested.subject_id, 'age_access'
    ) decision
    order by requested.subject_id
  `;
  const plural = await sql<CurrentDecisionStateProjection[]>`
    select
      decision.subject_id,
      decision.record_id,
      decision.status,
      decision.decision_effective_at,
      decision.decision_authority
    from private.current_verification_decision_states(
      'user', ${subjectIds}::uuid[], 'age_access'
    ) decision
    order by decision.subject_id
  `;

  expect(plural).toEqual(scalar);
  return plural;
}

async function contentPerformerReadiness(
  sql: PostgresSql,
  contentId: string
): Promise<boolean> {
  const rows = await sql<Array<{ ready: boolean }>>`
    select private.content_performer_readiness(${contentId}) as ready
  `;
  return rows[0]?.ready === true;
}

async function protectedAppAccess(
  sql: PostgresSql,
  subjectId: string
): Promise<boolean> {
  const rows = await sql.begin(async (transaction) => {
    await transaction.unsafe("set local role authenticated");
    await transaction`select set_config('request.jwt.claim.sub', ${subjectId}, true)`;
    return transaction<Array<{ allowed: boolean }>>`
      select private.has_protected_app_access() as allowed
    `;
  });
  return rows[0]?.allowed === true;
}

async function incomingDecisionWins(
  sql: PostgresSql,
  subjectId: string,
  status: DecisionInput["status"],
  providerEventAt: string | null,
  sessionId?: string
): Promise<boolean> {
  const rows = sessionId
    ? await sql<Array<{ wins: boolean }>>`
        select private.incoming_verification_decision_is_current(
          'user', ${subjectId}, 'age_access', ${status},
          ${providerEventAt}::timestamptz, ${sessionId}
        ) as wins
      `
    : await sql<Array<{ wins: boolean }>>`
        select private.incoming_verification_decision_is_current(
          'user', ${subjectId}, 'age_access', ${status}, ${providerEventAt}::timestamptz
        ) as wins
      `;
  return rows[0]?.wins === true;
}
