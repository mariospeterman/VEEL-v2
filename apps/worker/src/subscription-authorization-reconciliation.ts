import { randomUUID } from "node:crypto";
import {
  applyAuthorizationVerificationToSubscription,
  type SubscriptionAuthorizationVerificationResult,
  type SubscriptionAuthorizationVerifier,
  type VerifySubscriptionAuthorizationInput
} from "@veel/api/subscription-authorization-verifier-runtime";
import postgres from "postgres";

const defaultRetryDelayMs = 60_000;

export interface PendingSubscriptionAuthorizationEvidence
  extends VerifySubscriptionAuthorizationInput {
  authorizationIntentId: string;
  subscriptionId: string;
  subscriberUserId: string;
  submittedAt: Date;
}

export interface ProcessSubscriptionAuthorizationReconciliationsResult {
  claimed: number;
  verified: number;
  retrying: number;
  terminal: number;
  stale: number;
}

export interface SubscriptionAuthorizationReconciliationRepository {
  reconcileDue(input: {
    now: Date;
    limit: number;
    retryDelayMs: number;
    verifier: SubscriptionAuthorizationVerifier;
  }): Promise<ProcessSubscriptionAuthorizationReconciliationsResult>;
  close?(): Promise<void>;
}

export async function processSubscriptionAuthorizationReconciliations(input: {
  repository: SubscriptionAuthorizationReconciliationRepository;
  verifier: SubscriptionAuthorizationVerifier;
  now?: Date;
  limit?: number;
  retryDelayMs?: number;
}): Promise<ProcessSubscriptionAuthorizationReconciliationsResult> {
  return input.repository.reconcileDue({
    now: input.now ?? new Date(),
    limit: input.limit ?? 25,
    retryDelayMs: input.retryDelayMs ?? defaultRetryDelayMs,
    verifier: input.verifier
  });
}

