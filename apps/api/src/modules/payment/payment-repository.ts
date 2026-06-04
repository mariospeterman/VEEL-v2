import { randomUUID } from "node:crypto";
import postgres from "postgres";
import type {
  PaymentRepository,
  RecordPaymentSubmissionInput,
  StoredPaymentIntent
} from "./types.js";

export class PaymentRepositoryConfigurationError extends Error {
  constructor() {
    super("DATABASE_URL_NOT_CONFIGURED");
    this.name = "PaymentRepositoryConfigurationError";
  }
}

export class PaymentIdempotencyConflictError extends Error {
  constructor() {
    super("PAYMENT_IDEMPOTENCY_CONFLICT");
    this.name = "PaymentIdempotencyConflictError";
  }
}

interface PaymentIntentRow {
  id: string;
  product_type: StoredPaymentIntent["productType"];
  amount_minor: number;
  currency: StoredPaymentIntent["currency"];
  state: StoredPaymentIntent["state"];
  reference_address: string;
  treasury_wallet: string;
  solana_cluster: StoredPaymentIntent["solanaCluster"];
  expires_at: Date;
  request_hash: string;
}

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
            ${input.expiresAt}
          from target_user
          where not exists (select 1 from existing_intent)
          returning *
        )
        select
          id,
          product_type,
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
      await sql.begin(async (transaction) => {
        const nextState = input.settlement.confirmed ? "confirmed" : "submitted";
        await transaction`
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
        `;
        await insertSettlementAttempt(transaction, input);
      });
    },
    async close() {
      await sql.end({ timeout: 5 });
    }
  };
}

function toStoredPaymentIntent(row: PaymentIntentRow): StoredPaymentIntent {
  return {
    id: row.id,
    productType: row.product_type,
    amountMinor: Number(row.amount_minor),
    currency: row.currency,
    state: row.state,
    referenceAddress: row.reference_address,
    treasuryWallet: row.treasury_wallet,
    solanaCluster: row.solana_cluster,
    expiresAt: row.expires_at,
    requestHash: row.request_hash
  };
}

async function insertSettlementAttempt(
  transaction: postgres.TransactionSql,
  input: RecordPaymentSubmissionInput
): Promise<void> {
  await transaction`
    insert into payment_settlement_attempts (
      id,
      payment_intent_id,
      signature,
      state,
      failure_code
    )
    values (
      ${randomUUID()},
      ${input.paymentIntentId},
      ${input.signature},
      ${input.settlement.confirmed ? "confirmed" : "submitted"},
      ${input.settlement.failureCode ?? null}
    )
  `;
}
