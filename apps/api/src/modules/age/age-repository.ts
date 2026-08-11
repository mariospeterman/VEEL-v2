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

const requiredAgeStatus: AgeStatus = { state: "required", provider: null };

export function createPostgresAgeRepository(database?: string | PostgresSql): AgeRepository {
  if (!database) return unavailableAgeRepository();

  const { sql, ownsClient } = resolvePostgresClient(database);

  return {
    async findLatestAgeStatusBySupabaseUserId(supabaseUserId) {
      const rows = await sql<AgeStatusRow[]>`
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
          order by created_at desc, id desc
          limit 1
        ) vr on true
        where u.supabase_user_id = ${supabaseUserId}
        limit 1
      `;
      const row = rows[0];

      if (!row?.status) return requiredAgeStatus;
      return { state: toAgeState(row.status), provider: row.provider };
    },

    async createPendingAgeVerification(input) {
      await sql.begin(async (tx) => {
        const users = await tx<{ id: string }[]>`
          select id from users where supabase_user_id = ${input.supabaseUserId} limit 1
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
            ${input.providerReference},
            ${method},
            'pending',
            ${input.jurisdiction ?? null},
            18,
            ${assurance},
            ${input.provider === "didit" || input.provider === "yoti"},
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
            ${input.provider === "didit" || input.provider === "yoti"},
            ${tx.json({ source: "age_session", rule: input.rule ?? "over_18" })}
          )
        `;
      });
    },

    async applyProviderWebhook(input) {
      const payloadHash =
        input.signatureHash ??
        createHash("sha256")
          .update(`${input.provider}:${input.providerEventId}:${input.eventType}`)
          .digest("hex");
      return sql.begin(async (tx) => {
        const rows = await tx<{ id: string }[]>`
          insert into verification_events (
            provider,
            event_type,
            idempotency_key,
            payload_hash,
            processing_status
          )
          values (
            ${input.provider},
            ${input.eventType},
            ${input.providerEventId},
            ${payloadHash},
            'received'
          )
          on conflict do nothing
          returning id
        `;

        if (rows.length === 0) return "duplicate" as const;
        const applied = await applyAgeWebhookDecision(tx, input, true);
        return applied ? "applied" as const : "unmatched" as const;
      });
    },

    async updateVerificationFromWebhook(input) {
      return sql.begin((tx) => applyAgeWebhookDecision(tx, input, false));
    },

    async close() {
      if (ownsClient) await sql.end({ timeout: 5 });
    }
  };
}

function unavailableAgeRepository(): AgeRepository {
  return {
    async findLatestAgeStatusBySupabaseUserId() {
      throw new AgeRepositoryConfigurationError();
    },
    async createPendingAgeVerification() {
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

async function applyAgeWebhookDecision(
  tx: PostgresTransaction,
  input: UpdateAgeVerificationFromWebhookInput,
  trackEvent: boolean
): Promise<boolean> {
  const sessions = await tx<
    Array<{
      id: string;
      subject_id: string;
      requested_method: string;
      assurance_level: string;
      jurisdiction: string | null;
      expires_at: Date | null;
      reusable: boolean;
    }>
  >`
    select
      id,
      subject_id,
      requested_method,
      assurance_level,
      jurisdiction,
      expires_at,
      reusable
    from verification_sessions
    where subject_type = 'user'
      and purpose = 'age_access'
      and provider = ${input.provider}
      and provider_session_id = ${input.providerReference}
    order by created_at desc
    limit 1
    for update
  `;
  const session = sessions[0];

  if (!session) {
    if (trackEvent) {
      await tx`
        update verification_events
        set processing_status = 'ignored', processed_at = now()
        where provider = ${input.provider}
          and idempotency_key = ${input.providerEventId}
      `;
    }
    return false;
  }

  const normalizedStatus = toVerificationStatus(input.state);
  await tx`
    update verification_sessions
    set
      status = ${toSessionStatus(input.state)},
      completed_at = case when ${input.state} = 'pending' then completed_at else coalesce(${input.verifiedAt ?? null}, now()) end,
      updated_at = now()
    where id = ${session.id}
  `;

  const records = await tx<{ id: string }[]>`
    insert into verification_records (
      subject_type, subject_id, purpose, status, provider, provider_reference,
      method, jurisdiction, threshold_age, result_over_threshold,
      assurance_level, verified_at, expires_at, reusable, failure_reason_code, metadata
    )
    values (
      'user', ${session.subject_id}, 'age_access', ${normalizedStatus}, ${input.provider},
      ${input.providerReference}, ${session.requested_method}, ${session.jurisdiction}, 18,
      ${input.state === "verified"}, ${session.assurance_level},
      case when ${input.state} = 'verified' then coalesce(${input.verifiedAt ?? null}, now()) else null end,
      ${session.expires_at}, ${session.reusable}, ${input.failureCode ?? null},
      ${tx.json({ source: "age_webhook", providerEventId: input.providerEventId })}
    )
    returning id
  `;

  if (trackEvent) {
    await tx`
      update verification_events
      set session_id = ${session.id}, processing_status = 'processed', processed_at = now()
      where provider = ${input.provider}
        and idempotency_key = ${input.providerEventId}
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

  return true;
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
  if (provider === "didit" || provider === "yoti") return "reusable_age";
  if (provider === "persona") return "doc_scan";
  return "gov_id_selfie";
}

function ageAssurance(provider: AgeProvider) {
  return provider === "didit" || provider === "yoti" ? "medium" : "documentary";
}