export function createPostgresSubscriptionAuthorizationReconciliationRepository(input: {
  databaseUrl?: string;
  sql?: postgres.Sql;
}): SubscriptionAuthorizationReconciliationRepository {
  if (!input.sql && !input.databaseUrl) {
    return {
      async reconcileDue() {
        return emptyResult();
      }
    };
  }

  const ownsSql = !input.sql;
  const sql = input.sql ?? postgres(input.databaseUrl as string, { max: 4 });

  return {
    async reconcileDue(reconcileInput) {
      const rows: ClaimedAuthorizationEvidenceRow[] = await sql.begin(async (transaction) => {
        const retryCutoff = new Date(
          reconcileInput.now.getTime() - reconcileInput.retryDelayMs
        );
        const candidates = await transaction<AuthorizationEvidenceRow[]>`
          select
            sai.id as authorization_intent_id,
            sai.subscription_id,
            s.subscriber_user_id,
            sai.setup_reference,
            sai.submitted_signature,
            sai.submitted_at,
            sai.expires_at,
            sai.authority_address,
            sai.delegation_address,
            sai.subscriber_token_account,
            sai.delegation_expires_at,
            s.collector_address,
            s.subscriber_wallet,
            acceptance.provider,
            acceptance.program_id,
            acceptance.token_mint,
            acceptance.token_program,
            acceptance.amount_minor,
            acceptance.amount_atomic,
            acceptance.period_days,
            acceptance.period_seconds,
            acceptance.delegation_nonce,
            acceptance.plan_id,
            acceptance.plan_pda,
            s.subscription_pda,
            acceptance.merchant_wallet,
            attempt.last_attempt_at
          from subscription_authorization_intents sai
          join subscriptions s on s.id = sai.subscription_id
          join subscription_billing_acceptances acceptance
            on acceptance.subscription_id = s.id
            and acceptance.authorization_intent_id = sai.id
          left join lateral (
            select max(event.created_at) as last_attempt_at
            from subscription_events event
            where event.authorization_intent_id = sai.id
              and event.action = 'subscription.authorization_reverification_attempted'
          ) attempt on true
          where sai.state = 'submitted'
            and sai.submitted_signature is not null
            and sai.submitted_at is not null
            and s.state = 'authorization_pending'
            and s.cancel_at_period_end = false
            and s.cancelled_at is null
            and s.revoked_at is null
            and s.plan_id = acceptance.plan_id
            and s.provider = acceptance.provider
            and s.program_id = acceptance.program_id
            and s.token_mint = acceptance.token_mint
            and s.amount_atomic = acceptance.amount_atomic
            and s.period_seconds = acceptance.period_seconds
            and s.collector_address = acceptance.collector_address
            and s.delegation_nonce = acceptance.delegation_nonce
            and (
              attempt.last_attempt_at is null
              or attempt.last_attempt_at <= ${retryCutoff}
            )
          order by attempt.last_attempt_at asc nulls first, sai.submitted_at asc, sai.id asc
          limit ${reconcileInput.limit}
          for update of sai, s skip locked
        `;

        const claimed: ClaimedAuthorizationEvidenceRow[] = [];
        for (const row of candidates) {
          const attemptEventId = randomUUID();
          await transaction`
            insert into subscription_events (
              id,
              subscription_id,
              actor_user_id,
              action,
              authorization_intent_id,
              metadata
            ) values (
              ${attemptEventId},
              ${row.subscription_id},
              null,
              'subscription.authorization_reverification_attempted',
              ${row.authorization_intent_id},
              ${transaction.json({ phase: "claimed" })}::jsonb
            )
          `;
          claimed.push({ ...row, attemptEventId });
        }
        return claimed;
      });

      const result = emptyResult();
      result.claimed = rows.length;
      const outcomes = await Promise.all(
        rows.map(async (row) => ({
          row,
          outcome: await verifyWithoutThrow(
            reconcileInput.verifier,
            toVerificationInput(row)
          )
        }))
      );

      for (const { row, outcome } of outcomes) {
        const applied = await sql.begin(async (transaction) => {
          const lockedRows = await transaction<{ id: string }[]>`
            select sai.id
            from subscription_authorization_intents sai
            join subscriptions s on s.id = sai.subscription_id
            where sai.id = ${row.authorization_intent_id}
              and sai.subscription_id = ${row.subscription_id}
              and sai.state = 'submitted'
              and sai.submitted_signature = ${row.submitted_signature}
              and s.state = 'authorization_pending'
              and s.cancel_at_period_end = false
              and s.cancelled_at is null
              and s.revoked_at is null
              and (s.setup_signature is null or s.setup_signature = ${row.submitted_signature})
              and (
                select event.id
                from subscription_events event
                where event.authorization_intent_id = sai.id
                  and event.action = 'subscription.authorization_reverification_attempted'
                order by event.created_at desc, event.id desc
                limit 1
              ) = ${row.attemptEventId}
            for update of sai, s
          `;
          if (!lockedRows[0]) return false;

          const intentRows = await transaction<{ id: string }[]>`
            update subscription_authorization_intents
            set
              state = case
                when ${outcome.verified} then 'verified'
                when ${outcome.failureCode === "intent_expired"} then 'expired'
                else 'submitted'
              end,
              verified_signature = case
                when ${outcome.verified} then submitted_signature
                else verified_signature
              end,
              failure_reason = case
                when ${outcome.verified} then null
                else ${outcome.failureCode ?? "rpc_unavailable"}::text
              end,
              verified_at = case when ${outcome.verified} then now() else verified_at end
            where id = ${row.authorization_intent_id}
              and subscription_id = ${row.subscription_id}
              and state = 'submitted'
              and submitted_signature = ${row.submitted_signature}
            returning id
          `;

          if (!intentRows[0]) return false;

          const canonicalApplied = await applyAuthorizationVerificationToSubscription(
            transaction,
            {
              subscriptionId: row.subscription_id,
              signature: row.submitted_signature,
              verification: outcome
            }
          );

          await transaction`
            insert into subscription_events (
              id,
              subscription_id,
              actor_user_id,
              action,
              authorization_intent_id,
              metadata
            ) values (
              ${randomUUID()},
              ${row.subscription_id},
              null,
              'subscription.authorization_reverification_completed',
              ${row.authorization_intent_id},
              ${transaction.json({
                verified: outcome.verified,
                retryable: outcome.retryable ?? false,
                failureCode: outcome.failureCode ?? null,
                canonicalApplied
              })}::jsonb
            )
          `;
          return canonicalApplied;
        });

        if (!applied) {
          result.stale += 1;
        } else if (outcome.verified) {
          result.verified += 1;
        } else if (outcome.retryable) {
          result.retrying += 1;
        } else {
          result.terminal += 1;
        }
      }

      return result;
    },
    async close() {
      if (ownsSql) await sql.end({ timeout: 5 });
    }
  };
}

