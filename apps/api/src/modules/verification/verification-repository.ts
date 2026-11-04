import { randomUUID } from "node:crypto";
import {
  resolvePostgresClient,
  type PostgresSql,
  type PostgresTransaction
} from "../../shared/postgres.js";
import type {
  CapabilityKey,
  CapabilityResolution,
  NormalizedVerificationWebhook,
  VerificationPurpose,
  VerificationProviderSession,
  VerificationRecordResource,
  VerificationRepository
} from "./types.js";

type WebhookDecisionInput = NormalizedVerificationWebhook & { payloadHash?: string };
type DecisionApplyResult = "applied" | "unmatched" | "ignored";

export class VerificationRepositoryConfigurationError extends Error {
  constructor() {
    super("DATABASE_URL_NOT_CONFIGURED");
    this.name = "VerificationRepositoryConfigurationError";
  }
}

interface VerificationRecordRow {
  subject_type: VerificationRecordResource["subjectType"];
  subject_id: string;
  purpose: VerificationRecordResource["purpose"];
  status: VerificationRecordResource["status"];
  provider: string;
  method: string;
  assurance_level: string;
  verified_at: Date | null;
  expires_at: Date | null;
  reusable: boolean;
}

export function createPostgresVerificationRepository(database?: string | PostgresSql): VerificationRepository {
  if (!database) {
    return {
      async authorizeOrganizationVerification() {
        throw new VerificationRepositoryConfigurationError();
      },
      async createPendingSession() {
        throw new VerificationRepositoryConfigurationError();
      },
      async reservePendingSession() {
        throw new VerificationRepositoryConfigurationError();
      },
      async selectPendingSessionProvider() {
        throw new VerificationRepositoryConfigurationError();
      },
      async completePendingSession() {
        throw new VerificationRepositoryConfigurationError();
      },
      async failPendingSession() {
        throw new VerificationRepositoryConfigurationError();
      },
      async applyProviderWebhook() {
        throw new VerificationRepositoryConfigurationError();
      },
      async updateVerificationFromWebhook() {
        throw new VerificationRepositoryConfigurationError();
      },
      async findLatestUserVerification() {
        throw new VerificationRepositoryConfigurationError();
      },
      async findLatestOrganizationVerification() {
        throw new VerificationRepositoryConfigurationError();
      },
      async resolveCapabilities() {
        throw new VerificationRepositoryConfigurationError();
      }
    };
  }

  const { sql, ownsClient } = resolvePostgresClient(database);

  return {
    async authorizeOrganizationVerification(input) {
      const rows = await sql<Array<{ allowed: boolean }>>`
        select exists (
          select 1
          from organization_memberships membership
          join users actor on actor.id = membership.user_id
          where actor.supabase_user_id = ${input.supabaseUserId}
            and membership.organization_id = ${input.organizationId}
            and membership.state = 'active'
            and (
              ${input.access} = 'read'
              or membership.role in ('owner', 'admin')
            )
        ) as allowed
      `;
      return rows[0]?.allowed === true;
    },
    async createPendingSession(input) {
      const subject = await resolveSessionSubject(sql, input);
      const providerSession = input.providerSession;
      return sql.begin(async (tx) => {
        const rows = await tx<Array<{ id: string }>>`
          insert into verification_sessions (
            subject_type, subject_id, purpose, provider, provider_external_user_id,
            provider_session_id, provider_applicant_id, provider_inquiry_id,
            provider_transaction_id, requested_method, status, assurance_level,
            reusable, expires_at, policy_version, terms_accepted_at, launch_state
          )
          values (
            ${subject.subjectType}, ${subject.subjectId}, ${input.purpose},
            ${providerSession.provider}, ${providerSession.providerExternalUserId ?? null},
            ${providerSession.providerSessionId ?? null},
            ${providerSession.providerApplicantId ?? null},
            ${providerSession.providerInquiryId ?? null},
            ${providerSession.providerTransactionId ?? null},
            ${providerSession.method}, 'pending', ${providerSession.assuranceLevel},
            ${providerSession.reusable ?? false}, ${providerSession.expiresAt},
            ${input.policyVersion ?? null}, ${input.termsAcceptedAt ?? null}, 'ready'
          )
          returning id
        `;
        const sessionId = rows[0]?.id;
        if (!sessionId) throw new Error("VERIFICATION_SESSION_INSERT_FAILED");

        await insertPendingVerificationRecord(tx, {
          sessionId,
          subjectType: subject.subjectType,
          subjectId: subject.subjectId,
          purpose: input.purpose,
          providerSession,
          policyVersion: input.policyVersion ?? null,
          termsAcceptedAt: input.termsAcceptedAt ?? null
        });
        return sessionId;
      });
    },
    async reservePendingSession(input) {
      const subject = await resolveSessionSubject(sql, input);
      const proposedSessionId = randomUUID();
      const subjectReference = `wevid:${subject.subjectType}:${subject.subjectId}:${input.purpose}:${proposedSessionId}`;

      return sql.begin(async (tx) => {
        const rows = await tx<Array<{ id: string }>>`
          insert into verification_sessions (
            id, subject_type, subject_id, purpose, provider, provider_external_user_id,
            requested_method, status, assurance_level, reusable, policy_version,
            terms_accepted_at, launch_state, request_key, request_hash
          )
          values (
            ${proposedSessionId}, ${subject.subjectType}, ${subject.subjectId}, ${input.purpose}, 'internal',
            ${subjectReference}, 'manual_review', 'created', 'low', false,
            ${input.policyVersion ?? null}, ${input.termsAcceptedAt ?? null},
            'reserved', ${input.idempotencyKey}, ${input.requestHash}
          )
          on conflict (subject_type, subject_id, purpose, request_key)
            where request_key is not null
          do nothing
          returning id
        `;

        const reservedSessionId = rows[0]?.id;
        if (!reservedSessionId) {
          const existing = await tx<Array<{ request_hash: string }>>`
            select request_hash
            from verification_sessions
            where subject_type = ${subject.subjectType}
              and subject_id = ${subject.subjectId}
              and purpose = ${input.purpose}
              and request_key = ${input.idempotencyKey}
            limit 1
          `;
          if (existing[0]?.request_hash !== input.requestHash) {
            throw new Error("IDEMPOTENCY_KEY_REUSED");
          }
          throw new Error("VERIFICATION_SESSION_ALREADY_RESERVED");
        }

        await tx`
          insert into verification_records (
            subject_type, subject_id, purpose, status, provider, method,
            assurance_level, reusable, policy_version, terms_accepted_at, metadata
          )
          values (
            ${subject.subjectType}, ${subject.subjectId}, ${input.purpose}, 'pending',
            'internal', 'manual_review', 'low', false, ${input.policyVersion ?? null},
            ${input.termsAcceptedAt ?? null},
            ${tx.json({ source: "verification_session_reservation", sessionId: reservedSessionId })}
          )
        `;

        return { id: reservedSessionId, subjectReference };
      });
    },
    async selectPendingSessionProvider(input) {
      await sql.begin(async (tx) => {
        const updated = await tx<Array<{ id: string }>>`
          update verification_sessions
          set provider = ${input.selection.provider},
              requested_method = ${input.selection.method},
              assurance_level = ${input.selection.assuranceLevel},
              reusable = ${input.selection.reusable},
              status = 'pending',
              updated_at = now()
          where id = ${input.sessionId} and launch_state = 'reserved'
          returning id
        `;
        if (!updated[0]) throw new Error("VERIFICATION_SESSION_RESERVATION_NOT_FOUND");
        await tx`
          update verification_records
          set provider = ${input.selection.provider}, method = ${input.selection.method},
              assurance_level = ${input.selection.assuranceLevel},
              reusable = ${input.selection.reusable}, updated_at = now()
          where metadata ->> 'sessionId' = ${input.sessionId}
            and metadata ->> 'source' = 'verification_session_reservation'
        `;
      });
    },
    async completePendingSession(input) {
      await sql.begin(async (tx) => {
        const providerSession = input.providerSession;
        const rows = await tx<Array<{ id: string }>>`
          update verification_sessions
          set provider = ${providerSession.provider},
              provider_external_user_id = coalesce(${providerSession.providerExternalUserId ?? null}, provider_external_user_id),
              provider_session_id = coalesce(${providerSession.providerSessionId ?? null}, provider_session_id),
              provider_applicant_id = coalesce(${providerSession.providerApplicantId ?? null}, provider_applicant_id),
              provider_inquiry_id = coalesce(${providerSession.providerInquiryId ?? null}, provider_inquiry_id),
              provider_transaction_id = coalesce(${providerSession.providerTransactionId ?? null}, provider_transaction_id),
              requested_method = ${providerSession.method},
              assurance_level = ${providerSession.assuranceLevel},
              reusable = ${providerSession.reusable ?? false},
              expires_at = ${providerSession.expiresAt}, launch_state = 'ready',
              status = case when status = 'created' then 'pending' else status end,
              updated_at = now()
          where id = ${input.sessionId} and launch_state in ('reserved', 'failed')
          returning id
        `;
        if (!rows[0]) throw new Error("VERIFICATION_SESSION_RESERVATION_NOT_FOUND");
        await tx`
          update verification_records
          set provider = ${providerSession.provider},
              provider_reference = ${providerSession.providerReference},
              method = ${providerSession.method}, assurance_level = ${providerSession.assuranceLevel},
              expires_at = ${providerSession.expiresAt}, reusable = ${providerSession.reusable ?? false},
              updated_at = now()
          where metadata ->> 'sessionId' = ${input.sessionId}
            and metadata ->> 'source' = 'verification_session_reservation'
        `;
        await reconcilePendingVerificationEvents(tx, input.sessionId);
      });
    },
    async failPendingSession(input) {
      await sql`
        update verification_sessions
        set launch_state = 'failed', status = 'failed', updated_at = now()
        where id = ${input.sessionId} and launch_state = 'reserved'
      `;
    },
    async applyProviderWebhook(input) {
      return sql.begin(async (tx) => {
        const rows = await tx<Array<{ id: string; processing_status: string }>>`
          insert into verification_events (
            provider, event_type, idempotency_key, payload_hash, processing_status,
            provider_reference, provider_subject_reference, correlation_id,
            decision_status, occurred_at, failure_reason_code, signature_hash,
            identity_evidence
          )
          values (
            ${input.provider}, ${input.eventType}, ${input.providerEventId},
            ${input.payloadHash}, 'received', ${input.providerReference},
            ${input.providerSubjectReference ?? null}, ${input.providerCorrelationId ?? null},
            ${input.status}, ${input.occurredAt ?? null}, ${input.failureReasonCode ?? null},
            ${input.signatureHash}, ${input.identityEvidence ? tx.json(input.identityEvidence) : null}
          )
          on conflict do nothing
          returning id, processing_status
        `;

        let receipt = rows[0];
        if (!receipt) {
          const existing = await tx<Array<{ id: string; processing_status: string }>>`
            select id, processing_status
            from verification_events
            where provider = ${input.provider}
              and (payload_hash = ${input.payloadHash} or idempotency_key = ${input.providerEventId})
            order by received_at desc
            limit 1
            for update
          `;
          receipt = existing[0];
          if (!receipt || ["processed", "ignored"].includes(receipt.processing_status)) {
            return "duplicate" as const;
          }
        }

        const result = await applyVerificationWebhookDecision(tx, input, receipt.id);
        if (result === "ignored") return "duplicate" as const;
        return result === "applied" ? "applied" as const : "unmatched" as const;
      });
    },
    async updateVerificationFromWebhook(input) {
      return sql.begin(async (tx) => (await applyVerificationWebhookDecision(tx, input, null)) === "applied");
    },
    async findLatestUserVerification(input) {
      const rows = await sql<VerificationRecordRow[]>`
        select
          vr.subject_type,
          vr.subject_id,
          vr.purpose,
          case
            when vr.status = 'valid' and vr.expires_at is not null and vr.expires_at <= now() then 'expired'
            else vr.status
          end as status,
          vr.provider,
          vr.method,
          vr.assurance_level,
          vr.verified_at,
          vr.expires_at,
          vr.reusable
        from verification_records vr
        join users u on u.id = vr.subject_id
        where vr.subject_type = 'user'
          and u.supabase_user_id = ${input.supabaseUserId}
          and vr.purpose = ${input.purpose}
        order by vr.provider_event_at desc nulls last, vr.created_at desc, vr.id desc
        limit 1
      `;

      return rows[0] ? toRecord(rows[0]) : null;
    },
    async findLatestOrganizationVerification(input) {
      const rows = await sql<VerificationRecordRow[]>`
        select
          subject_type,
          subject_id,
          purpose,
          case
            when status = 'valid' and expires_at is not null and expires_at <= now() then 'expired'
            else status
          end as status,
          provider,
          method,
          assurance_level,
          verified_at,
          expires_at,
          reusable
        from verification_records
        where subject_type = 'organization'
          and subject_id = ${input.organizationId}
          and purpose = ${input.purpose}
        order by provider_event_at desc nulls last, created_at desc, id desc
        limit 1
      `;

      return rows[0] ? toRecord(rows[0]) : null;
    },
    async resolveCapabilities(input) {
      if (input.organizationId && !(await this.authorizeOrganizationVerification({
        supabaseUserId: input.supabaseUserId,
        organizationId: input.organizationId,
        access: "read"
      }))) {
        throw new Error("ORGANIZATION_ACCESS_REQUIRED");
      }
      const [ageAccess, adultPublisherEligibility, creatorKyc, orgKyb, policyRows] = await Promise.all([
        this.findLatestUserVerification({
          supabaseUserId: input.supabaseUserId,
          purpose: "age_access"
        }),
        this.findLatestUserVerification({
          supabaseUserId: input.supabaseUserId,
          purpose: "adult_publisher_eligibility"
        }),
        this.findLatestUserVerification({
          supabaseUserId: input.supabaseUserId,
          purpose: "creator_kyc"
        }),
        input.organizationId
          ? this.findLatestOrganizationVerification({
              organizationId: input.organizationId,
              purpose: "org_kyb"
            })
          : Promise.resolve(null),
        sql<Array<{
          kyc_required: boolean;
          kyc_state: "not_required" | "required" | "pending" | "verified" | "failed";
        }>>`
          select kyc.kyc_required, kyc.kyc_state
          from users actor
          cross join lateral private.resolve_creator_kyc_state(actor.id) kyc
          where actor.supabase_user_id = ${input.supabaseUserId}
          limit 1
        `
      ]);

      return resolveCapabilitiesFromRecords({
        ageAccess,
        adultPublisherEligibility,
        creatorKyc,
        orgKyb,
        creatorKycRequired: policyRows[0]?.kyc_required ?? true,
        ...(policyRows[0]?.kyc_state
          ? { creatorKycState: policyRows[0].kyc_state }
          : {})
      });
    },
    async close() {
      if (ownsClient) {
        await sql.end({ timeout: 5 });
      }
    }
  };
}

