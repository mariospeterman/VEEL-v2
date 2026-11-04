import { createHash, randomUUID } from "node:crypto";
import {
  resolvePostgresClient,
  type PostgresSql,
  type PostgresTransaction
} from "../../shared/postgres.js";
import type {
  AgeProvider,
  AgeRepository,
  AgeState,
  AgeStatus,
  UpdateAgeVerificationFromWebhookInput
} from "./types.js";

export class AgeRepositoryConfigurationError extends Error {
  constructor() {
    super("DATABASE_URL_NOT_CONFIGURED");
    this.name = "AgeRepositoryConfigurationError";
  }
}

interface AgeStatusRow {
  status: "valid" | "invalid" | "pending" | "expired" | "revoked" | "blocked" | null;
  provider: string | null;
}

type AgeDecisionApplyResult = "applied" | "unmatched" | "ignored";

const requiredAgeStatus: AgeStatus = { state: "required", provider: null };

export function createPostgresAgeRepository(database?: string | PostgresSql): AgeRepository {
  if (!database) return unavailableAgeRepository();

  const { sql, ownsClient } = resolvePostgresClient(database);

  return {
    async findLatestAgeStatusByUserId(userId) {
      return findLatestAgeStatus(sql, "canonical", userId);
    },
    async findLatestAgeStatusBySupabaseUserId(supabaseUserId) {
      return findLatestAgeStatus(sql, "legacy", supabaseUserId);
    },

    async createPendingAgeVerification(input) {
      await sql.begin(async (tx) => {
        const users = await tx<{ id: string }[]>`
          select id from users where id = ${input.userId} limit 1
        `;
        const user = users[0];
        if (!user) throw new Error("USER_NOT_FOUND");

        const method = ageMethod(input.provider);
        const assurance = ageAssurance(input.provider);

        await tx`
          insert into verification_sessions (
            subject_type,
            subject_id,
            purpose,
            provider,
            provider_external_user_id,
            provider_session_id,
            requested_method,
            status,
            jurisdiction,
            threshold_age,
            assurance_level,
            reusable,
            expires_at
          )
          values (
            'user',
            ${user.id},
            'age_access',
            ${input.provider},
            ${input.providerExternalUserId ?? null},
            ${input.providerReference},
            ${method},
            'pending',
            ${input.jurisdiction ?? null},
            18,
            ${assurance},
            ${input.provider === "yoti"},
            ${input.expiresAt}
          )
        `;

        await tx`
          insert into verification_records (
            subject_type,
            subject_id,
            purpose,
            status,
            provider,
            provider_reference,
            method,
            jurisdiction,
            threshold_age,
            assurance_level,
            expires_at,
            reusable,
            metadata
          )
          values (
            'user',
            ${user.id},
            'age_access',
            'pending',
            ${input.provider},
            ${input.providerReference},
            ${method},
            ${input.jurisdiction ?? null},
            18,
            ${assurance},
            ${input.expiresAt},
            ${input.provider === "yoti"},
            ${tx.json({ source: "age_session", rule: input.rule ?? "over_18" })}
          )
        `;
      });
    },

    async reservePendingAgeVerification(input) {
      return sql.begin(async (tx) => {
        const users = await tx<Array<{ id: string }>>`
          select id from users where id = ${input.userId} limit 1
        `;
        const user = users[0];
        if (!user) throw new Error("USER_NOT_FOUND");
        const proposedSessionId = randomUUID();
        const subjectReference = `wevid:user:${user.id}:age_access:${proposedSessionId}`;
        const rows = await tx<Array<{ id: string }>>`
          insert into verification_sessions (
            id, subject_type, subject_id, purpose, provider, provider_external_user_id,
            requested_method, status, threshold_age, assurance_level, reusable,
            launch_state, request_key, request_hash
          )
          values (
            ${proposedSessionId}, 'user', ${user.id}, 'age_access', 'internal', ${subjectReference},
            'manual_review', 'created', 18, 'low', false, 'reserved',
            ${input.idempotencyKey}, ${input.requestHash}
          )
          on conflict (subject_type, subject_id, purpose, request_key)
            where request_key is not null
          do nothing
          returning id
        `;
        const reservedSessionId = rows[0]?.id;
        if (!reservedSessionId) {
          const existing = await tx<Array<{ request_hash: string }>>`
            select request_hash from verification_sessions
            where subject_type = 'user' and subject_id = ${user.id}
              and purpose = 'age_access' and request_key = ${input.idempotencyKey}
            limit 1
          `;
          if (existing[0]?.request_hash !== input.requestHash) throw new Error("IDEMPOTENCY_KEY_REUSED");
          throw new Error("VERIFICATION_SESSION_ALREADY_RESERVED");
        }
        await tx`
          insert into verification_records (
            subject_type, subject_id, purpose, status, provider, method,
            threshold_age, assurance_level, reusable, metadata
          )
          values (
            'user', ${user.id}, 'age_access', 'pending', 'internal', 'manual_review',
            18, 'low', false,
            ${tx.json({ source: "verification_session_reservation", sessionId: reservedSessionId })}
          )
        `;
        return { id: reservedSessionId, subjectReference };
      });
    },

    async selectPendingAgeProvider(input) {
      await sql.begin(async (tx) => {
        const rows = await tx<Array<{ id: string }>>`
          update verification_sessions
          set provider = ${input.provider}, requested_method = ${input.method},
              assurance_level = ${input.assuranceLevel}, reusable = ${input.reusable},
              status = 'pending', updated_at = now()
          where id = ${input.sessionId} and launch_state = 'reserved'
          returning id
        `;
        if (!rows[0]) throw new Error("VERIFICATION_SESSION_RESERVATION_NOT_FOUND");
        await tx`
          update verification_records
          set provider = ${input.provider}, method = ${input.method},
              assurance_level = ${input.assuranceLevel}, reusable = ${input.reusable},
              updated_at = now()
          where metadata ->> 'sessionId' = ${input.sessionId}
            and metadata ->> 'source' = 'verification_session_reservation'
        `;
      });
    },

    async completePendingAgeVerification(input) {
      await sql.begin(async (tx) => {
        const providerSession = input.providerSession;
        const rows = await tx<Array<{ id: string }>>`
          update verification_sessions
          set provider = ${providerSession.provider},
              provider_external_user_id = coalesce(${providerSession.providerExternalUserId ?? null}, provider_external_user_id),
              provider_session_id = case when ${providerSession.provider} in ('didit', 'yoti', 'veriff')
                then coalesce(provider_session_id, ${providerSession.providerReference}) else provider_session_id end,
              provider_inquiry_id = case when ${providerSession.provider} = 'persona'
                then coalesce(provider_inquiry_id, ${providerSession.providerReference}) else provider_inquiry_id end,
              requested_method = ${ageMethod(providerSession.provider)},
              assurance_level = ${ageAssurance(providerSession.provider)},
              reusable = ${providerSession.provider === "yoti"},
              expires_at = ${providerSession.expiresAt}, launch_state = 'ready',
              status = case when status = 'created' then 'pending' else status end,
              updated_at = now()
          where id = ${input.sessionId} and launch_state in ('reserved', 'failed')
          returning id
        `;
        if (!rows[0]) throw new Error("VERIFICATION_SESSION_RESERVATION_NOT_FOUND");
        await tx`
          update verification_records
          set provider = ${providerSession.provider}, provider_reference = ${providerSession.providerReference},
              method = ${ageMethod(providerSession.provider)},
              assurance_level = ${ageAssurance(providerSession.provider)},
              expires_at = ${providerSession.expiresAt}, reusable = ${providerSession.provider === "yoti"},
              updated_at = now()
          where metadata ->> 'sessionId' = ${input.sessionId}
            and metadata ->> 'source' = 'verification_session_reservation'
        `;
        await reconcilePendingAgeEvents(tx, input.sessionId);
      });
    },

    async failPendingAgeVerification(input) {
      await sql`
        update verification_sessions
        set launch_state = 'failed', status = 'failed', updated_at = now()
        where id = ${input.sessionId} and launch_state = 'reserved'
      `;
    },

    async applyProviderWebhook(input) {
      const payloadHash =
        input.payloadHash ?? input.signatureHash ??
        createHash("sha256")
          .update(`${input.provider}:${input.providerEventId}:${input.eventType}`)
          .digest("hex");
      return sql.begin(async (tx) => {
        const rows = await tx<Array<{ id: string; processing_status: string }>>`
          insert into verification_events (
            provider, event_type, idempotency_key, payload_hash, processing_status,
            provider_reference, provider_subject_reference, correlation_id,
            decision_status, occurred_at, failure_reason_code, signature_hash
          )
          values (
            ${input.provider}, ${input.eventType}, ${input.providerEventId}, ${payloadHash},
            'received', ${input.providerReference}, ${input.providerSubjectReference ?? null},
            ${input.providerCorrelationId ?? null}, ${toVerificationStatus(input.state)},
            ${input.verifiedAt ?? null}, ${input.failureCode ?? null}, ${input.signatureHash}
          )
          on conflict do nothing
          returning id, processing_status
        `;

        let receipt = rows[0];
        if (!receipt) {
          const existing = await tx<Array<{ id: string; processing_status: string }>>`
            select id, processing_status from verification_events
            where provider = ${input.provider}
              and (payload_hash = ${payloadHash} or idempotency_key = ${input.providerEventId})
            order by received_at desc limit 1 for update
          `;
          receipt = existing[0];
          if (!receipt || ["processed", "ignored"].includes(receipt.processing_status)) return "duplicate" as const;
        }
        const result = await applyAgeWebhookDecision(tx, input, receipt.id);
        if (result === "ignored") return "duplicate" as const;
        return result === "applied" ? "applied" as const : "unmatched" as const;
      });
    },

    async updateVerificationFromWebhook(input) {
      return sql.begin(async (tx) => (await applyAgeWebhookDecision(tx, input, null)) === "applied");
    },

    async close() {
      if (ownsClient) await sql.end({ timeout: 5 });
    }
  };
}

