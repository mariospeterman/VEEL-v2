import {
  resolvePostgresClient,
  type PostgresSql,
  withPostgresTransaction
} from "../../shared/postgres.js";
import type {
  AdminPaymentCommercialPolicy,
  PaymentCommercialPolicyRepository
} from "./types.js";

interface PaymentCommercialPolicyRow {
  id: string;
  product_type: AdminPaymentCommercialPolicy["productType"];
  currency: AdminPaymentCommercialPolicy["currency"];
  minimum_amount_minor: number;
  platform_fee_bps: number;
  referral_share_of_platform_fee_bps: number;
  quote_ttl_seconds: number;
  state: AdminPaymentCommercialPolicy["state"];
  revision: number;
  reason: string;
  updated_at: Date;
}

export class PaymentCommercialPolicyRepositoryConfigurationError extends Error {
  constructor() {
    super("PAYMENT_COMMERCIAL_POLICY_REPOSITORY_NOT_CONFIGURED");
    this.name = "PaymentCommercialPolicyRepositoryConfigurationError";
  }
}

export class PaymentCommercialPolicyIdempotencyConflictError extends Error {
  constructor() {
    super("PAYMENT_COMMERCIAL_POLICY_IDEMPOTENCY_CONFLICT");
    this.name = "PaymentCommercialPolicyIdempotencyConflictError";
  }
}

export function createPostgresPaymentCommercialPolicyRepository(
  database?: string | PostgresSql
): PaymentCommercialPolicyRepository {
  if (!database) {
    return {
      async listOverrides() {
        throw new PaymentCommercialPolicyRepositoryConfigurationError();
      },
      async updateOverride() {
        throw new PaymentCommercialPolicyRepositoryConfigurationError();
      }
    };
  }

  const { sql, ownsClient } = resolvePostgresClient(database);
  return {
    async listOverrides() {
      const rows = await sql<PaymentCommercialPolicyRow[]>`
        select
          id,
          product_type,
          currency,
          minimum_amount_minor,
          platform_fee_bps,
          referral_share_of_platform_fee_bps,
          quote_ttl_seconds,
          state,
          revision,
          reason,
          updated_at
        from payment_commercial_policy_overrides
        order by product_type asc, currency asc
      `;
      return { items: rows.map(toPaymentCommercialPolicy) };
    },
    async updateOverride(input) {
      return withPostgresTransaction(sql, async (transaction) => {
        const actorRows = await transaction<{ id: string }[]>`
          select id
          from users
          where supabase_user_id = ${input.supabaseUserId}
            and state = 'active'
          limit 1
        `;
        const actor = actorRows[0];
        if (!actor) throw new PaymentCommercialPolicyRepositoryConfigurationError();

        await transaction`select pg_advisory_xact_lock(hashtextextended(${actor.id}, 0))`;
        const storedKey = `admin:payment-commercial-policy:${actor.id}:${input.idempotencyKey}`;
        await transaction`
          insert into idempotency_keys (
            key, actor_user_id, scope, request_hash, expires_at
          ) values (
            ${storedKey}, ${actor.id}, 'admin.payment_commercial_policy.update',
            ${input.requestHash}, 'infinity'::timestamptz
          )
          on conflict (key) do nothing
        `;

        const receiptRows = await transaction<{
          request_hash: string;
          response_body: { policy?: AdminPaymentCommercialPolicy } | null;
        }[]>`
          select request_hash, response_body
          from idempotency_keys
          where key = ${storedKey}
          for update
        `;
        const receipt = receiptRows[0];
        if (!receipt || receipt.request_hash !== input.requestHash) {
          throw new PaymentCommercialPolicyIdempotencyConflictError();
        }

        if (receipt.response_body?.policy) {
          return receipt.response_body.policy;
        }

        const previousRows = await transaction<PaymentCommercialPolicyRow[]>`
          select
            id, product_type, currency, minimum_amount_minor, platform_fee_bps,
            referral_share_of_platform_fee_bps, quote_ttl_seconds, state,
            revision, reason, updated_at
          from payment_commercial_policy_overrides
          where product_type = ${input.productType}
            and currency = ${input.currency}
          for update
        `;
        const previous = previousRows[0] ?? null;

        const updatedRows = await transaction<PaymentCommercialPolicyRow[]>`
          insert into payment_commercial_policy_overrides (
            product_type, currency, minimum_amount_minor, platform_fee_bps,
            referral_share_of_platform_fee_bps, quote_ttl_seconds, state,
            revision, reason, updated_by_user_id
          ) values (
            ${input.productType}, ${input.currency}, ${input.body.minimumAmountMinor},
            ${input.body.platformFeeBps}, ${input.body.referralShareOfPlatformFeeBps},
            ${input.body.quoteTtlSeconds}, ${input.body.state}, 1,
            ${input.body.reason}, ${actor.id}
          )
          on conflict (product_type, currency) do update set
            minimum_amount_minor = excluded.minimum_amount_minor,
            platform_fee_bps = excluded.platform_fee_bps,
            referral_share_of_platform_fee_bps = excluded.referral_share_of_platform_fee_bps,
            quote_ttl_seconds = excluded.quote_ttl_seconds,
            state = excluded.state,
            revision = payment_commercial_policy_overrides.revision + 1,
            reason = excluded.reason,
            updated_by_user_id = excluded.updated_by_user_id,
            updated_at = now()
          returning
            id, product_type, currency, minimum_amount_minor, platform_fee_bps,
            referral_share_of_platform_fee_bps, quote_ttl_seconds, state,
            revision, reason, updated_at
        `;
        const updated = updatedRows[0];
        if (!updated) throw new PaymentCommercialPolicyRepositoryConfigurationError();
        const policy = toPaymentCommercialPolicy(updated);

        await transaction`
          insert into audit_events (
            id, actor_user_id, subject_type, subject_id, action, metadata, idempotency_key
          ) values (
            gen_random_uuid(),
            ${actor.id},
            'payment_commercial_policy',
            ${updated.id},
            'payment_commercial_policy_updated',
            ${transaction.json({
              productType: updated.product_type,
              currency: updated.currency,
              reason: input.body.reason,
              previous: previous ? policyAuditSnapshot(previous) : null,
              current: policyAuditSnapshot(updated)
            })},
            ${input.idempotencyKey}
          )
        `;

        await transaction`
          update idempotency_keys
          set response_status = 200,
              response_body = ${transaction.json({ policy })}::jsonb
          where key = ${storedKey}
        `;

        return policy;
      });
    },
    async close() {
      if (ownsClient) await sql.end({ timeout: 5 });
    }
  };
}

function toPaymentCommercialPolicy(row: PaymentCommercialPolicyRow): AdminPaymentCommercialPolicy {
  return {
    id: row.id,
    productType: row.product_type,
    currency: row.currency,
    minimumAmountMinor: Number(row.minimum_amount_minor),
    platformFeeBps: row.platform_fee_bps,
    referralShareOfPlatformFeeBps: row.referral_share_of_platform_fee_bps,
    quoteTtlSeconds: row.quote_ttl_seconds,
    state: row.state,
    revision: row.revision,
    reason: row.reason,
    updatedAt: row.updated_at.toISOString()
  };
}

function policyAuditSnapshot(row: PaymentCommercialPolicyRow) {
  return {
    minimumAmountMinor: Number(row.minimum_amount_minor),
    platformFeeBps: row.platform_fee_bps,
    referralShareOfPlatformFeeBps: row.referral_share_of_platform_fee_bps,
    quoteTtlSeconds: row.quote_ttl_seconds,
    state: row.state,
    revision: row.revision
  };
}