async function verifyWithoutThrow(
  verifier: SubscriptionAuthorizationVerifier,
  input: PendingSubscriptionAuthorizationEvidence
): Promise<SubscriptionAuthorizationVerificationResult> {
  try {
    return await verifier.verifyAuthorization(input);
  } catch {
    return {
      verified: false,
      failureCode: "rpc_unavailable",
      retryable: true
    };
  }
}

function toVerificationInput(
  row: AuthorizationEvidenceRow
): PendingSubscriptionAuthorizationEvidence {
  return {
    authorizationIntentId: row.authorization_intent_id,
    subscriptionId: row.subscription_id,
    subscriberUserId: row.subscriber_user_id,
    signature: row.submitted_signature,
    setupReference: row.setup_reference,
    authorityAddress: row.authority_address,
    delegationAddress: row.delegation_address,
    subscriberTokenAccount: row.subscriber_token_account,
    delegationProgramId: row.program_id,
    collectorAddress: row.collector_address,
    subscriberWallet: row.subscriber_wallet,
    tokenMint: row.token_mint,
    tokenProgram: row.token_program,
    amountMinor: Number(row.amount_minor),
    amountAtomic: String(row.amount_atomic),
    periodDays: row.period_days,
    periodSeconds: row.period_seconds,
    delegationNonce: Number(row.delegation_nonce),
    delegationExpiresAt: row.delegation_expires_at,
    provider: row.provider,
    planId: row.plan_id,
    planPda: row.plan_pda,
    subscriptionPda: row.subscription_pda,
    merchantWallet: row.merchant_wallet,
    expiresAt: row.expires_at,
    acceptedAt: row.submitted_at,
    submittedAt: row.submitted_at
  };
}

function emptyResult(): ProcessSubscriptionAuthorizationReconciliationsResult {
  return {
    claimed: 0,
    verified: 0,
    retrying: 0,
    terminal: 0,
    stale: 0
  };
}

interface AuthorizationEvidenceRow {
  authorization_intent_id: string;
  subscription_id: string;
  subscriber_user_id: string;
  setup_reference: string;
  submitted_signature: string;
  submitted_at: Date;
  expires_at: Date;
  authority_address: string;
  delegation_address: string;
  subscriber_token_account: string;
  delegation_expires_at: Date;
  collector_address: string | null;
  subscriber_wallet: string | null;
  provider: string;
  program_id: string;
  token_mint: string | null;
  token_program: "spl_token" | "token_2022" | null;
  amount_minor: string | number;
  amount_atomic: string | number;
  period_days: number;
  period_seconds: number;
  delegation_nonce: string | number;
  plan_id: string;
  plan_pda: string | null;
  subscription_pda: string | null;
  merchant_wallet: string | null;
  last_attempt_at: Date | null;
}

interface ClaimedAuthorizationEvidenceRow extends AuthorizationEvidenceRow {
  attemptEventId: string;
}