function unavailableAgeRepository(): AgeRepository {
  return {
    async findLatestAgeStatusByUserId() {
      throw new AgeRepositoryConfigurationError();
    },
    async findLatestAgeStatusBySupabaseUserId() {
      throw new AgeRepositoryConfigurationError();
    },
    async createPendingAgeVerification() {
      throw new AgeRepositoryConfigurationError();
    },
    async reservePendingAgeVerification() {
      throw new AgeRepositoryConfigurationError();
    },
    async selectPendingAgeProvider() {
      throw new AgeRepositoryConfigurationError();
    },
    async completePendingAgeVerification() {
      throw new AgeRepositoryConfigurationError();
    },
    async failPendingAgeVerification() {
      throw new AgeRepositoryConfigurationError();
    },
    async applyProviderWebhook() {
      throw new AgeRepositoryConfigurationError();
    },
    async updateVerificationFromWebhook() {
      throw new AgeRepositoryConfigurationError();
    }
  };
}

async function findLatestAgeStatus(
  sql: PostgresSql,
  identity: "canonical" | "legacy",
  userId: string
): Promise<AgeStatus> {
  const rows = identity === "canonical"
    ? await sql<AgeStatusRow[]>`
        select
          case
            when vr.status = 'valid' and vr.expires_at is not null and vr.expires_at <= now()
              then 'expired'
            else vr.status
          end as status,
          vr.provider
        from users u
        left join lateral (
          select status, provider, expires_at
          from verification_records
          where subject_type = 'user'
            and subject_id = u.id
            and purpose = 'age_access'
          order by provider_event_at desc nulls last, created_at desc, id desc
          limit 1
        ) vr on true
        where u.id = ${userId}
        limit 1
      `
    : await sql<AgeStatusRow[]>`
        select
          case
            when vr.status = 'valid' and vr.expires_at is not null and vr.expires_at <= now()
              then 'expired'
            else vr.status
          end as status,
          vr.provider
        from users u
        left join lateral (
          select status, provider, expires_at
          from verification_records
          where subject_type = 'user'
            and subject_id = u.id
            and purpose = 'age_access'
          order by provider_event_at desc nulls last, created_at desc, id desc
          limit 1
        ) vr on true
        where u.supabase_user_id = ${userId}
        limit 1
      `;
  const row = rows[0];

  if (!row?.status) return requiredAgeStatus;
  return { state: toAgeState(row.status), provider: row.provider };
}

