import { randomUUID } from "node:crypto";
import { resolvePostgresClient, type PostgresSql } from "../../shared/postgres.js";
import type { PaymentRepository } from "./types.js";
export { createPostgresPaymentEvidenceRepository } from "./payment-evidence-repository.js";
import {
  isRecipientMonetisationPolicyError,
  PaymentIdempotencyConflictError,
  PaymentRecipientNotReadyError,
  PaymentRepositoryConfigurationError
} from "./payment-repository-errors.js";
export {
  PaymentIdempotencyConflictError,
  PaymentRecipientNotReadyError,
  PaymentRepositoryConfigurationError
} from "./payment-repository-errors.js";
import { PaymentIntentRow, toStoredPaymentIntent } from "./payment-intent-mapper.js";
import { recordPaymentSubmission } from "./payment-submission.js";
import { calculateCreatorSplit } from "./payment-amounts.js";

export function createPostgresPaymentRepository(database?: string | PostgresSql): PaymentRepository {
  if (!database) {
    return {
      async createOrReuseIntent() {
        throw new PaymentRepositoryConfigurationError();
      },
      async findIntent() {
        throw new PaymentRepositoryConfigurationError();
      },
      async findCheckoutIntent() {
        throw new PaymentRepositoryConfigurationError();
      },
      async recordTransactionRequest() {
        throw new PaymentRepositoryConfigurationError();
      },
      async recordCheckoutPayer() {
        throw new PaymentRepositoryConfigurationError();
      },
      async recordSubmission() {
        throw new PaymentRepositoryConfigurationError();
      }
    };
  }

  const { sql, ownsClient } = resolvePostgresClient(database);

  return {
    async createOrReuseIntent(input) {
      const splitWithoutReferral = calculateCreatorSplit({
        totalAmountAtomic: input.amountMinor,
        platformFeeBps: input.platformFeeBps
      });
      const splitWithReferral = calculateCreatorSplit({
        totalAmountAtomic: input.amountMinor,
        platformFeeBps: input.platformFeeBps,
        referralShareOfPlatformFeeBps: input.referralShareOfPlatformFeeBps
      });
      const referralAllocationIsPayable = splitWithReferral.allocationAmountAtomic > 0;
      let rows: PaymentIntentRow[];
      try {
        rows = await sql<PaymentIntentRow[]>`
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
        referral_wallet as (
          select vr.id, vr.creator_user_id, w.address
          from valid_referral vr
          join lateral (
            select address
            from wallets
            where user_id = vr.creator_user_id
              and chain = case
                when ${input.solanaCluster} = 'mainnet-beta' then 'solana_mainnet'::wallet_chain
                else 'solana_devnet'::wallet_chain
              end
            order by is_primary desc, created_at asc
            limit 1
          ) w on true
          where ${referralAllocationIsPayable}
          limit 1
        ),
        creator_candidate as (
          select ${input.creatorUserId ?? null}::uuid as id
          where ${input.creatorUserId ?? null}::uuid is not null
          union all
          select ${input.targetId}::uuid
          where ${input.productType} in ('tip', 'support')
          union all
          select ci.creator_user_id
          from content_items ci
          where ${input.productType} = 'content_unlock'
            and ci.id = ${input.targetId}
          union all
          select lr.creator_user_id
          from live_rooms lr
          where ${input.productType} = 'live_pass'
            and lr.id = ${input.targetId}
          union all
          select e.creator_user_id
          from events e
          where ${input.productType} = 'event_access_pass'
            and e.id = ${input.targetId}
          limit 1
        ),
        creator_wallet as (
          select readiness.address
          from creator_candidate cc
          cross join lateral private.assert_recipient_monetisation_ready(
            cc.id,
            ${input.productType},
            case
              when ${input.solanaCluster} = 'mainnet-beta' then 'solana_mainnet'::wallet_chain
              else 'solana_devnet'::wallet_chain
            end,
            null
          ) readiness
          limit 1
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
            token_mint,
            token_decimals,
            idempotency_key,
            request_hash,
            solana_cluster,
            treasury_wallet,
            settlement_kind,
            creator_wallet,
            platform_fee_wallet,
            allocation_wallet,
            total_amount_minor,
            creator_amount_minor,
            platform_fee_amount_minor,
            allocation_amount_minor,
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
            ${input.tokenMint ?? null},
            ${input.tokenDecimals ?? null},
            ${input.idempotencyKey},
            ${input.requestHash},
            ${input.solanaCluster},
            ${input.treasuryWallet},
            ${input.settlementKind},
            (select address from creator_wallet),
            ${input.platformFeeWallet},
            (select address from referral_wallet),
            ${splitWithoutReferral.totalAmountAtomic},
            ${splitWithoutReferral.creatorAmountAtomic},
            case
              when exists (select 1 from referral_wallet) then ${splitWithReferral.platformFeeAmountAtomic}::bigint
              else ${splitWithoutReferral.platformFeeAmountAtomic}::bigint
            end::bigint,
            case
              when exists (select 1 from referral_wallet) then ${splitWithReferral.allocationAmountAtomic}::bigint
              else 0::bigint
            end::bigint,
            ${input.referenceAddress},
            (select id from referral_wallet),
            ${input.expiresAt}
          from target_user
          join creator_wallet on true
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
          join referral_wallet vr on true
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
          token_mint,
          token_decimals,
          state,
          reference_address,
          treasury_wallet,
          settlement_kind,
          buyer_wallet,
          creator_wallet,
          platform_fee_wallet,
          allocation_wallet,
          total_amount_minor,
          creator_amount_minor,
          platform_fee_amount_minor,
          allocation_amount_minor,
          solana_cluster,
          expires_at,
          request_hash,
          withdrawal_waiver_required,
          withdrawal_waiver_accepted_at,
          withdrawal_waiver_version,
          terms_version,
          durable_confirmation_required,
          refund_value_basis
        from inserted_intent
        union all
        select
          id,
          product_type,
          target_id,
          amount_minor,
          currency,
          token_mint,
          token_decimals,
          state,
          reference_address,
          treasury_wallet,
          settlement_kind,
          buyer_wallet,
          creator_wallet,
          platform_fee_wallet,
          allocation_wallet,
          total_amount_minor,
          creator_amount_minor,
          platform_fee_amount_minor,
          allocation_amount_minor,
          solana_cluster,
          expires_at,
          request_hash,
          withdrawal_waiver_required,
          withdrawal_waiver_accepted_at,
          withdrawal_waiver_version,
          terms_version,
          durable_confirmation_required,
          refund_value_basis
        from existing_intent
        cross join creator_wallet
        limit 1
        `;
      } catch (error) {
        if (isRecipientMonetisationPolicyError(error)) {
          throw new PaymentRecipientNotReadyError(error.message);
        }
        throw error;
      }

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
          pi.token_mint,
          pi.token_decimals,
          pi.state,
          pi.reference_address,
          pi.treasury_wallet,
          pi.settlement_kind,
          pi.buyer_wallet,
          pi.creator_wallet,
          pi.platform_fee_wallet,
          pi.allocation_wallet,
          pi.total_amount_minor,
          pi.creator_amount_minor,
          pi.platform_fee_amount_minor,
          pi.allocation_amount_minor,
          pi.solana_cluster,
          pi.expires_at,
          pi.request_hash,
          pi.withdrawal_waiver_required,
          pi.withdrawal_waiver_accepted_at,
          pi.withdrawal_waiver_version,
          pi.terms_version,
          pi.durable_confirmation_required,
          pi.refund_value_basis
        from payment_intents pi
        join users u on u.id = pi.user_id
        where pi.id = ${input.paymentIntentId}
          and u.supabase_user_id = ${input.supabaseUserId}
        limit 1
      `;

      const row = rows[0];

      return row ? toStoredPaymentIntent(row) : null;
    },
    async findCheckoutIntent(input) {
      const rows = await sql<PaymentIntentRow[]>`
        select pi.*
        from payment_intents pi
        where pi.checkout_token_hash = ${input.checkoutTokenHash}
          and pi.expires_at > now()
          and pi.state in ('pending', 'transaction_requested', 'submitted')
        limit 1
      `;

      return rows[0] ? toStoredPaymentIntent(rows[0]) : null;
    },
    async recordTransactionRequest(input) {
      const rows = await sql<{ expires_at: Date }[]>`
        update payment_intents pi
        set
          state = case when state = 'pending' then 'transaction_requested' else state end,
          transaction_request_url = ${input.storedTransactionRequestUrl},
          checkout_token_hash = ${input.checkoutTokenHash},
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
            transactionRequestUrl: input.publicTransactionRequestUrl,
            expiresAt: row.expires_at.toISOString()
          }
        : null;
    },
    async recordCheckoutPayer(input) {
      const rows = await sql<PaymentIntentRow[]>`
        update payment_intents pi
        set
          buyer_wallet = ${input.buyerWallet},
          updated_at = now()
        where pi.checkout_token_hash = ${input.checkoutTokenHash}
          and pi.expires_at > now()
          and pi.state in ('pending', 'transaction_requested', 'submitted')
          and (pi.buyer_wallet is null or pi.buyer_wallet = ${input.buyerWallet})
        returning pi.*
      `;

      return rows[0] ? toStoredPaymentIntent(rows[0]) : null;
    },
    async recordSubmission(input) {
      await recordPaymentSubmission(sql, input);
    },
    async close() {
      if (ownsClient) {
        await sql.end({ timeout: 5 });
      }
    }
  };
}
