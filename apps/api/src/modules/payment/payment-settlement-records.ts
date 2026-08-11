import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import type { RecordPaymentSubmissionInput, StoredPaymentIntent } from "./types.js";

export async function insertSettlementAttempt(
  transaction: postgres.TransactionSql,
  input: RecordPaymentSubmissionInput
): Promise<void> {
  await transaction`
    insert into payment_settlement_attempts (
      id,
      payment_intent_id,
      signature,
      state,
      failure_code,
      observed_block_time
    )
    values (
      ${randomUUID()},
      ${input.paymentIntentId},
      ${input.signature},
      ${input.settlement.confirmed ? "confirmed" : "submitted"},
      ${input.settlement.failureCode ?? null},
      ${input.settlement.blockTime ?? null}
    )
  `;
}

export async function recordWalletTransaction(
  transaction: postgres.TransactionSql,
  input: {
    userId: string;
    paymentIntentId: string;
    signature: string;
    state: "submitted" | "confirmed";
    amountMinor: number;
    currency: StoredPaymentIntent["currency"];
  }
): Promise<void> {
  await transaction`
    insert into wallet_transaction_records (
      id,
      user_id,
      wallet_id,
      payment_intent_id,
      chain,
      direction,
      amount_minor,
      currency,
      state,
      source,
      signature,
      reference_address,
      submitted_at,
      confirmed_at
    )
    select
      ${randomUUID()},
      pi.user_id,
      w.id,
      pi.id,
      case
        when pi.solana_cluster = 'mainnet-beta' then 'solana_mainnet'
        else 'solana_devnet'
      end,
      'outgoing',
      ${input.amountMinor},
      ${input.currency},
      ${input.state},
      'payment_intent',
      ${input.signature},
      pi.reference_address,
      now(),
      case when ${input.state}::text = 'confirmed' then now() else null end
    from payment_intents pi
    left join wallets w on w.user_id = pi.user_id and w.is_primary
    where pi.id = ${input.paymentIntentId}
      and pi.user_id = ${input.userId}
    on conflict (payment_intent_id, signature)
      where payment_intent_id is not null and signature is not null
    do update
    set
      state = excluded.state,
      confirmed_at = coalesce(wallet_transaction_records.confirmed_at, excluded.confirmed_at),
      updated_at = now()
  `;
}
