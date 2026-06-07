import { randomUUID } from "node:crypto";
import { resolvePostgresClient, type PostgresSql } from "../../shared/postgres.js";
import type { ActivityPage, ReferralRepository } from "./types.js";

export class ReferralRepositoryConfigurationError extends Error {
  constructor() {
    super("DATABASE_URL_NOT_CONFIGURED");
    this.name = "ReferralRepositoryConfigurationError";
  }
}

export class ReferralIdempotencyConflictError extends Error {
  constructor() {
    super("REFERRAL_IDEMPOTENCY_CONFLICT");
    this.name = "ReferralIdempotencyConflictError";
  }
}

interface ReferralTokenRow {
  token: string;
  url: string;
  eligibility: "external_share" | "partner_campaign" | "not_commissionable";
  request_hash: string;
}

interface ReferralActivityRow {
  id: string;
  token: string;
  target_type: string;
  target_id: string;
  eligibility: string;
  state: string;
  created_at: Date;
  commission_amount_minor: number | null;
  currency: "SOL" | "USDC" | null;
}

export function createPostgresReferralRepository(database?: string | PostgresSql): ReferralRepository {
  if (!database) {
    return {
      async createOrReuseToken() {
        throw new ReferralRepositoryConfigurationError();
      },
      async listActivity() {
        throw new ReferralRepositoryConfigurationError();
      }
    };
  }

  const { sql, ownsClient } = resolvePostgresClient(database);

  return {
    async createOrReuseToken(input) {
      const eligibility =
        input.channel === "external" || input.channel === "partner"
          ? input.channel === "partner"
            ? "partner_campaign"
            : "external_share"
          : "not_commissionable";
      const rows = await sql<ReferralTokenRow[]>`
        with target_user as (
          select id
          from users
          where supabase_user_id = ${input.supabaseUserId}
          limit 1
        ),
        existing_token as (
          select rt.*
          from referral_tokens rt
          join target_user tu on tu.id = rt.creator_user_id
          where rt.idempotency_key = ${input.idempotencyKey}
          limit 1
        ),
        inserted_token as (
          insert into referral_tokens (
            id,
            creator_user_id,
            token,
            target_type,
            target_id,
            channel,
            eligibility,
            idempotency_key,
            request_hash
          )
          select
            ${randomUUID()},
            id,
            ${input.token},
            ${input.targetType},
            ${input.targetId},
            ${input.channel},
            ${eligibility},
            ${input.idempotencyKey},
            ${input.requestHash}
          from target_user
          where not exists (select 1 from existing_token)
          returning *
        )
        select token, ${input.url} as url, eligibility, request_hash
        from inserted_token
        union all
        select token, ${input.url} as url, eligibility, request_hash
        from existing_token
        limit 1
      `;

      const row = rows[0];

      if (!row) {
        throw new ReferralRepositoryConfigurationError();
      }

      if (row.request_hash !== input.requestHash) {
        throw new ReferralIdempotencyConflictError();
      }

      return {
        token: row.token,
        url: row.url.replace(input.token, row.token),
        eligibility: row.eligibility
      };
    },
    async listActivity(input) {
      const rows = await sql<ReferralActivityRow[]>`
        select
          rt.id,
          rt.token,
          rt.target_type,
          rt.target_id,
          rt.eligibility,
          rt.state,
          rt.created_at,
          rc.amount_minor as commission_amount_minor,
          rc.currency
        from referral_tokens rt
        join users u on u.id = rt.creator_user_id
        left join referral_commissions rc on rc.referral_token_id = rt.id
        where u.supabase_user_id = ${input.supabaseUserId}
          and (${input.cursor ?? null}::timestamptz is null or rt.created_at < ${input.cursor ?? null}::timestamptz)
        order by rt.created_at desc
        limit ${input.limit + 1}
      `;
      const pageRows = rows.slice(0, input.limit);
      const nextRow = rows[input.limit];

      return {
        items: pageRows.map((row) => ({
          id: row.id,
          kind: "referral",
          title: "Referral share",
          state: row.state,
          createdAt: row.created_at.toISOString(),
          token: row.token,
          targetType: row.target_type,
          targetId: row.target_id,
          eligibility: row.eligibility,
          commissionAmountMinor: row.commission_amount_minor,
          ...(row.currency ? { currency: row.currency } : {})
        })),
        nextCursor: nextRow ? nextRow.created_at.toISOString() : null
      } satisfies ActivityPage;
    },
    async close() {
      if (ownsClient) {
        await sql.end({ timeout: 5 });
      }
    }
  };
}
