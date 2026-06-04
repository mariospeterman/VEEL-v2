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
  target_id: string;
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
          await recordTipSupportSettlementLedger(transaction, {
            paymentIntentId: updatedIntent.payment_intent_id,
            actorUserId: updatedIntent.user_id,
            creatorUserId: updatedIntent.target_id,
            amountMinor: Number(updatedIntent.amount_minor),
            currency: updatedIntent.currency,
            productType: updatedIntent.product_type
          });
        }

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
    targetId: row.target_id,
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

const defaultPlatformFeeBps = 1000;

async function recordTipSupportSettlementLedger(
  transaction: postgres.TransactionSql,
  input: {
    paymentIntentId: string;
    actorUserId: string;
    creatorUserId: string;
    amountMinor: number;
    currency: StoredPaymentIntent["currency"];
    productType: "tip" | "support";
  }
): Promise<void> {
  const platformFeeMinor = Math.floor((input.amountMinor * defaultPlatformFeeBps) / 10_000);
  const creatorAmountMinor = input.amountMinor - platformFeeMinor;

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
        ${creatorAmountMinor},
        ${input.currency},
        'credit'
      ),
      (
        ${randomUUID()},
        ${input.paymentIntentId},
        'platform_fee',
        'platform',
        null,
        ${platformFeeMinor},
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
      'tip_support_settlement_posted',
      ${transaction.json({
        productType: input.productType,
        creatorUserId: input.creatorUserId,
        creatorAmountMinor,
        platformFeeMinor
      })}
    )
  `;
}

async function grantContentUnlockEntitlement(
  transaction: postgres.TransactionSql,
  input: {
    userId: string;
    contentId: string;
    paymentIntentId: string;
  }
): Promise<void> {
  const rows = await transaction<{ id: string }[]>`
    with existing_entitlement as (
      select id
      from entitlements
      where user_id = ${input.userId}
        and target_type = 'content'
        and target_id = ${input.contentId}
        and product_type = 'content_unlock'
        and state = 'active'
        and starts_at <= now()
        and (ends_at is null or ends_at > now())
      limit 1
    ),
    inserted_entitlement as (
      insert into entitlements (
        id,
        user_id,
        target_type,
        target_id,
        product_type,
        payment_intent_id
      )
      select
        ${randomUUID()},
        ${input.userId},
        'content',
        ${input.contentId},
        'content_unlock',
        ${input.paymentIntentId}
      where not exists (select 1 from existing_entitlement)
      on conflict (payment_intent_id) do update
      set state = entitlements.state
      returning id
    )
    select id from inserted_entitlement
    union all
    select id from existing_entitlement
    limit 1
  `;
  const entitlementId = rows[0]?.id;

  if (!entitlementId) {
    return;
  }

  await transaction`
    insert into entitlement_events (
      id,
      entitlement_id,
      actor_user_id,
      action,
      payment_intent_id
    )
    values (
      ${randomUUID()},
      ${entitlementId},
      ${input.userId},
      'granted',
      ${input.paymentIntentId}
    )
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
      ${input.userId},
      'content',
      ${input.contentId},
      'content_unlock_entitlement_granted',
      ${transaction.json({ paymentIntentId: input.paymentIntentId })}
    )
  `;
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
