import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import { isRecipientMonetisationPolicyError } from "../payment/payment-repository-errors.js";
import {
  SubscriptionIdempotencyConflictError,
  SubscriptionPolicyError,
  SubscriptionRepositoryConfigurationError
} from "./subscription-errors.js";
import { toSubscriptionPlan } from "./subscription-repository-mappers.js";
import type { PlanRow } from "./subscription-repository-rows.js";
import type { SubscriptionPlan, SubscriptionRepository } from "./types.js";

export function createCreatorMembershipOfferRepositoryMethods(
  sql: postgres.Sql
): Pick<SubscriptionRepository, "getCreatorOffer" | "upsertCreatorOffer" | "disableCreatorOffer"> {
  return {
    async getCreatorOffer(input) {
      const rows = await sql<PlanRow[]>`
        select
          sp.id, sp.scope, sp.label, sp.description, sp.benefits, sp.amount_minor,
          sp.amount_atomic, sp.currency, sp.period_days, sp.period_seconds,
          sp.billing_mode, sp.provider_state, sp.token_mint, sp.token_program,
          sp.provider, sp.program_id, sp.plan_pda, sp.merchant_wallet,
          sp.creator_user_id, p.handle as creator_handle,
          p.display_name as creator_display_name, p.avatar_url as creator_avatar_url
        from subscription_plans sp
        join users u on u.id = sp.creator_user_id
        join profiles p on p.user_id = u.id
        where u.supabase_user_id = ${input.supabaseUserId}
          and sp.scope = 'creator'
        order by sp.updated_at desc
        limit 1
      `;
      return rows[0] ? toSubscriptionPlan(rows[0]) : null;
    },

    async upsertCreatorOffer(input) {
      return sql.begin(async (transaction) => {
        const actorRows = await transaction<{ id: string; handle: string; display_name: string; avatar_url: string | null }[]>`
          select u.id, p.handle, p.display_name, p.avatar_url
          from users u
          join profiles p on p.user_id = u.id
          join creator_monetisation_settings cms on cms.user_id = u.id
          where u.supabase_user_id = ${input.supabaseUserId}
            and u.state = 'active'
            and cms.state = 'active'
            and cms.earning_state = 'ready'
            and cms.subscriptions_enabled = true
          for update of cms
        `;
        const actor = actorRows[0];
        if (!actor) throw new SubscriptionPolicyError("creator_membership_not_ready");

        const receiptRows = await transaction<{
          request_hash: string;
          response_body: SubscriptionPlan;
        }[]>`
          select request_hash, response_body
          from subscription_action_receipts
          where actor_user_id = ${actor.id}
            and action = 'offer_upsert'
            and idempotency_key = ${input.idempotencyKey}
          limit 1
        `;
        const receipt = receiptRows[0];
        if (receipt) {
          if (receipt.request_hash !== input.requestHash) throw new SubscriptionIdempotencyConflictError();
          return receipt.response_body;
        }

        let recipientRows: Array<{
          address: string;
          kyc_required: boolean;
          effective_kyc_mode: "disabled" | "risk_based" | "required";
          policy_version: string;
          decision_reason: string;
        }>;
        try {
          recipientRows = await transaction<Array<{
            address: string;
            kyc_required: boolean;
            effective_kyc_mode: "disabled" | "risk_based" | "required";
            policy_version: string;
            decision_reason: string;
          }>>`
            select address, kyc_required, effective_kyc_mode, policy_version, decision_reason
            from private.assert_recipient_monetisation_ready(
              ${actor.id},
              'creator_subscription',
              null,
              null
            )
          `;
        } catch (error) {
          if (isRecipientMonetisationPolicyError(error)) {
            throw new SubscriptionPolicyError(error.message);
          }
          throw error;
        }
        const recipientDecision = recipientRows[0];
        const recipientWallet = recipientDecision?.address;
        if (!recipientWallet) throw new SubscriptionPolicyError("recipient_wallet_missing");

        const planId = `creator_${actor.id}_monthly`;
        const rows = await transaction<PlanRow[]>`
          insert into subscription_plans (
            id, scope, creator_user_id, label, description, benefits,
            amount_minor, amount_atomic, currency, period_days, period_seconds,
            billing_mode, provider_state, token_mint, token_program, provider,
            program_id, plan_pda, merchant_wallet, creator_amount_atomic,
            platform_fee_amount_atomic, allocation_amount_atomic,
            recipient_kyc_required, recipient_kyc_policy_mode,
            recipient_kyc_policy_version, recipient_kyc_decision_reason,
            state, updated_at
          )
          values (
            ${planId}, 'creator', ${actor.id}, ${input.body.label.trim()},
            ${input.body.description?.trim() || null}, ${input.body.benefits.map((benefit) => benefit.trim())},
            ${input.body.amountMinor}, ${input.amountAtomic}, 'USDC', 30, 2592000,
            'delegated_solana_subscription', 'staging_required', ${input.tokenMint}, 'spl_token',
            'official_solana_subscription_program', ${input.programId}, null,
            ${recipientWallet}, ${input.creatorAmountAtomic}, ${input.platformAmountAtomic},
            0, ${recipientDecision?.kyc_required ?? true},
            ${recipientDecision?.effective_kyc_mode ?? "required"},
            ${recipientDecision?.policy_version ?? "missing"},
            ${recipientDecision?.decision_reason ?? "policy_missing_fail_closed"},
            'disabled', now()
          )
          on conflict (id) do update set
            label = excluded.label,
            description = excluded.description,
            benefits = excluded.benefits,
            amount_minor = excluded.amount_minor,
            amount_atomic = excluded.amount_atomic,
            token_mint = excluded.token_mint,
            program_id = excluded.program_id,
            plan_pda = null,
            merchant_wallet = excluded.merchant_wallet,
            creator_amount_atomic = excluded.creator_amount_atomic,
            platform_fee_amount_atomic = excluded.platform_fee_amount_atomic,
            allocation_amount_atomic = 0,
            recipient_kyc_required = excluded.recipient_kyc_required,
            recipient_kyc_policy_mode = excluded.recipient_kyc_policy_mode,
            recipient_kyc_policy_version = excluded.recipient_kyc_policy_version,
            recipient_kyc_decision_reason = excluded.recipient_kyc_decision_reason,
            provider_state = 'staging_required',
            state = 'disabled',
            updated_at = now()
          returning
            id, scope, label, description, benefits, amount_minor, amount_atomic,
            currency, period_days, period_seconds, billing_mode, provider_state,
            token_mint, token_program, provider, program_id, plan_pda,
            merchant_wallet, creator_user_id, ${actor.handle}::text as creator_handle,
            ${actor.display_name}::text as creator_display_name,
            ${actor.avatar_url}::text as creator_avatar_url
        `;
        const plan = rows[0] ? toSubscriptionPlan(rows[0]) : null;
        if (!plan) throw new SubscriptionRepositoryConfigurationError();

        await transaction`
          insert into subscription_action_receipts (
            id, actor_user_id, subscription_id, action, idempotency_key, request_hash, response_body
          ) values (
            ${randomUUID()}, ${actor.id}, null, 'offer_upsert', ${input.idempotencyKey},
            ${input.requestHash}, ${transaction.json(plan as postgres.JSONValue)}
          )
        `;
        return plan;
      });
    },

    async disableCreatorOffer(input) {
      return sql.begin(async (transaction) => {
        const actorRows = await transaction<{ id: string }[]>`
          select id from users where supabase_user_id = ${input.supabaseUserId} for update
        `;
        const actor = actorRows[0];
        if (!actor) throw new SubscriptionRepositoryConfigurationError();
        const receipts = await transaction<{ request_hash: string; response_body: { disabled: boolean } }[]>`
          select request_hash, response_body from subscription_action_receipts
          where actor_user_id = ${actor.id} and action = 'offer_disable'
            and idempotency_key = ${input.idempotencyKey}
        `;
        if (receipts[0]) {
          if (receipts[0].request_hash !== input.requestHash) throw new SubscriptionIdempotencyConflictError();
          return receipts[0].response_body.disabled;
        }
        const rows = await transaction<{ id: string }[]>`
          update subscription_plans
          set state = 'disabled', provider_state = 'staging_required', updated_at = now()
          where creator_user_id = ${actor.id} and scope = 'creator'
          returning id
        `;
        if (!rows[0]) return false;
        await transaction`
          insert into subscription_action_receipts (
            id, actor_user_id, subscription_id, action, idempotency_key, request_hash, response_body
          ) values (
            ${randomUUID()}, ${actor.id}, null, 'offer_disable', ${input.idempotencyKey},
            ${input.requestHash}, '{"disabled":true}'::jsonb
          )
        `;
        return true;
      });
    }
  };
}
