import { randomUUID } from "node:crypto";
import {
  decodeTimestampKindIdCursor,
  encodeTimestampKindIdCursor,
  keysetPage
} from "../../shared/keyset-pagination.js";
import { resolvePostgresClient, type PostgresSql } from "../../shared/postgres.js";
import type { ReferralActivityPage, ReferralRepository } from "./types.js";

const referralActivityCursorScope = "GET /v1/referrals/activity";
const referralActivityKinds = ["share", "commission"] as const;

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
  activity_type: "share" | "commission";
  token: string;
  target_type: "content" | "profile" | "event";
  target_id: string;
  eligibility: "external_share" | "partner_campaign" | "not_commissionable";
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
      const cursor = decodeTimestampKindIdCursor(
        referralActivityCursorScope,
        input.cursor,
        referralActivityKinds
      );
      const rows = await sql<ReferralActivityRow[]>`
        with target_user as (
          select id
          from users
          where supabase_user_id = ${input.supabaseUserId}
          limit 1
        ),
        referral_activity as (
          select
            rt.id,
            'share'::text as activity_type,
            rt.token,
            rt.target_type,
            rt.target_id,
            rt.eligibility,
            rt.state,
            rt.created_at,
            null::bigint as commission_amount_minor,
            null::text as currency
          from referral_tokens rt
          join target_user tu on tu.id = rt.creator_user_id

          union all

          select
            rc.id,
            'commission'::text as activity_type,
            rt.token,
            rt.target_type,
            rt.target_id,
            rt.eligibility,
            rc.state,
            rc.created_at,
            rc.amount_minor as commission_amount_minor,
            rc.currency
          from referral_commissions rc
          join referral_tokens rt on rt.id = rc.referral_token_id
          join target_user tu on tu.id = rt.creator_user_id
        )
        select
          activity.id,
          activity.activity_type,
          activity.token,
          activity.target_type,
          activity.target_id,
          activity.eligibility,
          activity.state,
          activity.created_at,
          activity.commission_amount_minor,
          activity.currency
        from referral_activity activity
        where (
            ${cursor.timestamp}::timestamptz is null
            or activity.created_at < ${cursor.timestamp}::timestamptz
            or (
              activity.created_at = ${cursor.timestamp}::timestamptz
              and (
                ${cursor.kind}::text is null
                or activity.activity_type < ${cursor.kind}::text
                or (
                  activity.activity_type = ${cursor.kind}::text
                  and (${cursor.id}::uuid is null or activity.id < ${cursor.id}::uuid)
                )
              )
            )
          )
        order by activity.created_at desc, activity.activity_type desc, activity.id desc
        limit ${input.limit + 1}
      `;

      return keysetPage(
        rows,
        input.limit,
        (row) => ({
          id: row.id,
          activityType: row.activity_type,
          state: row.state,
          createdAt: row.created_at.toISOString(),
          token: row.token,
          targetType: row.target_type,
          targetId: row.target_id,
          eligibility: row.eligibility,
          commissionAmountMinor: row.commission_amount_minor,
          ...(row.currency ? { currency: row.currency } : {})
        }),
        (row) => encodeTimestampKindIdCursor(
          referralActivityCursorScope,
          row.created_at,
          row.activity_type,
          row.id
        )
      ) satisfies ReferralActivityPage;
    },
    async close() {
      if (ownsClient) {
        await sql.end({ timeout: 5 });
      }
    }
  };
}