async function applyAgeWebhookDecision(
  tx: PostgresTransaction,
  input: UpdateAgeVerificationFromWebhookInput,
  eventReceiptId: string | null
): Promise<AgeDecisionApplyResult> {
  const sessions = await tx<
    Array<{
      id: string;
      subject_id: string;
      requested_method: string;
      assurance_level: string;
      jurisdiction: string | null;
      expires_at: Date | null;
      reusable: boolean;
      provider_event_at: Date | null;
    }>
  >`
    select
      id,
      subject_id,
      requested_method,
      assurance_level,
      jurisdiction,
      expires_at,
      reusable,
      provider_event_at
    from verification_sessions
    where subject_type = 'user'
      and purpose = 'age_access'
      and provider = ${input.provider}
      and (
        provider_session_id = ${input.providerReference}
        or provider_applicant_id = ${input.providerReference}
        or provider_external_user_id = ${input.providerSubjectReference ?? input.providerReference}
      )
    order by
      case when provider_session_id = ${input.providerReference}
        or provider_applicant_id = ${input.providerReference}
      then 0 else 1 end,
      created_at desc
    limit 1
    for update
  `;
  const session = sessions[0];

  if (!session) {
    return "unmatched";
  }

  const normalizedStatus = toVerificationStatus(input.state);
  const lockKey = `user:${session.subject_id}:age_access`;
  await tx`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
  const currentRows = await tx<Array<{ status: AgeStatusRow["status"]; provider_event_at: Date | null }>>`
    select status, provider_event_at
    from verification_records
    where subject_type = 'user' and subject_id = ${session.subject_id}
      and purpose = 'age_access' and metadata ->> 'source' = 'provider_webhook'
    order by provider_event_at desc nulls last, created_at desc, id desc
    limit 1
    for update
  `;
  if (!shouldApplyAgeDecision(currentRows[0], input.verifiedAt ?? null, normalizedStatus)) {
    if (eventReceiptId) {
      await tx`
        update verification_events
        set session_id = ${session.id}, processing_status = 'ignored', processed_at = now()
        where id = ${eventReceiptId}
      `;
    }
    return "ignored";
  }
  const decisionAt = input.verifiedAt ?? new Date();
  await tx`
    update verification_sessions
    set
      status = ${toSessionStatus(input.state)},
      provider_external_user_id = coalesce(${input.providerSubjectReference ?? null}, provider_external_user_id),
      provider_session_id = case when ${input.provider} in ('yoti', 'veriff')
        then coalesce(provider_session_id, ${input.providerReference}) else provider_session_id end,
      provider_applicant_id = case when ${input.provider} = 'sumsub'
        then coalesce(provider_applicant_id, ${input.providerReference}) else provider_applicant_id end,
      provider_event_at = ${decisionAt},
      completed_at = case when ${input.state} = 'pending' then completed_at else coalesce(${input.verifiedAt ?? null}, now()) end,
      updated_at = now()
    where id = ${session.id}
  `;

  const records = await tx<{ id: string }[]>`
    insert into verification_records (
      subject_type, subject_id, purpose, status, provider, provider_reference,
      method, jurisdiction, threshold_age, result_over_threshold,
      assurance_level, verified_at, expires_at, reusable, failure_reason_code,
      provider_event_at, metadata
    )
    values (
      'user', ${session.subject_id}, 'age_access', ${normalizedStatus}, ${input.provider},
      ${input.providerReference}, ${session.requested_method}, ${session.jurisdiction}, 18,
      ${input.state === "verified"}, ${session.assurance_level},
      case when ${input.state} = 'verified' then coalesce(${input.verifiedAt ?? null}, now()) else null end,
      case when ${input.state} = 'pending'
        then ${session.expires_at}::timestamptz else null::timestamptz end,
      ${session.reusable}, ${input.failureCode ?? null}, ${decisionAt},
      ${tx.json({ source: "provider_webhook", providerEventId: input.providerEventId })}
    )
    returning id
  `;

  if (input.state === "verified") {
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
        purpose: "age_access",
        status: normalizedStatus
      })}
    )
  `;

  return "applied";
}

