import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import type { StoredPaymentIntent } from "./types.js";

export async function recordSupportSettlementLedger(
  transaction: postgres.TransactionSql,
  input: {
    paymentIntentId: string;
    actorUserId: string;
    creatorUserId: string;
    creatorAmountMinor: number;
    platformFeeMinor: number;
    currency: StoredPaymentIntent["currency"];
    productType: "tip" | "support";
  }
): Promise<{ creatorAmountMinor: number; platformFeeMinor: number }> {
  await transaction`
    insert into payment_ledger_entries (
      id,
      payment_intent_id,
      account_kind,
      account_key,
      account_user_id,
      amount_minor,
      currency,
      direction
    )
    values
      (
        ${randomUUID()},
        ${input.paymentIntentId},
        'creator_earning',
        ${`creator:${input.creatorUserId}`},
        ${input.creatorUserId},
        ${input.creatorAmountMinor},
        ${input.currency},
        'credit'
      ),
      (
        ${randomUUID()},
        ${input.paymentIntentId},
        'platform_fee',
        'platform',
        null,
        ${input.platformFeeMinor},
        ${input.currency},
        'credit'
      )
    on conflict (payment_intent_id, account_kind, account_key) do nothing
  `;

  await transaction`
    insert into audit_events (
      id,
      actor_user_id,
      subject_type,
      subject_id,
      action,
      metadata
    )
    values (
      ${randomUUID()},
      ${input.actorUserId},
      'payment_intent',
      ${input.paymentIntentId},
      'support_settlement_posted',
      ${transaction.json({
        productType: input.productType,
        creatorUserId: input.creatorUserId,
        creatorAmountMinor: input.creatorAmountMinor,
        platformFeeMinor: input.platformFeeMinor
      })}
    )
  `;

  return {
    creatorAmountMinor: input.creatorAmountMinor,
    platformFeeMinor: input.platformFeeMinor
  };
}

export async function recordReferralCommission(
  transaction: postgres.TransactionSql,
  input: {
    paymentIntentId: string;
    actorUserId: string;
    referralAmountMinor: number;
    currency: StoredPaymentIntent["currency"];
  }
): Promise<void> {
  if (input.referralAmountMinor <= 0) {
    return;
  }

  const rows = await transaction<{
    attribution_id: string;
    referral_token_id: string;
    referrer_user_id: string;
    referred_user_id: string;
  }[]>`
    select
      ra.id as attribution_id,
      ra.referral_token_id,
      ra.referrer_user_id,
      ra.referred_user_id
    from referral_attributions ra
    where ra.payment_intent_id = ${input.paymentIntentId}
      and ra.state = 'attributed'
    limit 1
  `;
  const attribution = rows[0];

  if (!attribution) {
    return;
  }

  await transaction`
    insert into referral_commissions (
      id,
      referral_attribution_id,
      referral_token_id,
      payment_intent_id,
      referrer_user_id,
      referred_user_id,
      amount_minor,
      currency
    )
    values (
      ${randomUUID()},
      ${attribution.attribution_id},
      ${attribution.referral_token_id},
      ${input.paymentIntentId},
      ${attribution.referrer_user_id},
      ${attribution.referred_user_id},
      ${input.referralAmountMinor},
      ${input.currency}
    )
    on conflict (payment_intent_id, referral_token_id) do nothing
  `;

  await transaction`
    insert into payment_ledger_entries (
      id,
      payment_intent_id,
      account_kind,
      account_key,
      account_user_id,
      amount_minor,
      currency,
      direction
    )
    values (
      ${randomUUID()},
      ${input.paymentIntentId},
      'referral_commission',
      ${`referrer:${attribution.referrer_user_id}`},
      ${attribution.referrer_user_id},
      ${input.referralAmountMinor},
      ${input.currency},
      'credit'
    )
    on conflict (payment_intent_id, account_kind, account_key) do nothing
  `;

  await transaction`
    insert into audit_events (
      id,
      actor_user_id,
      subject_type,
      subject_id,
      action,
      metadata
    )
    values (
      ${randomUUID()},
      ${input.actorUserId},
      'payment_intent',
      ${input.paymentIntentId},
      'referral_commission_created',
      ${transaction.json({
        referralTokenId: attribution.referral_token_id,
        referrerUserId: attribution.referrer_user_id,
        commissionAmountMinor: input.referralAmountMinor
      })}
    )
  `;
}
