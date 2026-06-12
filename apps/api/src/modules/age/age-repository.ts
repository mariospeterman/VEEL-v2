import { randomUUID } from "node:crypto";
import { resolvePostgresClient, type PostgresSql } from "../../shared/postgres.js";
import type { AgeRepository, AgeStatus, AgeState } from "./types.js";

export class AgeRepositoryConfigurationError extends Error {
  constructor() {
    super("DATABASE_URL_NOT_CONFIGURED");
    this.name = "AgeRepositoryConfigurationError";
  }
}

interface AgeStatusRow {
  state: AgeState | null;
  provider: string | null;
}

const requiredAgeStatus: AgeStatus = {
  state: "required",
  provider: null
};

export function createPostgresAgeRepository(database?: string | PostgresSql): AgeRepository {
  if (!database) {
    return {
      async findLatestAgeStatusBySupabaseUserId() {
        throw new AgeRepositoryConfigurationError();
      },
      async createPendingAgeVerification() {
        throw new AgeRepositoryConfigurationError();
      },
      async recordProviderWebhook() {
        throw new AgeRepositoryConfigurationError();
      },
      async updateVerificationFromWebhook() {
        throw new AgeRepositoryConfigurationError();
      }
    };
  }

  const { sql, ownsClient } = resolvePostgresClient(database);

  return {
    async findLatestAgeStatusBySupabaseUserId(supabaseUserId: string): Promise<AgeStatus> {
      const rows = await sql<AgeStatusRow[]>`
        select
          av.state,
          av.provider
        from users u
        left join lateral (
          select state, provider
          from age_verifications
          where user_id = u.id
          order by created_at desc
          limit 1
        ) av on true
        where u.supabase_user_id = ${supabaseUserId}
        limit 1
      `;

      const row = rows[0];

      if (!row?.state) {
        return requiredAgeStatus;
      }

      return {
        state: row.state,
        provider: row.provider
      };
    },
    async createPendingAgeVerification(input): Promise<void> {
      await sql`
        with target_user as (
          select id
          from users
          where supabase_user_id = ${input.supabaseUserId}
          limit 1
        )
        insert into age_verifications (
          id,
          user_id,
          provider,
          provider_reference,
          state,
          jurisdiction,
          rule,
          expires_at
        )
        select
          ${randomUUID()},
          id,
          ${input.provider},
          ${input.providerReference},
          'pending',
          ${input.jurisdiction ?? null},
          ${input.rule ?? null},
          ${input.expiresAt}
        from target_user
      `;
    },
    async recordProviderWebhook(input): Promise<boolean> {
      const receiptRows = await sql<{ id: string }[]>`
        insert into provider_webhook_receipts (
          id,
          provider,
          webhook_type,
          signature_hash,
          idempotency_key
        )
        values (
          ${randomUUID()},
          ${input.provider},
          'age-verification',
          ${input.signatureHash},
          ${input.providerEventId}
        )
        on conflict (provider, webhook_type, idempotency_key) do nothing
        returning id
      `;

      if (receiptRows.length === 0) {
        return false;
      }

      await sql`
        insert into provider_events (
          id,
          provider,
          provider_event_id,
          event_type,
          normalized_state
        )
        values (
          ${randomUUID()},
          ${input.provider},
          ${input.providerEventId},
          ${input.eventType},
          ${input.normalizedState}
        )
        on conflict (provider, provider_event_id) do nothing
      `;

      return true;
    },
    async updateVerificationFromWebhook(input): Promise<boolean> {
      const rows = await sql<{ id: string }[]>`
        update age_verifications
        set
          state = ${input.state}::age_state,
          verified_at = case
            when ${input.state}::age_state = 'verified'::age_state then coalesce(verified_at, ${input.verifiedAt ?? null}, now())
            else verified_at
          end
        where provider = ${input.provider}
          and provider_reference = ${input.providerReference}
          and state in ('pending', 'failed', 'verified')
        returning id
      `;

      await sql`
        update provider_events
        set
          normalized_state = ${rows.length > 0 ? input.state : "ignored"},
          processed_at = now()
        where provider = ${input.provider}
          and provider_event_id = ${input.providerEventId}
      `;

      await sql`
        update provider_webhook_receipts
        set
          state = ${rows.length > 0 ? input.state : "ignored"},
          processed_at = now()
        where provider = ${input.provider}
          and webhook_type = 'age-verification'
          and idempotency_key = ${input.providerEventId}
      `;

      if (rows.length > 0) {
        await sql`
          insert into audit_events (
            id,
            actor_user_id,
            subject_type,
            subject_id,
            action,
            metadata
          )
          select
            ${randomUUID()},
            null,
            'age_verification',
            av.id,
            'age.webhook_applied',
            jsonb_build_object(
              'provider', ${input.provider}::text,
              'providerEventId', ${input.providerEventId}::text,
              'state', ${input.state}::text,
              'failureCode', ${input.failureCode ?? null}::text
            )
          from age_verifications av
          where av.provider = ${input.provider}
            and av.provider_reference = ${input.providerReference}
          limit 1
        `;
      }

      return rows.length > 0;
    },
    async close() {
      if (ownsClient) {
        await sql.end({ timeout: 5 });
      }
    }
  };
}