async function reconcilePendingAgeEvents(tx: PostgresTransaction, sessionId: string): Promise<void> {
  const sessions = await tx<Array<{
    provider: AgeProvider;
    provider_session_id: string | null;
    provider_applicant_id: string | null;
    provider_external_user_id: string | null;
  }>>`
    select provider, provider_session_id, provider_applicant_id, provider_external_user_id
    from verification_sessions where id = ${sessionId} limit 1
  `;
  const session = sessions[0];
  if (!session) return;
  const references = [session.provider_session_id, session.provider_applicant_id]
    .filter((value): value is string => Boolean(value));
  const events = await tx<Array<{
    id: string;
    idempotency_key: string | null;
    provider_reference: string | null;
    provider_subject_reference: string | null;
    decision_status: "pending" | "valid" | "invalid" | "blocked" | null;
    occurred_at: Date | null;
    failure_reason_code: string | null;
  }>>`
    select id, idempotency_key, provider_reference, provider_subject_reference,
           decision_status, occurred_at, failure_reason_code
    from verification_events
    where provider = ${session.provider}
      and processing_status in ('received', 'failed') and session_id is null
      and (
        provider_subject_reference = ${session.provider_external_user_id}
        or provider_reference in ${tx(references.length > 0 ? references : ["__none__"])}
      )
    order by occurred_at asc nulls first, received_at asc, id asc
    for update
  `;
  for (const event of events) {
    if (!event.provider_reference || !event.decision_status) continue;
    await applyAgeWebhookDecision(tx, {
      provider: session.provider,
      providerEventId: event.idempotency_key ?? `receipt:${event.id}`,
      providerReference: event.provider_reference,
      providerSubjectReference: event.provider_subject_reference,
      state: event.decision_status === "valid"
        ? "verified"
        : event.decision_status === "pending"
          ? "pending"
          : "failed",
      verifiedAt: event.occurred_at,
      failureCode: event.failure_reason_code
    }, event.id);
  }
}