async function applyVerificationWebhookDecision(
  tx: PostgresTransaction,
  input: WebhookDecisionInput,
  eventReceiptId: string | null
): Promise<DecisionApplyResult> {
  const sessionRows = await tx<Array<{
    id: string;
    subject_type: VerificationRecordResource["subjectType"];
    subject_id: string;
    purpose: VerificationPurpose;
    requested_method: VerificationRecordResource["method"];
    assurance_level: VerificationRecordResource["assuranceLevel"];
    reusable: boolean;
    expires_at: Date | null;
    provider_event_at: Date | null;
    policy_version: string | null;
    terms_accepted_at: Date | null;
  }>>`
    select
      id, subject_type, subject_id, purpose, requested_method,
      assurance_level, reusable, expires_at, provider_event_at, policy_version, terms_accepted_at
    from verification_sessions
    where provider = ${input.provider}
      and (
        provider_session_id = ${input.providerReference}
        or provider_applicant_id = ${input.providerReference}
        or provider_inquiry_id = ${input.providerReference}
        or provider_transaction_id = ${input.providerReference}
        or provider_external_user_id = ${input.providerSubjectReference ?? input.providerReference}
      )
    order by
      case when provider_session_id = ${input.providerReference}
        or provider_applicant_id = ${input.providerReference}
        or provider_inquiry_id = ${input.providerReference}
        or provider_transaction_id = ${input.providerReference}
      then 0 else 1 end,
      created_at desc
    limit 1
    for update
  `;
  const session = sessionRows[0];

  if (!session) {
    // Keep the authenticated normalized receipt replayable. A provider can
    // deliver before its remote create response is attached to the local
    // reservation; completePendingSession reconciles these rows.
    return "unmatched";
  }

  const decision = verificationDecisionForSession(input, session.purpose);
  const lockKey = `${session.subject_type}:${session.subject_id}:${session.purpose}`;
  await tx`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;

  const currentRows = await tx<Array<{
    status: VerificationRecordResource["status"];
    provider_event_at: Date | null;
  }>>`
    select status, provider_event_at
    from verification_records
    where subject_type = ${session.subject_type}
      and subject_id = ${session.subject_id}
      and purpose = ${session.purpose}
      and metadata ->> 'source' = 'provider_webhook'
    order by provider_event_at desc nulls last, created_at desc, id desc
    limit 1
    for update
  `;
  const current = currentRows[0];
  if (!shouldApplyProviderDecision(current, input.occurredAt ?? null, decision.status)) {
    if (eventReceiptId) {
      await tx`
        update verification_events
        set session_id = ${session.id}, processing_status = 'ignored', processed_at = now()
        where id = ${eventReceiptId}
      `;
    }
    return "ignored";
  }
  const decisionAt = input.occurredAt ?? new Date();

  await tx`
    update verification_sessions
    set
      status = ${sessionStatus(decision.status)},
      provider_external_user_id = coalesce(${input.providerSubjectReference ?? null}, provider_external_user_id),
      provider_session_id = case when ${input.provider} in ('didit', 'yoti', 'veriff')
        then coalesce(provider_session_id, ${input.providerReference}) else provider_session_id end,
      provider_applicant_id = case when ${input.provider} = 'sumsub'
        then coalesce(provider_applicant_id, ${input.providerReference}) else provider_applicant_id end,
      provider_inquiry_id = case when ${input.provider} = 'persona'
        then coalesce(provider_inquiry_id, ${input.providerReference}) else provider_inquiry_id end,
      provider_event_at = ${decisionAt},
      updated_at = now(),
      completed_at = case when ${decision.status} in ('valid', 'invalid', 'blocked') then coalesce(${input.occurredAt ?? null}, now()) else completed_at end
    where id = ${session.id}
  `;

  const records = await tx<Array<{ id: string }>>`
    insert into verification_records (
      subject_type, subject_id, purpose, status, provider, provider_reference,
      method, threshold_age, result_over_threshold, assurance_level, verified_at,
      expires_at, reusable, raw_payload_hash, failure_reason_code, policy_version,
      terms_accepted_at, provider_event_at, metadata
    )
    values (
      ${session.subject_type}, ${session.subject_id}, ${session.purpose}, ${decision.status},
      ${input.provider}, ${input.providerReference}, ${session.requested_method},
      case when ${session.purpose} = 'age_access' then 18 else null end,
      case when ${session.purpose} = 'age_access' and ${decision.status} = 'valid' then true
        when ${session.purpose} = 'age_access' and ${decision.status} in ('invalid', 'blocked') then false
        else null end,
      ${session.assurance_level},
      case when ${decision.status} = 'valid' then coalesce(${input.occurredAt ?? null}, now()) else null end,
      case when ${decision.status} = 'pending'
        then ${session.expires_at}::timestamptz else null::timestamptz end,
      ${session.reusable}, ${input.payloadHash ?? input.signatureHash},
      ${decision.failureReasonCode},
      ${session.policy_version}, ${session.terms_accepted_at},
      ${decisionAt},
      ${tx.json({
        source: "provider_webhook",
        eventType: input.eventType,
        providerEventId: input.providerEventId,
        providerCorrelationId: input.providerCorrelationId ?? null,
        providerOccurredAtMissing: !input.occurredAt
      })}
    )
    returning id
  `;

  const recordId = records[0]?.id ?? null;
  if (
    recordId &&
    decision.status === "valid" &&
    session.purpose === "adult_publisher_eligibility" &&
    ["gov_id_selfie", "doc_scan"].includes(session.requested_method) &&
    ["high", "documentary"].includes(session.assurance_level)
  ) {
    await tx`
      insert into verification_records (
        subject_type, subject_id, purpose, status, provider, provider_reference,
        method, threshold_age, result_over_threshold, assurance_level,
        verified_at, expires_at, reusable, derived_from_record_id, provider_event_at, metadata
      )
      values (
        ${session.subject_type}, ${session.subject_id}, 'age_access', 'valid',
        ${input.provider}, ${input.providerReference}, ${session.requested_method},
        18, true, ${session.assurance_level}, coalesce(${input.occurredAt ?? null}, now()),
        null, ${session.reusable}, ${recordId}, ${decisionAt},
        ${tx.json({ source: "adult_publisher_eligibility", eventType: input.eventType })}
      )
    `;
  }

  if (decision.status === "valid" && session.purpose === "age_access") {
    await tx`
      update users
      set state = case when state = 'provisional' then 'active' else state end,
          updated_at = now()
      where id = ${session.subject_id}
        and state in ('provisional', 'active')
    `;
  }

  if (eventReceiptId) {
    await tx`
      update verification_events
      set session_id = ${session.id}, processing_status = 'processed', processed_at = now()
      where id = ${eventReceiptId}
    `;
  }

  await tx`
    insert into audit_events (id, actor_user_id, subject_type, subject_id, action, metadata)
    values (
      ${randomUUID()}, null, 'verification_record', ${records[0]?.id ?? session.id},
      'verification.webhook_applied',
      ${tx.json({
        provider: input.provider,
        providerEventId: input.providerEventId,
        purpose: session.purpose,
        status: decision.status
      })}
    )
  `;

  return "applied";
}

async function insertPendingVerificationRecord(
  tx: PostgresTransaction,
  input: {
    sessionId: string;
    subjectType: VerificationRecordResource["subjectType"];
    subjectId: string;
    purpose: VerificationPurpose;
    providerSession: VerificationProviderSession;
    policyVersion: string | null;
    termsAcceptedAt: Date | null;
  }
): Promise<void> {
  await tx`
    insert into verification_records (
      subject_type, subject_id, purpose, status, provider, provider_reference,
      method, threshold_age, assurance_level, expires_at, reusable,
      policy_version, terms_accepted_at, metadata
    )
    values (
      ${input.subjectType}, ${input.subjectId}, ${input.purpose}, 'pending',
      ${input.providerSession.provider}, ${input.providerSession.providerReference},
      ${input.providerSession.method},
      case when ${input.purpose} = 'age_access' then 18 else null end,
      ${input.providerSession.assuranceLevel}, ${input.providerSession.expiresAt},
      ${input.providerSession.reusable ?? false}, ${input.policyVersion},
      ${input.termsAcceptedAt},
      ${tx.json({ source: "verification_session", sessionId: input.sessionId })}
    )
  `;
}

async function reconcilePendingVerificationEvents(
  tx: PostgresTransaction,
  sessionId: string
): Promise<void> {
  const sessions = await tx<Array<{
    provider: NormalizedVerificationWebhook["provider"];
    provider_session_id: string | null;
    provider_applicant_id: string | null;
    provider_inquiry_id: string | null;
    provider_transaction_id: string | null;
    provider_external_user_id: string | null;
  }>>`
    select provider, provider_session_id, provider_applicant_id, provider_inquiry_id,
           provider_transaction_id, provider_external_user_id
    from verification_sessions
    where id = ${sessionId}
    limit 1
  `;
  const session = sessions[0];
  if (!session) return;

  const references = [
    session.provider_session_id,
    session.provider_applicant_id,
    session.provider_inquiry_id,
    session.provider_transaction_id
  ].filter((value): value is string => Boolean(value));
  const events = await tx<Array<{
    id: string;
    event_type: string;
    idempotency_key: string | null;
    payload_hash: string;
    provider_reference: string | null;
    provider_subject_reference: string | null;
    correlation_id: string | null;
    decision_status: NormalizedVerificationWebhook["status"] | null;
    occurred_at: Date | null;
    failure_reason_code: string | null;
    signature_hash: string | null;
    identity_evidence: NormalizedVerificationWebhook["identityEvidence"];
  }>>`
    select id, event_type, idempotency_key, payload_hash, provider_reference,
           provider_subject_reference, correlation_id, decision_status, occurred_at,
           failure_reason_code, signature_hash, identity_evidence
    from verification_events
    where provider = ${session.provider}
      and processing_status in ('received', 'failed')
      and session_id is null
      and (
        provider_subject_reference = ${session.provider_external_user_id}
        or provider_reference in ${tx(references.length > 0 ? references : ["__none__"])}
      )
    order by occurred_at asc nulls first, received_at asc, id asc
    for update
  `;

  for (const event of events) {
    if (!event.provider_reference || !event.decision_status) continue;
    await applyVerificationWebhookDecision(tx, {
      provider: session.provider,
      providerEventId: event.idempotency_key ?? `receipt:${event.id}`,
      providerReference: event.provider_reference,
      providerSubjectReference: event.provider_subject_reference,
      providerCorrelationId: event.correlation_id,
      eventType: event.event_type,
      status: event.decision_status,
      signatureHash: event.signature_hash,
      occurredAt: event.occurred_at,
      failureReasonCode: event.failure_reason_code,
      ...(event.identity_evidence !== undefined
        ? { identityEvidence: event.identity_evidence }
        : {}),
      payloadHash: event.payload_hash
    }, event.id);
  }
}

function shouldApplyProviderDecision(
  current: { status: VerificationRecordResource["status"]; provider_event_at: Date | null } | undefined,
  incomingAt: Date | null,
  incomingStatus: NormalizedVerificationWebhook["status"]
): boolean {
  if (!current) return true;
  const currentAt = current.provider_event_at?.getTime() ?? null;
  const nextAt = incomingAt?.getTime() ?? null;

  if (currentAt !== null && nextAt !== null) {
    if (nextAt < currentAt) return false;
    if (nextAt > currentAt) return true;
    return decisionRank(incomingStatus) > decisionRank(current.status);
  }

  if (nextAt === null) {
    // Timestamp-less positive or pending events cannot displace an existing
    // authoritative decision. An adverse result still fails closed.
    return incomingStatus === "blocked" || incomingStatus === "invalid";
  }
  return true;
}

function decisionRank(status: NormalizedVerificationWebhook["status"] | VerificationRecordResource["status"]): number {
  if (status === "blocked" || status === "invalid" || status === "revoked") return 3;
  if (status === "valid") return 2;
  return 1;
}

async function resolveSessionSubject(
  sql: PostgresSql,
  input: {
    supabaseUserId: string;
    purpose: Extract<
      VerificationPurpose,
      "age_access" | "adult_publisher_eligibility" | "creator_kyc" | "org_kyb"
    >;
    organizationId?: string | null;
  }
): Promise<{ subjectType: VerificationRecordResource["subjectType"]; subjectId: string }> {
  if (input.purpose === "org_kyb") {
    if (!input.organizationId) {
      throw new Error("ORGANIZATION_ID_REQUIRED");
    }

    const rows = await sql<Array<{ organization_id: string }>>`
      select om.organization_id
      from organization_memberships om
      join users u on u.id = om.user_id
      where u.supabase_user_id = ${input.supabaseUserId}
        and om.organization_id = ${input.organizationId}
        and om.state = 'active'
        and om.role in ('owner', 'admin')
      limit 1
    `;

    if (!rows[0]) {
      throw new Error("ORGANIZATION_ACCESS_REQUIRED");
    }

    return { subjectType: "organization", subjectId: rows[0].organization_id };
  }

  const rows = await sql<Array<{ id: string }>>`
    select id
    from users
    where supabase_user_id = ${input.supabaseUserId}
    limit 1
  `;

  if (!rows[0]) {
    throw new Error("USER_NOT_FOUND");
  }

  return { subjectType: "user", subjectId: rows[0].id };
}

function sessionStatus(status: NormalizedVerificationWebhook["status"]) {
  if (status === "valid") return "approved";
  if (status === "blocked" || status === "invalid") return "declined";
  return "pending";
}

function verificationDecisionForSession(
  input: NormalizedVerificationWebhook,
  purpose: VerificationPurpose
): { status: NormalizedVerificationWebhook["status"]; failureReasonCode: string | null } {
  const requiresIdentityEvidence =
    input.provider === "didit" &&
    input.eventType !== "mock.auto_approved" &&
    (purpose === "adult_publisher_eligibility" || purpose === "creator_kyc");
  const evidence = input.identityEvidence;

  if (
    input.status === "valid" &&
    requiresIdentityEvidence &&
    (!evidence?.documentApproved || !evidence.livenessApproved || !evidence.faceMatchApproved)
  ) {
    return {
      status: "invalid",
      failureReasonCode: "didit_required_identity_evidence_missing"
    };
  }

  return { status: input.status, failureReasonCode: input.failureReasonCode ?? null };
}

export function resolveCapabilitiesFromRecords(input: {
  ageAccess: VerificationRecordResource | null;
  adultPublisherEligibility?: VerificationRecordResource | null;
  creatorKyc: VerificationRecordResource | null;
  orgKyb: VerificationRecordResource | null;
  creatorKycRequired?: boolean;
  creatorKycState?: "not_required" | "required" | "pending" | "verified" | "failed";
}): CapabilityResolution {
  const hasAge = isValid(input.ageAccess);
  const hasAdultPublisherEligibility = hasAge && isValid(input.adultPublisherEligibility ?? null);
  const hasCreatorKyc = input.creatorKycState
    ? input.creatorKycState === "verified"
    : isValid(input.creatorKyc);
  const creatorKycSatisfied = input.creatorKycRequired === false || hasCreatorKyc;
  const capabilities: Record<CapabilityKey, boolean> = {
    canAccessApp: hasAge,
    canCreateProfile: hasAge,
    canViewAgeRestrictedContent: hasAge,
    canStartCreatorOnboarding: hasAge,
    canCreateDraft: hasAge,
    canUploadMedia: hasAge,
    canPublishMedia: hasAge,
    canPublishAdultMedia: hasAdultPublisherEligibility,
    canMonetize: hasAge && creatorKycSatisfied,
    canReceiveCreatorProceeds: hasAge && creatorKycSatisfied,
    canAccessCreatorDashboard: hasAge,
    canCreateOrganization: hasAge,
    canAccessStudio: false,
    canInviteTeam: false,
    canUseTeamPublishing: false,
    canUseAllocationWallets: false,
    canUseComplianceExports: false,
    canAccessEnterprise: false
  };
  const missingRequirements = missingFromCapabilities(
    capabilities,
    input.creatorKycRequired !== false
  );

  return {
    capabilities,
    missingRequirements,
    nextBestAction: nextBestAction(capabilities),
    verificationSummary: {
      ageAccess: input.ageAccess,
      adultPublisherEligibility: input.adultPublisherEligibility ?? null,
      creatorKyc: input.creatorKyc,
      orgKyb: input.orgKyb
    }
  };
}

export function isValid(record: VerificationRecordResource | null): boolean {
  if (!record || record.status !== "valid") {
    return false;
  }

  if (!record.expiresAt) {
    return true;
  }

  return new Date(record.expiresAt).getTime() > Date.now();
}

function missingFromCapabilities(
  capabilities: Record<CapabilityKey, boolean>,
  creatorKycRequired: boolean
): string[] {
  const missing = new Set<string>();

  if (!capabilities.canAccessApp) {
    missing.add("age_access_required");
  }
  if (!capabilities.canPublishAdultMedia) {
    missing.add("adult_publisher_eligibility_required");
  }
  if (!capabilities.canMonetize && creatorKycRequired) {
    missing.add("creator_kyc_required_for_earning");
  }
  return [...missing];
}

function nextBestAction(capabilities: Record<CapabilityKey, boolean>): string {
  if (!capabilities.canAccessApp) {
    return "verify_age";
  }
  return "continue";
}

function toRecord(row: VerificationRecordRow): VerificationRecordResource {
  return {
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    purpose: row.purpose,
    status: row.status,
    provider: row.provider,
    method: row.method,
    assuranceLevel: row.assurance_level,
    verifiedAt: row.verified_at?.toISOString() ?? null,
    expiresAt: row.expires_at?.toISOString() ?? null,
    reusable: row.reusable
  };
}
