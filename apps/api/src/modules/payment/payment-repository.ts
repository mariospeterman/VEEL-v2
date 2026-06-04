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
): Promise<{ creatorAmountMinor: number; platformFeeMinor: number }> {
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

  return {
    creatorAmountMinor,
    platformFeeMinor
  };
}

const defaultReferralShareOfPlatformFeeBps = 2000;

async function recordReferralCommission(
  transaction: postgres.TransactionSql,
  input: {
    paymentIntentId: string;
    actorUserId: string;
    platformFeeMinor: number;
    currency: StoredPaymentIntent["currency"];
  }
): Promise<void> {
  if (input.platformFeeMinor <= 0) {
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

  const commissionAmountMinor = Math.floor(
    (input.platformFeeMinor * defaultReferralShareOfPlatformFeeBps) / 10_000
  );

  if (commissionAmountMinor <= 0) {
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
      ${commissionAmountMinor},
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
      ${commissionAmountMinor},
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
        commissionAmountMinor
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

async function grantLivePassEntitlement(
  transaction: postgres.TransactionSql,
  input: {
    userId: string;
    paymentIntentId: string;
  }
): Promise<void> {
  const rows = await transaction<{
    live_pass_id: string;
    room_id: string;
    entitlement_id: string;
    expires_at: Date;
  }[]>`
    with purchase as (
      select
        room_id,
        buyer_user_id,
        duration_minutes
      from live_pass_purchase_requests
      where payment_intent_id = ${input.paymentIntentId}
        and buyer_user_id = ${input.userId}
      limit 1
    ),
    inserted_live_pass as (
      insert into live_passes (
        id,
        room_id,
        user_id,
        payment_intent_id,
        duration_minutes,
        expires_at
      )
      select
        ${randomUUID()},
        room_id,
        buyer_user_id,
        ${input.paymentIntentId},
        duration_minutes,
        now() + (duration_minutes::text || ' minutes')::interval
      from purchase
      on conflict (payment_intent_id) do update
      set state = live_passes.state
      returning id, room_id, user_id, payment_intent_id, expires_at
    ),
    inserted_entitlement as (
      insert into entitlements (
        id,
        user_id,
        target_type,
        target_id,
        product_type,
        payment_intent_id,
        ends_at
      )
      select
        ${randomUUID()},
        user_id,
        'live_room',
        room_id,
        'live_pass',
        payment_intent_id,
        expires_at
      from inserted_live_pass
      on conflict (payment_intent_id) do update
      set ends_at = excluded.ends_at
      returning id
    )
    select
      ilp.id as live_pass_id,
      ilp.room_id,
      ie.id as entitlement_id,
      ilp.expires_at
    from inserted_live_pass ilp
    join inserted_entitlement ie on true
    limit 1
  `;
  const livePass = rows[0];

  if (!livePass) {
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
      ${livePass.entitlement_id},
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
      'live_room',
      ${livePass.room_id},
      'live_pass_entitlement_granted',
      ${transaction.json({
        paymentIntentId: input.paymentIntentId,
        livePassId: livePass.live_pass_id,
        expiresAt: livePass.expires_at.toISOString()
      })}
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
