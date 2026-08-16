import { randomUUID } from "node:crypto";
import { resolvePostgresClient, type PostgresSql } from "../../shared/postgres.js";
import type { PaymentRepository } from "./types.js";
export { createPostgresPaymentEvidenceRepository } from "./payment-evidence-repository.js";
import {
  isRecipientMonetisationPolicyError,
  PaymentIdempotencyConflictError,
  PaymentConsentConflictError,
  PaymentRecipientNotReadyError,
  PaymentRepositoryConfigurationError
} from "./payment-repository-errors.js";
export {
  PaymentIdempotencyConflictError,
  PaymentConsentConflictError,
  PaymentRecipientNotReadyError,
  PaymentRepositoryConfigurationError
} from "./payment-repository-errors.js";
import { PaymentIntentRow, toStoredPaymentIntent } from "./payment-intent-mapper.js";
import { recordPaymentSubmission } from "./payment-submission.js";
import { calculateSettlementSplit } from "./payment-amounts.js";

interface SettlementAuthorityRow {
  buyer_user_id: string;
  creator_user_id: string;
  creator_wallet: string;
  referral_token_id: string | null;
  referrer_user_id: string | null;
  referral_wallet: string | null;
  managed_creator_relationship_id: string | null;
  managed_creator_agreement_id: string | null;
  enterprise_organization_id: string | null;
  enterprise_wallet: string | null;
  enterprise_management_share_bps: number | null;
}

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
      async acceptCheckoutTerms() {
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
      let rows: PaymentIntentRow[];
      try {
        rows = await sql.begin(async (transaction) => {
          const existing = await transaction<PaymentIntentRow[]>`
            select pi.*
            from payment_intents pi
            join users u on u.id = pi.user_id
            where u.supabase_user_id = ${input.supabaseUserId}
              and pi.idempotency_key = ${input.idempotencyKey}
            limit 1
          `;

          if (existing[0]) {
            if (existing[0].request_hash !== input.requestHash) {
              return existing;
            }
            const readinessRows = await transaction<{ wallet_id: string }[]>`
              with creator_candidate as (
                select ${input.creatorUserId ?? null}::uuid as id
                where ${input.creatorUserId ?? null}::uuid is not null
                union all
                select ${input.targetId}::uuid
                where ${input.productType} = 'support'
                union all
                select ci.creator_user_id
                from content_items ci
                where ${input.productType} = 'content_unlock' and ci.id = ${input.targetId}
                union all
                select lr.creator_user_id
                from live_rooms lr
                where ${input.productType} = 'live_pass' and lr.id = ${input.targetId}
                union all
                select e.creator_user_id
                from events e
                where ${input.productType} = 'event_access_pass' and e.id = ${input.targetId}
                limit 1
              )
              select readiness.wallet_id
              from creator_candidate creator
              cross join lateral private.assert_recipient_monetisation_ready(
                creator.id,
                ${input.productType},
                case
                  when ${input.solanaCluster} = 'mainnet-beta' then 'solana_mainnet'::wallet_chain
                  else 'solana_devnet'::wallet_chain
                end,
                null
              ) readiness
              limit 1
            `;
            if (!readinessRows[0]) return [];
            return existing;
          }

          const authorityRows = await transaction<SettlementAuthorityRow[]>`
            with target_user as (
              select id
              from users
              where supabase_user_id = ${input.supabaseUserId}
              limit 1
            ),
            creator_candidate as (
              select ${input.creatorUserId ?? null}::uuid as id
              where ${input.creatorUserId ?? null}::uuid is not null
              union all
              select ${input.targetId}::uuid
              where ${input.productType} = 'support'
              union all
              select ci.creator_user_id
              from content_items ci
              where ${input.productType} = 'content_unlock' and ci.id = ${input.targetId}
              union all
              select lr.creator_user_id
              from live_rooms lr
              where ${input.productType} = 'live_pass' and lr.id = ${input.targetId}
              union all
              select e.creator_user_id
              from events e
              where ${input.productType} = 'event_access_pass' and e.id = ${input.targetId}
              limit 1
            ),
            referral_candidate as (
              select rt.id, rt.creator_user_id
              from referral_tokens rt
              join target_user tu on rt.creator_user_id <> tu.id
              where rt.token = ${input.referralToken ?? null}
                and rt.state = 'active'
                and rt.eligibility in ('external_share', 'partner_campaign')
                and (rt.expires_at is null or rt.expires_at > now())
              limit 1
            ),
            referral_recipient as (
              select rc.id, rc.creator_user_id, w.address
              from referral_candidate rc
              join lateral (
                select address from wallets
                where user_id = rc.creator_user_id
                  and chain = case
                    when ${input.solanaCluster} = 'mainnet-beta' then 'solana_mainnet'::wallet_chain
                    else 'solana_devnet'::wallet_chain
                  end
                order by is_primary desc, created_at asc
                limit 1
              ) w on true
            )
            select
              tu.id as buyer_user_id,
              cc.id as creator_user_id,
              readiness.address as creator_wallet,
              rr.id as referral_token_id,
              rr.creator_user_id as referrer_user_id,
              rr.address as referral_wallet,
              managed.relationship_id as managed_creator_relationship_id,
              managed.agreement_id as managed_creator_agreement_id,
              managed.organization_id as enterprise_organization_id,
              managed.enterprise_wallet,
              managed.enterprise_management_share_bps
            from target_user tu
            cross join creator_candidate cc
            cross join lateral private.assert_recipient_monetisation_ready(
              cc.id,
              ${input.productType},
              case
                when ${input.solanaCluster} = 'mainnet-beta' then 'solana_mainnet'::wallet_chain
                else 'solana_devnet'::wallet_chain
              end,
              null
            ) readiness
            left join referral_recipient rr on true
            left join lateral private.resolve_managed_creator_allocation(
              cc.id,
              case
                when ${input.solanaCluster} = 'mainnet-beta' then 'solana_mainnet'::wallet_chain
                else 'solana_devnet'::wallet_chain
              end
            ) managed on true
            limit 1
          `;
          const authority = authorityRows[0];

          if (!authority) {
            return [];
          }

          const split = calculateSettlementSplit({
            totalAmountAtomic: input.amountMinor,
            platformFeeBps: input.platformFeeBps,
            referralShareOfPlatformFeeBps: authority.referral_wallet
              ? input.referralShareOfPlatformFeeBps
              : 0,
            enterpriseShareOfCreatorProceedsBps:
              authority.enterprise_management_share_bps ?? 0
          });
          const enterpriseAllocationIsPayable = split.enterpriseManagementAmountAtomic > 0;
          const paymentIntentId = randomUUID();
          const inserted = await transaction<PaymentIntentRow[]>`
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
            enterprise_wallet,
            platform_fee_wallet,
            referral_wallet,
            total_amount_minor,
            creator_side_proceeds_minor,
            creator_amount_minor,
            enterprise_management_amount_minor,
            platform_fee_gross_minor,
            platform_fee_amount_minor,
            referral_amount_minor,
            managed_creator_relationship_id,
            managed_creator_agreement_id,
            enterprise_organization_id,
            reference_address,
            referral_token_id,
            expires_at
          )
          values (
            ${paymentIntentId},
            ${authority.buyer_user_id},
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
            ${authority.creator_wallet},
            ${enterpriseAllocationIsPayable ? authority.enterprise_wallet : null},
            ${input.platformFeeWallet},
            ${authority.referral_wallet},
            ${split.totalAmountAtomic},
            ${split.creatorSideProceedsAtomic},
            ${split.creatorAmountAtomic},
            ${split.enterpriseManagementAmountAtomic},
            ${split.platformFeeGrossAtomic},
            ${split.platformFeeAmountAtomic},
            ${split.referralAmountAtomic},
            ${enterpriseAllocationIsPayable ? authority.managed_creator_relationship_id : null},
            ${enterpriseAllocationIsPayable ? authority.managed_creator_agreement_id : null},
            ${enterpriseAllocationIsPayable ? authority.enterprise_organization_id : null},
            ${input.referenceAddress},
            ${authority.referral_token_id},
            ${input.expiresAt}
          )
          on conflict (user_id, idempotency_key) do nothing
          returning *
          `;

          if (!inserted[0]) {
            return transaction<PaymentIntentRow[]>`
              select pi.* from payment_intents pi
              where pi.user_id = ${authority.buyer_user_id}
                and pi.idempotency_key = ${input.idempotencyKey}
              limit 1
            `;
          }

          if (authority.referral_token_id && authority.referrer_user_id && split.referralAmountAtomic > 0) {
            await transaction`
              insert into referral_attributions (
                id, referral_token_id, referrer_user_id, referred_user_id, payment_intent_id
              ) values (
                ${randomUUID()}, ${authority.referral_token_id}, ${authority.referrer_user_id},
                ${authority.buyer_user_id}, ${paymentIntentId}
              )
              on conflict (payment_intent_id) do nothing
            `;
          }

          if (
            authority.managed_creator_relationship_id &&
            authority.managed_creator_agreement_id &&
            authority.enterprise_organization_id &&
            split.enterpriseManagementAmountAtomic > 0
          ) {
            await transaction`
              insert into managed_creator_allocation_records (
                payment_intent_id, relationship_id, agreement_id, organization_id,
                creator_user_id, creator_side_proceeds_minor, creator_net_minor,
                enterprise_management_minor, currency
              ) values (
                ${paymentIntentId}, ${authority.managed_creator_relationship_id},
                ${authority.managed_creator_agreement_id}, ${authority.enterprise_organization_id},
                ${authority.creator_user_id}, ${split.creatorSideProceedsAtomic},
                ${split.creatorAmountAtomic}, ${split.enterpriseManagementAmountAtomic}, ${input.currency}
              )
            `;
          }

          return inserted;
        }) as PaymentIntentRow[];
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
          pi.enterprise_wallet,
          pi.platform_fee_wallet,
          pi.referral_wallet,
          pi.total_amount_minor,
          pi.creator_side_proceeds_minor,
          pi.creator_amount_minor,
          pi.enterprise_management_amount_minor,
          pi.platform_fee_gross_minor,
          pi.platform_fee_amount_minor,
          pi.referral_amount_minor,
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
    async acceptCheckoutTerms(input) {
      return sql.begin(async (transaction) => {
        const actorRows = await transaction<{ id: string }[]>`
          select id
          from users
          where supabase_user_id = ${input.supabaseUserId}
            and state = 'active'
          limit 1
        `;
        const actor = actorRows[0];
        if (!actor) return null;

        const receiptRows = await transaction<{
          actor_user_id: string | null;
          scope: string;
          request_hash: string;
          response_body: { paymentIntentId?: string } | null;
        }[]>`
          select actor_user_id, scope, request_hash, response_body
          from idempotency_keys
          where key = ${input.idempotencyKey}
          limit 1
        `;
        const receipt = receiptRows[0];

        if (receipt) {
          if (
            receipt.actor_user_id !== actor.id ||
            receipt.scope !== 'payment_checkout_consent' ||
            receipt.request_hash !== input.requestHash ||
            receipt.response_body?.paymentIntentId !== input.paymentIntentId
          ) {
            throw new PaymentIdempotencyConflictError();
          }

          const replayRows = await transaction<PaymentIntentRow[]>`
            select *
            from payment_intents
            where id = ${input.paymentIntentId}
              and user_id = ${actor.id}
            limit 1
          `;
          return replayRows[0] ? toStoredPaymentIntent(replayRows[0]) : null;
        }

        const intentRows = await transaction<PaymentIntentRow[]>`
          select pi.*
          from payment_intents pi
          where pi.id = ${input.paymentIntentId}
            and pi.user_id = ${actor.id}
          for update
        `;
        const intent = intentRows[0];
        if (!intent) return null;

        if (
          intent.terms_version !== input.termsVersion ||
          intent.withdrawal_waiver_version !== input.withdrawalWaiverVersion ||
          (intent.withdrawal_waiver_required && !input.immediateAccessAcknowledged)
        ) {
          throw new PaymentConsentConflictError();
        }

        const updatedRows = await transaction<PaymentIntentRow[]>`
          update payment_intents
          set
            withdrawal_waiver_accepted_at = case
              when withdrawal_waiver_required then coalesce(withdrawal_waiver_accepted_at, now())
              else withdrawal_waiver_accepted_at
            end,
            updated_at = now()
          where id = ${intent.id}
            and expires_at > now()
            and state in ('pending', 'transaction_requested')
          returning *
        `;
        const updated = updatedRows[0];
        if (!updated) throw new PaymentConsentConflictError();

        await transaction`
          insert into audit_events (
            id, actor_user_id, subject_type, subject_id, action, metadata, idempotency_key
          ) values (
            ${randomUUID()},
            ${actor.id},
            'payment_intent',
            ${intent.id},
            'payment_checkout_terms_accepted',
            ${transaction.json({
              termsVersion: input.termsVersion,
              withdrawalWaiverVersion: input.withdrawalWaiverVersion,
              immediateAccessAcknowledged: input.immediateAccessAcknowledged
            })},
            ${input.idempotencyKey}
          )
        `;

        await transaction`
          insert into idempotency_keys (
            key, actor_user_id, scope, request_hash, response_status, response_body, expires_at
          ) values (
            ${input.idempotencyKey},
            ${actor.id},
            'payment_checkout_consent',
            ${input.requestHash},
            200,
            ${transaction.json({ paymentIntentId: intent.id })},
            'infinity'::timestamptz
          )
        `;

        return toStoredPaymentIntent(updated);
      });
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
