import { randomUUID } from "node:crypto";
import postgres from "postgres";
import type { PaymentRepository } from "./types.js";
export { createPostgresPaymentEvidenceRepository } from "./payment-evidence-repository.js";
import { PaymentIdempotencyConflictError, PaymentRepositoryConfigurationError } from "./payment-repository-errors.js";
export { PaymentIdempotencyConflictError, PaymentRepositoryConfigurationError } from "./payment-repository-errors.js";
import { PaymentIntentRow, toStoredPaymentIntent } from "./payment-intent-mapper.js";
import { recordPaymentSubmission } from "./payment-submission.js";

export function createPostgresPaymentRepository(databaseUrl?: string): PaymentRepository {
  if (!databaseUrl) {
    return {
      async createOrReuseIntent() {
        throw new PaymentRepositoryConfigurationError();
      },
      async findIntent() {
        throw new PaymentRepositoryConfigurationError();
      },
      async recordTransactionRequest() {
        throw new PaymentRepositoryConfigurationError();
      },
      async recordSubmission() {
        throw new PaymentRepositoryConfigurationError();
      }
    };
  }

  const sql = postgres(databaseUrl, {
    max: 5,
    idle_timeout: 20,
    prepare: false
  });

  return {
    async createOrReuseIntent(input) {
      const rows = await sql<PaymentIntentRow[]>`
        with target_user as (
          select id
          from users
          where supabase_user_id = ${input.supabaseUserId}
          limit 1
        ),
        referral_candidate as (
          select rt.id, rt.creator_user_id
          from referral_tokens rt
          where rt.token = ${input.referralToken ?? null}
            and rt.state = 'active'
            and rt.eligibility in ('external_share', 'partner_campaign')
            and (rt.expires_at is null or rt.expires_at > now())
          limit 1
        ),
        valid_referral as (
          select rc.id, rc.creator_user_id
          from referral_candidate rc
          join target_user tu on true
          where rc.creator_user_id <> tu.id
        ),
        existing_intent as (
          select pi.*
          from payment_intents pi
          join target_user tu on tu.id = pi.user_id
          where pi.idempotency_key = ${input.idempotencyKey}
          limit 1
        ),
        inserted_intent as (
          insert into payment_intents (
            id,
            user_id,
            product_type,
            target_id,
            amount_minor,
            currency,
            idempotency_key,
            request_hash,
            solana_cluster,
            treasury_wallet,
            reference_address,
            referral_token_id,
            expires_at
          )
          select
            ${randomUUID()},
            id,
            ${input.productType},
            ${input.targetId},
            ${input.amountMinor},
            ${input.currency},
            ${input.idempotencyKey},
            ${input.requestHash},
            ${input.solanaCluster},
            ${input.treasuryWallet},
            ${input.referenceAddress},
            (select id from valid_referral),
            ${input.expiresAt}
          from target_user
          where not exists (select 1 from existing_intent)
          returning *
        ),
        inserted_attribution as (
          insert into referral_attributions (
            id,
            referral_token_id,
            referrer_user_id,
            referred_user_id,
            payment_intent_id
          )
          select
            ${randomUUID()},
            vr.id,
            vr.creator_user_id,
            tu.id,
            ii.id
          from inserted_intent ii
          join valid_referral vr on true
          join target_user tu on true
          on conflict (payment_intent_id) do nothing
          returning id
        )
        select
          id,
          product_type,
          target_id,
          amount_minor,
          currency,
          state,
          reference_address,
          treasury_wallet,
          solana_cluster,
          expires_at,
          request_hash
        from inserted_intent
        union all
        select
          id,
          product_type,
          target_id,
          amount_minor,
          currency,
          state,
          reference_address,
          treasury_wallet,
          solana_cluster,
          expires_at,
          request_hash
        from existing_intent
        limit 1
      `;

      const row = rows[0];

      if (!row) {
        throw new PaymentRepositoryConfigurationError();
      }

      if (row.request_hash !== input.requestHash) {
        throw new PaymentIdempotencyConflictError();
      }

      return toStoredPaymentIntent(row);
    },
    async findIntent(input) {
      const rows = await sql<PaymentIntentRow[]>`
        select
          pi.id,
          pi.product_type,
          pi.target_id,
          pi.amount_minor,
          pi.currency,
          pi.state,
          pi.reference_address,
          pi.treasury_wallet,
          pi.solana_cluster,
          pi.expires_at,
          pi.request_hash
        from payment_intents pi
        join users u on u.id = pi.user_id
        where pi.id = ${input.paymentIntentId}
          and u.supabase_user_id = ${input.supabaseUserId}
        limit 1
      `;

      const row = rows[0];

      return row ? toStoredPaymentIntent(row) : null;
    },
    async recordTransactionRequest(input) {
      const rows = await sql<{ expires_at: Date }[]>`
        update payment_intents pi
        set
          state = case when state = 'pending' then 'transaction_requested' else state end,
          transaction_request_url = ${input.transactionRequestUrl},
          transaction_requested_at = now(),
          updated_at = now()
        from users u
        where pi.user_id = u.id
          and u.supabase_user_id = ${input.supabaseUserId}
          and pi.id = ${input.paymentIntentId}
          and pi.state in ('pending', 'transaction_requested', 'submitted')
        returning pi.expires_at
      `;

      const row = rows[0];

      return row
        ? {
            transactionRequestUrl: input.transactionRequestUrl,
            expiresAt: row.expires_at.toISOString()
          }
        : null;
    },
    async recordSubmission(input) {
      await recordPaymentSubmission(sql, input);
    },
    async close() {
      await sql.end({ timeout: 5 });
    }
  };
}
