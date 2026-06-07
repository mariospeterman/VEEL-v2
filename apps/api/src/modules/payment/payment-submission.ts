import type postgres from "postgres";
import type { RecordPaymentSubmissionInput, StoredPaymentIntent } from "./types.js";
import { grantContentUnlockEntitlement, grantLivePassEntitlement } from "./payment-entitlement-settlement.js";
import { grantEventTicketEntitlement } from "./payment-event-access-settlement.js";
import { deliverPaidMessage } from "./payment-paid-message-settlement.js";
import { recordReferralCommission, recordTipSupportSettlementLedger } from "./payment-settlement-ledger.js";
import { insertSettlementAttempt, recordWalletTransaction } from "./payment-settlement-records.js";

export async function recordPaymentSubmission(
  sql: postgres.Sql,
  input: RecordPaymentSubmissionInput
): Promise<void> {
  await sql.begin(async (transaction) => {
    const nextState = input.settlement.confirmed ? "confirmed" : "submitted";
    const rows = await transaction<{
      payment_intent_id: string;
      user_id: string;
      product_type: StoredPaymentIntent["productType"];
      target_id: string;
      amount_minor: number;
      currency: StoredPaymentIntent["currency"];
    }[]>`
            update payment_intents pi
            set
              state = ${nextState},
              submitted_signature = ${input.signature},
              submitted_at = coalesce(submitted_at, now()),
              confirmed_signature = case
                when ${input.settlement.confirmed} then ${input.signature}
                else confirmed_signature
              end,
              confirmed_at = case
                when ${input.settlement.confirmed} then now()
                else confirmed_at
              end,
              updated_at = now()
            from users u
            where pi.user_id = u.id
              and u.supabase_user_id = ${input.supabaseUserId}
              and pi.id = ${input.paymentIntentId}
              and pi.state in ('pending', 'transaction_requested', 'submitted')
            returning
              pi.id as payment_intent_id,
              pi.user_id,
              pi.product_type,
              pi.target_id,
              pi.amount_minor,
              pi.currency
          `;
  
    const updatedIntent = rows[0];
  
    if (updatedIntent) {
      await recordWalletTransaction(transaction, {
        userId: updatedIntent.user_id,
        paymentIntentId: updatedIntent.payment_intent_id,
        signature: input.signature,
        state: input.settlement.confirmed ? "confirmed" : "submitted",
        amountMinor: Number(updatedIntent.amount_minor),
        currency: updatedIntent.currency
      });
    }
  
    if (input.settlement.confirmed && updatedIntent?.product_type === "content_unlock") {
      await grantContentUnlockEntitlement(transaction, {
        userId: updatedIntent.user_id,
        contentId: updatedIntent.target_id,
        paymentIntentId: updatedIntent.payment_intent_id
      });
    }
  
    if (
      input.settlement.confirmed &&
      (updatedIntent?.product_type === "tip" || updatedIntent?.product_type === "support")
    ) {
      const ledger = await recordTipSupportSettlementLedger(transaction, {
        paymentIntentId: updatedIntent.payment_intent_id,
        actorUserId: updatedIntent.user_id,
        creatorUserId: updatedIntent.target_id,
        amountMinor: Number(updatedIntent.amount_minor),
        currency: updatedIntent.currency,
        productType: updatedIntent.product_type
      });
      await recordReferralCommission(transaction, {
        paymentIntentId: updatedIntent.payment_intent_id,
        actorUserId: updatedIntent.user_id,
        currency: updatedIntent.currency,
        platformFeeMinor: ledger.platformFeeMinor
      });
    }
  
    if (input.settlement.confirmed && updatedIntent?.product_type === "live_pass") {
      await grantLivePassEntitlement(transaction, {
        userId: updatedIntent.user_id,
        paymentIntentId: updatedIntent.payment_intent_id
      });
    }
  
    if (input.settlement.confirmed && updatedIntent?.product_type === "paid_message") {
      await deliverPaidMessage(transaction, {
        userId: updatedIntent.user_id,
        paymentIntentId: updatedIntent.payment_intent_id
      });
    }
  
    if (input.settlement.confirmed && updatedIntent?.product_type === "event_ticket") {
      await grantEventTicketEntitlement(transaction, {
        userId: updatedIntent.user_id,
        paymentIntentId: updatedIntent.payment_intent_id
      });
    }
  
    await insertSettlementAttempt(transaction, input);
  });
}