function shouldApplyAgeDecision(
  current: { status: AgeStatusRow["status"]; provider_event_at: Date | null } | undefined,
  incomingAt: Date | null,
  incomingStatus: "pending" | "valid" | "blocked"
): boolean {
  if (!current) return true;
  const currentAt = current.provider_event_at?.getTime() ?? null;
  const nextAt = incomingAt?.getTime() ?? null;
  if (currentAt !== null && nextAt !== null) {
    if (nextAt < currentAt) return false;
    if (nextAt > currentAt) return true;
    return ageDecisionRank(incomingStatus) > ageDecisionRank(current.status);
  }
  if (nextAt === null) return incomingStatus === "blocked";
  return true;
}

function ageDecisionRank(status: AgeStatusRow["status"] | "pending" | "valid" | "blocked"): number {
  if (status === "blocked" || status === "invalid" || status === "revoked") return 3;
  if (status === "valid") return 2;
  return 1;
}

function toAgeState(status: NonNullable<AgeStatusRow["status"]>): AgeState {
  if (status === "valid") return "verified";
  if (status === "pending") return "pending";
  return "failed";
}

function toVerificationStatus(state: Extract<AgeState, "pending" | "verified" | "failed">) {
  if (state === "verified") return "valid";
  if (state === "failed") return "blocked";
  return "pending";
}

function toSessionStatus(state: Extract<AgeState, "pending" | "verified" | "failed">) {
  if (state === "verified") return "approved";
  if (state === "failed") return "declined";
  return "pending";
}

function ageMethod(provider: AgeProvider) {
  if (provider === "didit") return "age_estimation";
  if (provider === "yoti") return "reusable_age";
  if (provider === "persona") return "doc_scan";
  return "gov_id_selfie";
}

function ageAssurance(provider: AgeProvider) {
  return provider === "didit" || provider === "yoti" ? "medium" : "documentary";
}
