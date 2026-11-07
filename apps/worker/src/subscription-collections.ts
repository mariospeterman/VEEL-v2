import { createHash, randomUUID } from "node:crypto";
import { address, isSome } from "@solana/kit";
import {
  findRecurringDelegationPda,
  findSubscriptionAuthorityPda,
  getRecurringDelegationDecoder,
  getSubscriptionAuthorityDecoder
} from "@solana/subscriptions";
import {
  AccountState,
  TOKEN_PROGRAM_ADDRESS,
  getTokenDecoder,
  getTokenSize
} from "@solana-program/token";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import bs58 from "bs58";
import postgres from "postgres";

const token2022ProgramAddress = address("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

export type SubscriptionCollectionFailureCode =
  | "subscription_collection_provider_not_configured"
  | "subscription_collection_reconciliation_unavailable"
  | "unsupported_native_sol_subscription"
  | "collector_wallet_missing"
  | "subscription_split_mismatch"
  | "subscription_allocation_destination_unavailable"
  | "creator_receiver_wallet_missing"
  | "platform_receiver_wallet_missing"
  | "subscription_delegation_account_missing"
  | "subscription_delegation_owner_mismatch"
  | "subscription_delegation_decode_failed"
  | "subscription_delegation_terms_mismatch"
  | "subscription_authority_account_missing"
  | "subscription_authority_owner_mismatch"
  | "subscription_authority_decode_failed"
  | "subscription_authority_address_mismatch"
  | "subscription_authority_init_mismatch"
  | "subscription_token_account_mismatch"
  | "subscription_delegated_allowance_mismatch"
  | "subscription_delegation_expired"
  | "subscription_collection_broadcast_fence_rejected"
  | "subscription_collection_broadcast_evidence_rejected"
  | "subscription_collection_broadcast_expired"
  | "subscription_collection_transaction_failed"
  | "subscription_collection_rpc_failed";

export type SubscriptionCollectionOutcome =
  | {
      state: "confirmed";
      collectionSignature: string;
    }
  | {
      state: "failed";
      failureCode: SubscriptionCollectionFailureCode;
      retryAt: Date;
    }
  | {
      state: "reconciling";
      failureCode:
        | "subscription_collection_reconciliation_unavailable"
        | "subscription_collection_provider_not_configured";
      retryAt: Date;
    }
  | {
      state: "revoked";
      failureCode: "subscription_delegation_expired";
    }
  | {
      state: "cancelled";
      failureCode: "subscriber_cancelled";
    };

export type SubscriptionCollectionReconciliation =
  | SubscriptionCollectionOutcome
  | { state: "not_found" }
  | {
      state: "unknown";
      failureCode:
        | "subscription_collection_reconciliation_unavailable"
        | "subscription_collection_provider_not_configured";
      retryAt: Date;
    };

export interface DueSubscriptionCollection {
  collectionId: string;
  leaseToken: string;
  attemptCount: number;
  providerIdempotencyKey: string;
  subscriptionId: string;
  subscriberUserId: string;
  subscriberWallet: string;
  planId: string;
  amountMinor: bigint;
  amountAtomic: bigint;
  creatorAmountAtomic: bigint;
  platformAmountAtomic: bigint;
  allocationAmountAtomic: bigint;
  currency: "SOL" | "USDC";
  periodStartsAt: Date;
  periodEndsAt: Date;
  authorityAddress: string;
  delegationAddress: string;
  subscriberTokenAccount: string;
  collectorAddress: string;
  tokenMint: string;
  tokenProgram: "spl_token" | "token_2022";
  provider: string;
  programId: string;
  periodSeconds: number;
  delegationNonce: number;
  assetDecimals: number;
  scope: "platform" | "creator";
  creatorUserId: string | null;
  creatorReceiverWallet: string | null;
  platformReceiverWallet: string;
  termsVersion: string;
  withdrawalWaiverVersion: string;
  acceptedAt: Date;
  solanaNetwork: "devnet" | "mainnet-beta";
  broadcastSignature: string | null;
  broadcastTransactionBase64: string | null;
  broadcastBlockhash: string | null;
  broadcastLastValidBlockHeight: number | null;
  recipientKycRequired: boolean;
  recipientKycPolicyMode: "disabled" | "risk_based" | "required";
  recipientKycPolicyVersion: string;
  recipientKycDecisionReason: string;
}

export interface SubscriptionCollectionRepository {
  expireCancelledDueSubscriptions(input: { now: Date; limit: number }): Promise<number>;
  leaseDueCollections(input: {
    now: Date;
    limit: number;
    leaseDurationMs: number;
    maxAttempts: number;
  }): Promise<DueSubscriptionCollection[]>;
  authorizeCollectionBroadcast(input: {
    collectionId: string;
    subscriptionId: string;
    leaseToken: string;
  }): Promise<boolean>;
  recordPreparedCollectionBroadcast(input: {
    collectionId: string;
    subscriptionId: string;
    leaseToken: string;
    prepared: PreparedSubscriptionCollectionBroadcast;
  }): Promise<boolean>;
  recordCollectionOutcome(input: {
    collectionId: string;
    subscriptionId: string;
    leaseToken: string;
    maxAttempts: number;
    outcome: SubscriptionCollectionOutcome;
  }): Promise<boolean>;
  close?(): Promise<void>;
}

export interface SubscriptionCollectionProvider {
  reconcile(input: DueSubscriptionCollection): Promise<SubscriptionCollectionReconciliation>;
  collect(
    input: DueSubscriptionCollection,
    controls: SubscriptionCollectionBroadcastControls
  ): Promise<SubscriptionCollectionOutcome>;
}

export interface PreparedSubscriptionCollectionBroadcast {
  signature: string;
  transactionBase64: string;
  blockhash: string;
  lastValidBlockHeight: number;
}

export interface SubscriptionCollectionBroadcastControls {
  authorize(): Promise<boolean>;
  persist(prepared: PreparedSubscriptionCollectionBroadcast): Promise<boolean>;
}

export interface ProcessSubscriptionCollectionsResult {
  expired: number;
  leased: number;
  confirmed: number;
  failed: number;
  reconciling: number;
  revoked: number;
  cancelled: number;
}

export async function processDueSubscriptionCollections(input: {
  repository: SubscriptionCollectionRepository;
  provider: SubscriptionCollectionProvider;
  now?: Date;
  limit?: number;
  leaseDurationMs?: number;
  maxAttempts?: number;
}): Promise<ProcessSubscriptionCollectionsResult> {
  const now = input.now ?? new Date();
  const limit = input.limit ?? 25;
  const leaseDurationMs = input.leaseDurationMs ?? 5 * 60 * 1000;
  const maxAttempts = input.maxAttempts ?? 8;
  const expired = await input.repository.expireCancelledDueSubscriptions({ now, limit });
  const dueCollections = await input.repository.leaseDueCollections({
    now,
    limit,
    leaseDurationMs,
    maxAttempts
  });
  const result: ProcessSubscriptionCollectionsResult = {
    expired,
    leased: dueCollections.length,
    confirmed: 0,
    failed: 0,
    reconciling: 0,
    revoked: 0,
    cancelled: 0
  };

  for (const dueCollection of dueCollections) {
    const reconciliation = dueCollection.broadcastSignature
      ? await input.provider.reconcile(dueCollection)
      : { state: "not_found" as const };
    const outcome: SubscriptionCollectionOutcome =
      reconciliation.state === "confirmed" ||
      reconciliation.state === "failed" ||
      reconciliation.state === "reconciling" ||
      reconciliation.state === "revoked" ||
      reconciliation.state === "cancelled"
        ? reconciliation
        : reconciliation.state === "unknown"
          ? {
              state: "reconciling" as const,
              failureCode: reconciliation.failureCode,
              retryAt: reconciliation.retryAt
            }
        :
      dueCollection.currency === "SOL"
        ? {
            state: "failed" as const,
            failureCode: "unsupported_native_sol_subscription",
            retryAt: new Date(now.getTime() + 5 * 60 * 1000)
          }
        : !dueCollection.collectorAddress
          ? {
              state: "failed" as const,
              failureCode: "collector_wallet_missing",
              retryAt: new Date(now.getTime() + 5 * 60 * 1000)
            }
          : await input.provider.collect(dueCollection, {
              authorize: () => input.repository.authorizeCollectionBroadcast({
                collectionId: dueCollection.collectionId,
                subscriptionId: dueCollection.subscriptionId,
                leaseToken: dueCollection.leaseToken
              }),
              persist: (prepared) => input.repository.recordPreparedCollectionBroadcast({
                collectionId: dueCollection.collectionId,
                subscriptionId: dueCollection.subscriptionId,
                leaseToken: dueCollection.leaseToken,
                prepared
              })
            });
    const applied = await input.repository.recordCollectionOutcome({
      collectionId: dueCollection.collectionId,
      subscriptionId: dueCollection.subscriptionId,
      leaseToken: dueCollection.leaseToken,
      maxAttempts,
      outcome
    });

    if (!applied) continue;

    if (outcome.state === "confirmed") result.confirmed += 1;
    else if (outcome.state === "reconciling") result.reconciling += 1;
    else if (outcome.state === "revoked") result.revoked += 1;
    else if (outcome.state === "cancelled") result.cancelled += 1;
    else result.failed += 1;
  }

  return result;
}

export function createUnconfiguredSubscriptionCollectionProvider(): SubscriptionCollectionProvider {
  return {
    async reconcile() {
      return {
        state: "unknown",
        failureCode: "subscription_collection_provider_not_configured",
        retryAt: new Date(Date.now() + 5 * 60 * 1000)
      };
    },
    async collect() {
      return {
        state: "failed",
        failureCode: "subscription_collection_provider_not_configured",
        retryAt: new Date(Date.now() + 5 * 60 * 1000)
      };
    }
  };
}

export function createSolanaSubscriptionCollectionProvider(input: {
  rpcUrl: string;
  collectorPrivateKey: string;
  collectorWallet: string;
  platformWallet: string | null;
}): SubscriptionCollectionProvider {
  const connection = new Connection(input.rpcUrl, "finalized");
  const collector = Keypair.fromSecretKey(bs58.decode(input.collectorPrivateKey));
  if (collector.publicKey.toBase58() !== input.collectorWallet) {
    throw new Error("subscription_collector_key_mismatch");
  }

  return {
    async reconcile(collection) {
      if (!collection.broadcastSignature) {
        return { state: "not_found" };
      }
      try {
        const status = (await connection.getSignatureStatuses(
          [collection.broadcastSignature],
          { searchTransactionHistory: true }
        )).value[0];
        if (!status) {
          if (
            collection.broadcastLastValidBlockHeight !== null &&
            await connection.getBlockHeight("finalized") > collection.broadcastLastValidBlockHeight
          ) {
            return {
              state: "failed",
              failureCode: "subscription_collection_broadcast_expired",
              retryAt: new Date(Date.now() + 5 * 60 * 1000)
            };
          }
          return {
            state: "unknown",
            failureCode: "subscription_collection_reconciliation_unavailable",
            retryAt: new Date(Date.now() + 5 * 60 * 1000)
          };
        }
        if (status.confirmationStatus !== "finalized") {
          return {
            state: "unknown",
            failureCode: "subscription_collection_reconciliation_unavailable",
            retryAt: new Date(Date.now() + 5 * 60 * 1000)
          };
        }
        if (status.err) {
          return {
            state: "failed",
            failureCode: "subscription_collection_transaction_failed",
            retryAt: new Date(Date.now() + 5 * 60 * 1000)
          };
        }
        const transaction = await connection.getTransaction(collection.broadcastSignature, {
          commitment: "finalized",
          maxSupportedTransactionVersion: 0
        });
        return transaction && hasCollectionEvidence(transaction, collection)
          ? { state: "confirmed", collectionSignature: collection.broadcastSignature }
          : {
              state: "unknown",
              failureCode: "subscription_collection_reconciliation_unavailable",
              retryAt: new Date(Date.now() + 5 * 60 * 1000)
            };
      } catch {
        return {
          state: "unknown",
          failureCode: "subscription_collection_reconciliation_unavailable",
          retryAt: new Date(Date.now() + 5 * 60 * 1000)
        };
      }
    },

    async collect(collection) {
      try {
        const [delegationInfo, authorityInfo, tokenAccountInfo] = await Promise.all([
          connection.getAccountInfo(new PublicKey(collection.delegationAddress), "finalized"),
          connection.getAccountInfo(new PublicKey(collection.authorityAddress), "finalized"),
          connection.getAccountInfo(new PublicKey(collection.subscriberTokenAccount), "finalized")
        ]);
        if (!delegationInfo) {
          return retry("subscription_delegation_account_missing");
        }
        if (!authorityInfo) {
          return retry("subscription_authority_account_missing");
        }
        if (!tokenAccountInfo) {
          return retry("subscription_token_account_mismatch");
        }
        if (!delegationInfo.owner.equals(new PublicKey(collection.programId))) {
          return retry("subscription_delegation_owner_mismatch");
        }
        if (!authorityInfo.owner.equals(new PublicKey(collection.programId))) {
          return retry("subscription_authority_owner_mismatch");
        }
        const tokenProgram = collection.tokenProgram === "token_2022"
          ? token2022ProgramAddress
          : TOKEN_PROGRAM_ADDRESS;
        if (!tokenAccountInfo.owner.equals(new PublicKey(tokenProgram))) {
          return retry("subscription_token_account_mismatch");
        }
        let delegation;
        let authority;
        try {
          delegation = getRecurringDelegationDecoder().decode(delegationInfo.data);
        } catch {
          return retry("subscription_delegation_decode_failed");
        }
        try {
          authority = getSubscriptionAuthorityDecoder().decode(authorityInfo.data);
        } catch {
          return retry("subscription_authority_decode_failed");
        }
        const [expectedAuthorityAddress] = await findSubscriptionAuthorityPda(
          {
            user: address(collection.subscriberWallet),
            tokenMint: address(collection.tokenMint)
          },
          { programAddress: address(collection.programId) }
        );
        if (expectedAuthorityAddress !== collection.authorityAddress) {
          return retry("subscription_authority_address_mismatch");
        }
        const [expectedDelegationAddress] = await findRecurringDelegationPda(
          {
            subscriptionAuthority: expectedAuthorityAddress,
            delegator: address(collection.subscriberWallet),
            delegatee: address(collection.collectorAddress),
            nonce: collection.delegationNonce
          },
          { programAddress: address(collection.programId) }
        );
        if (
          expectedDelegationAddress !== collection.delegationAddress ||
          authority.user !== collection.subscriberWallet ||
          authority.tokenMint !== collection.tokenMint ||
          delegation.header.delegator !== collection.subscriberWallet ||
          delegation.header.delegatee !== collection.collectorAddress ||
          delegation.subscriptionAuthority !== collection.authorityAddress ||
          delegation.mint !== collection.tokenMint ||
          delegation.amountPerPeriod !== collection.amountAtomic ||
          delegation.periodLengthS !== BigInt(collection.periodSeconds)
        ) {
          return retry("subscription_delegation_terms_mismatch");
        }
        if (authority.initId !== delegation.header.initId) {
          return retry("subscription_authority_init_mismatch");
        }
        const tokenAccount = getTokenDecoder().decode(
          tokenAccountInfo.data.subarray(0, getTokenSize())
        );
        if (
          tokenAccount.owner !== collection.subscriberWallet ||
          tokenAccount.mint !== collection.tokenMint ||
          tokenAccount.state !== AccountState.Initialized
        ) {
          return retry("subscription_token_account_mismatch");
        }
        if (
          !isSome(tokenAccount.delegate) ||
          tokenAccount.delegate.value !== collection.authorityAddress ||
          tokenAccount.delegatedAmount < collection.amountAtomic
        ) {
          return retry("subscription_delegated_allowance_mismatch");
        }
        if (delegation.expiryTs <= BigInt(Math.floor(Date.now() / 1000))) {
          return { state: "revoked", failureCode: "subscription_delegation_expired" };
        }
        if (
          collection.creatorAmountAtomic +
            collection.platformAmountAtomic +
            collection.allocationAmountAtomic !==
          collection.amountAtomic
        ) {
          return retry("subscription_split_mismatch");
        }
        if (collection.allocationAmountAtomic > 0n) {
          return retry("subscription_allocation_destination_unavailable");
        }
        if (
          (collection.creatorAmountAtomic > 0n && !collection.creatorReceiverWallet) ||
          !collection.platformReceiverWallet ||
          collection.platformReceiverWallet !== input.platformWallet
        ) {
          return retry("platform_receiver_wallet_missing");
        }

        // The exact account boundary is retained locally, but recurring debit
        // broadcast remains deliberately unavailable until release approval.
        return retry("subscription_collection_provider_not_configured");
      } catch {
        return retry("subscription_collection_rpc_failed");
      }
    }
  };
}

function hasCollectionEvidence(
  transaction: Awaited<ReturnType<Connection["getTransaction"]>>,
  collection: DueSubscriptionCollection
) {
  if (
    !transaction ||
    transaction.meta?.err ||
    !collection.broadcastSignature ||
    !collection.broadcastTransactionBase64
  ) return false;
  let prepared: Transaction;
  try {
    prepared = Transaction.from(
      Buffer.from(collection.broadcastTransactionBase64, "base64")
    );
  } catch {
    return false;
  }
  const preparedSignature = prepared.signatures[0]?.signature;
  if (
    !preparedSignature ||
    bs58.encode(preparedSignature) !== collection.broadcastSignature ||
    !Buffer.from(prepared.serializeMessage()).equals(
      Buffer.from(transaction.transaction.message.serialize())
    )
  ) {
    return false;
  }
  const keys = transaction.transaction.message.getAccountKeys().staticAccountKeys;
  const expectedMemo = `wevid:subscription-collection:${collection.collectionId}`;
  const hasProgram = transaction.transaction.message.compiledInstructions.some(
    (instruction) => keys[instruction.programIdIndex]?.toBase58() === collection.programId
  );
  const hasMemo = transaction.transaction.message.compiledInstructions.some((instruction) => {
    if (keys[instruction.programIdIndex]?.toBase58() !== "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr") {
      return false;
    }
    return Buffer.from(instruction.data).toString("utf8") === expectedMemo;
  });
  return hasProgram && hasMemo && keys[0]?.toBase58() === collection.collectorAddress;
}

function retry(failureCode: SubscriptionCollectionFailureCode): SubscriptionCollectionOutcome {
  return {
    state: "failed",
    failureCode,
    retryAt: new Date(Date.now() + 5 * 60 * 1000)
  };
}

export function createPostgresSubscriptionCollectionRepository(
  input?: string | { databaseUrl?: string; sql?: postgres.Sql }
): SubscriptionCollectionRepository {
  const databaseUrl = typeof input === "string" ? input : input?.databaseUrl;
  const injectedSql = typeof input === "string" ? undefined : input?.sql;
  if (!databaseUrl && !injectedSql) {
    return {
      async expireCancelledDueSubscriptions() {
        return 0;
      },
      async leaseDueCollections() {
        return [];
      },
      async authorizeCollectionBroadcast() {
        return false;
      },
      async recordPreparedCollectionBroadcast() {
        return false;
      },
      async recordCollectionOutcome() {
        return false;
      }
    };
  }

  const ownsSql = !injectedSql;
  const sql = injectedSql ?? postgres(databaseUrl as string, {
      max: 3,
      idle_timeout: 20,
      prepare: false
    });

  return {
    async expireCancelledDueSubscriptions(input) {
      const rows = await sql<{ id: string }[]>`
        update subscriptions s
        set
          state = 'cancelled',
          next_collection_at = null,
          updated_at = now()
        where s.id in (
          select due.id
          from subscriptions due
          where due.cancel_at_period_end = true
            and due.state in ('active', 'renewal_pending', 'grace_period', 'suspended')
            and due.current_period_ends_at <= ${input.now}
          order by due.current_period_ends_at asc
          limit ${input.limit}
          for update skip locked
        )
        returning s.id
      `;

      if (rows.length > 0) {
        for (const row of rows) {
          await sql`
            insert into subscription_events (
              id,
              subscription_id,
              actor_user_id,
              action,
              metadata
            )
            values (
              ${randomUUID()},
              ${row.id},
              null,
              'subscription.cancelled_at_period_end',
              '{}'::jsonb
            )
          `;
        }
      }

      return rows.length;
    },

    async leaseDueCollections(input) {
      return sql.begin(async (transaction) => {
        const exhausted = await transaction<{ subscription_id: string }[]>`
          update subscription_collections collection
          set
            state = 'dead_letter',
            failure_code = coalesce(failure_code, 'collection_attempt_limit_exceeded'),
            lease_token = null,
            leased_until = null
          where collection.state in ('due', 'failed', 'processing')
            and collection.attempt_count >= ${input.maxAttempts}
            and collection.broadcast_signature is null
            and (
              collection.state <> 'processing'
              or collection.leased_until is null
              or collection.leased_until <= ${input.now}
            )
          returning collection.subscription_id
        `;

        if (exhausted.length > 0) {
          await transaction`
            update subscriptions
            set
              state = 'suspended',
              next_collection_at = null,
              failure_reason = 'collection_attempt_limit_exceeded',
              updated_at = now()
            where id in ${transaction(exhausted.map((row) => row.subscription_id))}
          `;
        }

        const policySuspended = await transaction<Array<{
          subscription_id: string;
          effective_kyc_mode: string;
          policy_version: string;
          decision_reason: string;
        }>>`
          with blocked as (
            select
              s.id as subscription_id,
              policy.effective_kyc_mode,
              policy.policy_version,
              policy.decision_reason
            from subscriptions s
            join subscription_billing_acceptances acceptance
              on acceptance.subscription_id = s.id
            cross join lateral private.resolve_recipient_monetisation_policy(
              s.creator_user_id, 'creator_subscription'
            ) policy
            where s.scope = 'creator'
              and s.state in ('active', 'renewal_pending', 'grace_period')
              and s.cancel_at_period_end = false
              and s.next_collection_at <= ${input.now}
              and policy.kyc_required
              and not coalesce((
                select verification.status = 'valid'
                  and verification.assurance_level in ('high', 'documentary')
                  and (verification.expires_at is null or verification.expires_at > ${input.now})
                from private.current_verification_decision(
                  'user', s.creator_user_id, 'creator_kyc'
                ) verification
              ), false)
            order by s.next_collection_at asc
            limit ${input.limit}
            for update of s skip locked
          )
          update subscriptions subscription
          set
            state = 'suspended',
            next_collection_at = null,
            failure_reason = 'recipient_verification_required',
            updated_at = now()
          from blocked
          where subscription.id = blocked.subscription_id
          returning
            subscription.id as subscription_id,
            blocked.effective_kyc_mode,
            blocked.policy_version,
            blocked.decision_reason
        `;

        for (const row of policySuspended) {
          await transaction`
            insert into subscription_events (
              id, subscription_id, actor_user_id, action, metadata
            ) values (
              ${randomUUID()}, ${row.subscription_id}, null,
              'subscription.collection_policy_suspended',
              ${transaction.json({
                kycRequired: true,
                kycPolicyMode: row.effective_kyc_mode,
                kycPolicyVersion: row.policy_version,
                kycDecisionReason: row.decision_reason
              })}
            )
          `;
        }

        const dueRows = await transaction<DueSubscriptionRow[]>`
          select
            s.id as subscription_id,
            s.subscriber_user_id,
            s.subscriber_wallet,
            s.plan_id,
            acceptance.amount_minor,
            acceptance.creator_amount_atomic,
            acceptance.platform_amount_atomic as platform_fee_amount_atomic,
            acceptance.allocation_amount_atomic,
            acceptance.currency,
            acceptance.period_days,
            acceptance.amount_atomic,
            acceptance.period_seconds,
            coalesce(
              pending_collection.period_starts_at,
              s.current_period_ends_at,
              s.verified_at,
              s.start_at,
              s.created_at
            ) as period_starts_at,
            coalesce(
              pending_collection.period_ends_at,
              coalesce(s.current_period_ends_at, s.verified_at, s.start_at, s.created_at)
                + (acceptance.period_seconds || ' seconds')::interval
            ) as period_ends_at,
            s.authority_address,
            s.delegation_address,
            s.subscriber_token_account,
            s.collector_address,
            acceptance.token_mint,
            acceptance.token_program,
            acceptance.provider,
            acceptance.program_id,
            acceptance.creator_receiver_wallet,
            acceptance.platform_receiver_wallet,
            acceptance.delegation_nonce,
            acceptance.asset_decimals,
            acceptance.scope,
            acceptance.creator_user_id,
            acceptance.terms_version,
            acceptance.withdrawal_waiver_version,
            acceptance.accepted_at,
            acceptance.solana_network,
            coalesce(policy.kyc_required, false) as recipient_kyc_required,
            coalesce(policy.effective_kyc_mode, 'disabled') as recipient_kyc_policy_mode,
            coalesce(policy.policy_version, 'platform-plan-not-applicable') as recipient_kyc_policy_version,
            coalesce(policy.decision_reason, 'platform_plan_not_applicable') as recipient_kyc_decision_reason
          from subscriptions s
          join subscription_billing_acceptances acceptance
            on acceptance.subscription_id = s.id
          left join lateral private.resolve_recipient_monetisation_policy(
            s.creator_user_id, 'creator_subscription'
          ) policy on s.scope = 'creator'
          left join lateral (
            select
              collection.period_starts_at,
              collection.period_ends_at
            from subscription_collections collection
            where collection.subscription_id = s.id
              and collection.state in ('due', 'processing', 'reconciling', 'failed')
            order by collection.created_at desc, collection.id desc
            limit 1
          ) pending_collection on true
          where s.state in ('active', 'renewal_pending', 'grace_period')
            and s.renewal_mode = 'delegated_solana_subscription'
            and s.cancel_at_period_end = false
            and (s.expires_at is null or s.expires_at > ${input.now})
            and acceptance.provider = 'official_solana_subscription_program'
            and acceptance.currency <> 'SOL'
            and s.next_collection_at <= ${input.now}
            and s.authority_address is not null
            and s.subscriber_wallet is not null
            and s.delegation_address is not null
            and s.subscriber_token_account is not null
            and s.collector_address is not null
            and s.plan_id = acceptance.plan_id
            and s.scope = acceptance.scope
            and s.subscriber_user_id = acceptance.accepted_by_user_id
            and s.creator_user_id is not distinct from acceptance.creator_user_id
            and s.provider = acceptance.provider
            and s.program_id = acceptance.program_id
            and s.token_mint = acceptance.token_mint
            and s.amount_atomic = acceptance.amount_atomic
            and s.period_seconds = acceptance.period_seconds
            and s.collector_address = acceptance.collector_address
            and s.delegation_nonce = acceptance.delegation_nonce
            and (
              s.scope = 'platform'
              or not policy.kyc_required
              or coalesce((
                select verification.status = 'valid'
                  and verification.assurance_level in ('high', 'documentary')
                  and (verification.expires_at is null or verification.expires_at > ${input.now})
                from private.current_verification_decision(
                  'user', s.creator_user_id, 'creator_kyc'
                ) verification
              ), false)
            )
          order by s.next_collection_at asc
          limit ${input.limit}
          for update of s skip locked
        `;

        const leased: DueSubscriptionCollection[] = [];

        for (const row of dueRows) {
          const collectionId = randomUUID();
          const idempotencyKey = `${row.subscription_id}:${row.period_starts_at.toISOString()}`;
          await transaction`
            insert into subscription_collections (
              id,
              subscription_id,
              period_starts_at,
              period_ends_at,
              amount_minor,
              amount_atomic,
              creator_amount_atomic,
              platform_fee_amount_atomic,
              allocation_amount_atomic,
              creator_receiver_wallet,
              platform_receiver_wallet,
              allocation_receiver_wallet,
              recipient_kyc_required,
              recipient_kyc_policy_mode,
              recipient_kyc_policy_version,
              recipient_kyc_decision_reason,
              currency,
              state,
              collector_wallet,
              idempotency_key,
              due_at,
              next_attempt_at
            )
            values (
              ${collectionId},
              ${row.subscription_id},
              ${row.period_starts_at},
              ${row.period_ends_at},
              ${row.amount_minor},
              ${row.amount_atomic},
              ${row.creator_amount_atomic},
              ${row.platform_fee_amount_atomic},
              ${row.allocation_amount_atomic},
              ${row.creator_receiver_wallet},
              ${row.platform_receiver_wallet},
              null,
              ${row.recipient_kyc_required},
              ${row.recipient_kyc_policy_mode},
              ${row.recipient_kyc_policy_version},
              ${row.recipient_kyc_decision_reason},
              ${row.currency},
              'due',
              ${row.collector_address},
              ${idempotencyKey},
              ${input.now},
              ${input.now}
            )
            on conflict (subscription_id, period_starts_at) do nothing
          `;
          const leaseToken = randomUUID();
          const leasedUntil = new Date(input.now.getTime() + input.leaseDurationMs);
          const collectionRows = await transaction<CollectionLeaseRow[]>`
            update subscription_collections collection
            set
              state = 'processing',
              lease_token = ${leaseToken},
              leased_until = ${leasedUntil},
              attempt_count = case
                when collection.broadcast_signature is null then collection.attempt_count + 1
                else collection.attempt_count
              end,
              attempted_at = ${input.now},
              submitted_at = coalesce(collection.submitted_at, ${input.now}),
              failure_code = null
            where collection.subscription_id = ${row.subscription_id}
              and collection.period_starts_at = ${row.period_starts_at}
              and (
                collection.broadcast_signature is not null
                or collection.attempt_count < ${input.maxAttempts}
              )
              and (
                (
                  collection.state in ('due', 'reconciling', 'failed')
                  and collection.next_attempt_at <= ${input.now}
                )
                or (
                  collection.state = 'processing'
                  and (collection.leased_until is null or collection.leased_until <= ${input.now})
                )
              )
            returning
              collection.id,
              collection.state,
              collection.attempt_count,
              collection.idempotency_key,
              collection.broadcast_signature,
              collection.broadcast_transaction_base64,
              collection.broadcast_blockhash,
              collection.broadcast_last_valid_block_height
          `;
          const collection = collectionRows[0];

          if (!collection || collection.state !== "processing") {
            continue;
          }

          await transaction`
            update subscriptions
            set
              state = 'renewal_pending',
              updated_at = now()
            where id = ${row.subscription_id}
          `;

          await insertCollectionEvent(transaction, {
            subscriptionId: row.subscription_id,
            collectionId: collection.id,
            action: collection.attempt_count === 1
              ? "subscription.collection_submitted"
              : "subscription.collection_released",
            metadata: {
              planId: row.plan_id,
              attemptCount: collection.attempt_count,
              leaseToken,
              kycRequired: row.recipient_kyc_required,
              kycPolicyMode: row.recipient_kyc_policy_mode,
              kycPolicyVersion: row.recipient_kyc_policy_version,
              kycDecisionReason: row.recipient_kyc_decision_reason
            }
          });

          leased.push({
            collectionId: collection.id,
            leaseToken,
            attemptCount: collection.attempt_count,
            providerIdempotencyKey: collection.idempotency_key ?? idempotencyKey,
            subscriptionId: row.subscription_id,
            subscriberUserId: row.subscriber_user_id,
            subscriberWallet: row.subscriber_wallet,
            planId: row.plan_id,
            amountMinor: BigInt(row.amount_minor),
            amountAtomic: BigInt(row.amount_atomic),
            creatorAmountAtomic: BigInt(row.creator_amount_atomic),
            platformAmountAtomic: BigInt(row.platform_fee_amount_atomic),
            allocationAmountAtomic: BigInt(row.allocation_amount_atomic),
            currency: row.currency,
            periodStartsAt: row.period_starts_at,
            periodEndsAt: row.period_ends_at,
            authorityAddress: row.authority_address,
            delegationAddress: row.delegation_address,
            subscriberTokenAccount: row.subscriber_token_account,
            collectorAddress: row.collector_address,
            tokenMint: row.token_mint,
            tokenProgram: row.token_program,
            provider: row.provider,
            programId: row.program_id,
            periodSeconds: Number(row.period_seconds),
            delegationNonce: Number(row.delegation_nonce),
            assetDecimals: row.asset_decimals,
            scope: row.scope,
            creatorUserId: row.creator_user_id,
            creatorReceiverWallet: row.creator_receiver_wallet,
            platformReceiverWallet: row.platform_receiver_wallet,
            termsVersion: row.terms_version,
            withdrawalWaiverVersion: row.withdrawal_waiver_version,
            acceptedAt: row.accepted_at,
            solanaNetwork: row.solana_network,
            broadcastSignature: collection.broadcast_signature,
            broadcastTransactionBase64: collection.broadcast_transaction_base64,
            broadcastBlockhash: collection.broadcast_blockhash,
            broadcastLastValidBlockHeight:
              collection.broadcast_last_valid_block_height === null
                ? null
                : Number(collection.broadcast_last_valid_block_height),
            recipientKycRequired: row.recipient_kyc_required,
            recipientKycPolicyMode: row.recipient_kyc_policy_mode,
            recipientKycPolicyVersion: row.recipient_kyc_policy_version,
            recipientKycDecisionReason: row.recipient_kyc_decision_reason
          });
        }

        return leased;
      });
    },

    async authorizeCollectionBroadcast(input) {
      return sql.begin(async (transaction) => {
        const subscriptions = await transaction<Array<{
          state: string;
          cancel_at_period_end: boolean;
          cancelled_at: Date | null;
          revoked_at: Date | null;
        }>>`
          select state, cancel_at_period_end, cancelled_at, revoked_at
          from subscriptions
          where id = ${input.subscriptionId}
          for update
        `;
        const subscription = subscriptions[0];
        if (
          !subscription ||
          !["active", "renewal_pending", "grace_period"].includes(subscription.state) ||
          subscription.cancel_at_period_end ||
          subscription.cancelled_at ||
          subscription.revoked_at
        ) {
          return false;
        }

        const collections = await transaction<Array<{
          state: string;
          lease_token: string | null;
          broadcast_signature: string | null;
        }>>`
          select state, lease_token, broadcast_signature
          from subscription_collections
          where id = ${input.collectionId}
            and subscription_id = ${input.subscriptionId}
          for update
        `;
        const collection = collections[0];
        if (
          !collection ||
          collection.state !== "processing" ||
          collection.lease_token !== input.leaseToken ||
          collection.broadcast_signature !== null
        ) {
          return false;
        }

        const rows = await transaction<{ id: string }[]>`
          update subscription_collections
          set
            broadcast_started_at = now(),
            broadcast_lease_token = ${input.leaseToken}
          where id = ${input.collectionId}
            and subscription_id = ${input.subscriptionId}
            and state = 'processing'
            and lease_token = ${input.leaseToken}
            and broadcast_signature is null
          returning id
        `;
        return rows.length === 1;
      });
    },

    async recordPreparedCollectionBroadcast(input) {
      return sql.begin(async (transaction) => {
        const subscriptions = await transaction<Array<{
          state: string;
          cancel_at_period_end: boolean;
          cancelled_at: Date | null;
          revoked_at: Date | null;
        }>>`
          select state, cancel_at_period_end, cancelled_at, revoked_at
          from subscriptions
          where id = ${input.subscriptionId}
          for update
        `;
        const subscription = subscriptions[0];
        if (
          !subscription ||
          !["active", "renewal_pending", "grace_period"].includes(subscription.state) ||
          subscription.cancel_at_period_end ||
          subscription.cancelled_at ||
          subscription.revoked_at
        ) {
          return false;
        }

        const rows = await transaction<{ id: string }[]>`
          update subscription_collections
          set
            broadcast_signature = ${input.prepared.signature},
            broadcast_transaction_base64 = ${input.prepared.transactionBase64},
            broadcast_blockhash = ${input.prepared.blockhash},
            broadcast_last_valid_block_height = ${input.prepared.lastValidBlockHeight},
            broadcast_prepared_at = now()
          where id = ${input.collectionId}
            and subscription_id = ${input.subscriptionId}
            and state = 'processing'
            and lease_token = ${input.leaseToken}
            and broadcast_lease_token = ${input.leaseToken}
            and broadcast_started_at is not null
            and broadcast_signature is null
          returning id
        `;
        return rows.length === 1;
      });
    },

    async recordCollectionOutcome(input) {
      return sql.begin(async (transaction) => {
        // Match cancellation and broadcast fencing lock order: subscription
        // first, then its collection. A chain outcome and a user cancellation
        // therefore arbitrate on one row lock instead of deadlocking or
        // observing half of each other's transition.
        await transaction`
          select id
          from subscriptions
          where id = ${input.subscriptionId}
          for update
        `;

        if (input.outcome.state === "confirmed") {
          const rows = await transaction<{ period_starts_at: Date; period_ends_at: Date }[]>`
            update subscription_collections
            set
              state = 'confirmed',
              collection_signature = ${input.outcome.collectionSignature},
              failure_code = null,
              confirmed_at = now(),
              lease_token = null,
              leased_until = null
            where id = ${input.collectionId}
              and subscription_id = ${input.subscriptionId}
              and state = 'processing'
              and lease_token = ${input.leaseToken}
              and broadcast_signature = ${input.outcome.collectionSignature}
            returning period_starts_at, period_ends_at
          `;
          const row = rows[0];
          if (!row) return false;

          await transaction`
            update subscriptions
            set
              state = case
                when cancelled_at is not null or state = 'cancelled' then 'cancelled'
                when revoked_at is not null or state = 'revoked' then 'revoked'
                else 'active'
              end,
              current_period_starts_at = case
                when cancelled_at is null and revoked_at is null then ${row.period_starts_at}
                else current_period_starts_at
              end,
              current_period_ends_at = case
                when cancelled_at is null and revoked_at is null then ${row.period_ends_at}
                else current_period_ends_at
              end,
              next_collection_at = case
                when cancelled_at is null and revoked_at is null then ${row.period_ends_at}
                else null
              end,
              failure_reason = null,
              updated_at = now()
            where id = ${input.subscriptionId}
          `;

          const immutableHash = createHash("sha256")
            .update(`subscription_collection_settled:${input.collectionId}`)
            .digest("hex");
          const receiptNumber = `VEEL-SUB-${input.collectionId
            .replaceAll("-", "")
            .slice(0, 20)
            .toUpperCase()}`;
          await transaction`
            with finance as (
              select
                collection.id as collection_id,
                collection.amount_minor as accepted_price_minor,
                collection.amount_atomic,
                collection.creator_amount_atomic,
                collection.platform_fee_amount_atomic,
                collection.allocation_amount_atomic,
                collection.currency,
                subscription.subscriber_user_id,
                subscription.creator_user_id,
                subscription.scope,
                acceptance.asset_decimals,
                acceptance.solana_network,
                acceptance.terms_version,
                acceptance.withdrawal_waiver_version,
                acceptance.accepted_at
              from subscription_collections collection
              join subscriptions subscription on subscription.id = collection.subscription_id
              join subscription_billing_acceptances acceptance
                on acceptance.subscription_id = subscription.id
              where collection.id = ${input.collectionId}
                and collection.subscription_id = ${input.subscriptionId}
                and collection.state = 'confirmed'
                and collection.collection_signature = ${input.outcome.collectionSignature}
            ),
            receipt as (
              insert into receipts (
                id,
                receipt_number,
                buyer_user_id,
                seller_user_id,
                subscription_collection_id,
                product_type,
                gross_amount_minor,
                currency
              )
              select
                ${randomUUID()},
                ${receiptNumber},
                subscriber_user_id,
                creator_user_id,
                collection_id,
                case when scope = 'creator' then 'creator_subscription' else 'platform_subscription' end,
                amount_atomic,
                currency
              from finance
              on conflict (subscription_collection_id)
                where subscription_collection_id is not null
              do update set state = receipts.state
              returning id
            ),
            receipt_line as (
              insert into receipt_lines (
                id, receipt_id, line_type, description, amount_minor, currency
              )
              select
                ${randomUUID()},
                receipt.id,
                'purchase_total',
                'Recurring subscription period',
                finance.amount_atomic,
                finance.currency
              from finance
              join receipt on true
              where not exists (
                select 1
                from receipt_lines existing
                where existing.receipt_id = receipt.id
                  and existing.line_type = 'purchase_total'
              )
              returning id
            ),
            wallet_record as (
              insert into wallet_transaction_records (
                id,
                user_id,
                wallet_id,
                subscription_collection_id,
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
                finance.subscriber_user_id,
                wallet.id,
                finance.collection_id,
                case
                  when finance.solana_network = 'mainnet-beta' then 'solana_mainnet'
                  else 'solana_devnet'
                end,
                'outgoing',
                finance.amount_atomic,
                finance.currency,
                'confirmed',
                'subscription_collection',
                ${input.outcome.collectionSignature},
                finance.collection_id::text,
                now(),
                now()
              from finance
              left join lateral (
                select id
                from wallets
                where user_id = finance.subscriber_user_id
                order by is_primary desc, created_at asc
                limit 1
              ) wallet on true
              on conflict (subscription_collection_id)
                where subscription_collection_id is not null
              do update set
                state = excluded.state,
                confirmed_at = coalesce(wallet_transaction_records.confirmed_at, excluded.confirmed_at),
                updated_at = now()
              returning id
            ),
            ledger as (
              insert into compliance_ledger_entries (
                id,
                event_type,
                product_type,
                settlement_model,
                seller_user_id,
                buyer_user_id,
                receipt_id,
                subscription_collection_id,
                gross_amount_minor,
                platform_fee_minor,
                creator_net_amount_minor,
                tax_amount_minor,
                currency,
                fiat_currency,
                seller_of_record,
                metadata,
                immutable_hash
              )
              select
                ${randomUUID()},
                'payment_settled',
                case when finance.scope = 'creator' then 'creator_subscription' else 'platform_subscription' end,
                case when finance.scope = 'creator' then 'user_to_creator_split' else 'user_to_platform' end,
                finance.creator_user_id,
                finance.subscriber_user_id,
                receipt.id,
                finance.collection_id,
                finance.amount_atomic,
                finance.platform_fee_amount_atomic,
                case
                  when finance.scope = 'creator'
                    then finance.creator_amount_atomic
                  else null
                end,
                null,
                finance.currency,
                'USD',
                case when finance.scope = 'creator' then 'creator' else 'veel' end,
                jsonb_build_object(
                  'confirmationVersion', 'subscription-collection-confirmation-v2',
                  'settlementSignature', ${input.outcome.collectionSignature}::text,
                  'acceptedPriceMinor', finance.accepted_price_minor,
                  'amountAtomic', finance.amount_atomic,
                  'creatorAmountAtomic', finance.creator_amount_atomic,
                  'platformFeeAmountAtomic', finance.platform_fee_amount_atomic,
                  'allocationAmountAtomic', finance.allocation_amount_atomic,
                  'assetDecimals', finance.asset_decimals,
                  'termsVersion', finance.terms_version,
                  'withdrawalWaiverVersion', finance.withdrawal_waiver_version,
                  'acceptedAt', finance.accepted_at
                ),
                ${immutableHash}
              from finance
              join receipt on true
              on conflict (subscription_collection_id)
                where subscription_collection_id is not null
              do nothing
              returning id
            ),
            outbox as (
              insert into subscription_finance_outbox_events (
                id,
                subscription_collection_id,
                event_type,
                amount_minor,
                amount_atomic,
                asset_decimals,
                currency,
                collection_signature,
                terms_version
              )
              select
                ${randomUUID()},
                finance.collection_id,
                'subscription_collection_confirmed',
                finance.accepted_price_minor,
                finance.amount_atomic,
                finance.asset_decimals,
                finance.currency,
                ${input.outcome.collectionSignature},
                finance.terms_version
              from finance
              on conflict (subscription_collection_id) do nothing
              returning id
            )
            select
              (select count(*) from receipt),
              (select count(*) from receipt_line),
              (select count(*) from wallet_record),
              (select count(*) from ledger),
              (select count(*) from outbox)
          `;

          await insertCollectionEvent(transaction, {
            subscriptionId: input.subscriptionId,
            collectionId: input.collectionId,
            action: "subscription.collection_confirmed",
            metadata: {
              collectionSignature: input.outcome.collectionSignature
            }
          });
          return true;
        }

        if (input.outcome.state === "reconciling") {
          const rows = await transaction<{ id: string }[]>`
            update subscription_collections
            set
              state = 'reconciling',
              failure_code = ${input.outcome.failureCode},
              next_attempt_at = ${input.outcome.retryAt},
              lease_token = null,
              leased_until = null
            where id = ${input.collectionId}
              and subscription_id = ${input.subscriptionId}
              and state = 'processing'
              and lease_token = ${input.leaseToken}
              and broadcast_signature is not null
            returning id
          `;
          if (!rows[0]) return false;
          await transaction`
            update subscriptions
            set
              state = case
                when cancelled_at is not null or state = 'cancelled' then 'cancelled'
                when revoked_at is not null or state = 'revoked' then 'revoked'
                else 'grace_period'
              end,
              next_collection_at = case
                when cancelled_at is not null or revoked_at is not null
                  or state in ('cancelled', 'revoked') then null
                else ${input.outcome.retryAt}
              end,
              failure_reason = ${input.outcome.failureCode},
              updated_at = now()
            where id = ${input.subscriptionId}
          `;
          await insertCollectionEvent(transaction, {
            subscriptionId: input.subscriptionId,
            collectionId: input.collectionId,
            action: "subscription.collection_reconciliation_deferred",
            metadata: {
              failureCode: input.outcome.failureCode,
              retryAt: input.outcome.retryAt.toISOString()
            }
          });
          return true;
        }

        if (input.outcome.state === "cancelled") {
          const rows = await transaction<{ id: string }[]>`
            update subscription_collections
            set
              state = 'cancelled',
              failure_code = ${input.outcome.failureCode},
              lease_token = null,
              leased_until = null
            where id = ${input.collectionId}
              and subscription_id = ${input.subscriptionId}
              and state = 'processing'
              and lease_token = ${input.leaseToken}
              and broadcast_signature is null
            returning id
          `;
          return rows.length === 1;
        }

        if (input.outcome.state === "revoked") {
          const rows = await transaction<{ id: string }[]>`
            update subscription_collections
            set
              state = 'failed',
              failure_code = ${input.outcome.failureCode},
              lease_token = null,
              leased_until = null
            where id = ${input.collectionId}
              and subscription_id = ${input.subscriptionId}
              and state = 'processing'
              and lease_token = ${input.leaseToken}
              and broadcast_signature is null
            returning id
          `;
          if (rows.length === 0) return false;
          await transaction`
            update subscriptions
            set
              state = case when cancelled_at is not null then state else 'revoked' end,
              revoked_at = case when cancelled_at is null then coalesce(revoked_at, now()) else revoked_at end,
              next_collection_at = null,
              failure_reason = ${input.outcome.failureCode},
              updated_at = now()
            where id = ${input.subscriptionId}
          `;
          await insertCollectionEvent(transaction, {
            subscriptionId: input.subscriptionId,
            collectionId: input.collectionId,
            action: "subscription.delegation_revoked",
            metadata: {
              failureCode: input.outcome.failureCode
            }
          });
          return true;
        }

        const rows = await transaction<Array<{
          attempt_count: number;
          broadcast_signature: string | null;
          state: "reconciling" | "dead_letter" | "failed";
        }>>`
          update subscription_collections
          set
            state = case
              when broadcast_signature is not null then 'reconciling'
              when attempt_count >= ${input.maxAttempts} then 'dead_letter'
              else 'failed'
            end,
            failure_code = ${input.outcome.failureCode},
            next_attempt_at = ${input.outcome.retryAt},
            lease_token = null,
            leased_until = null
          where id = ${input.collectionId}
            and subscription_id = ${input.subscriptionId}
            and state = 'processing'
            and lease_token = ${input.leaseToken}
          returning attempt_count, broadcast_signature, state
        `;
        const row = rows[0];
        if (!row) return false;
        await transaction`
          update subscriptions
          set
            state = case
              when cancelled_at is not null or state = 'cancelled' then 'cancelled'
              when revoked_at is not null or state = 'revoked' then 'revoked'
              else ${
                row.state === "dead_letter"
                  ? "suspended"
                  : "grace_period"
              }
            end,
            next_collection_at = case
              when cancelled_at is not null or revoked_at is not null
                or state in ('cancelled', 'revoked') then null
              else ${
                row.state === "dead_letter"
                  ? null
                  : input.outcome.retryAt
              }
            end,
            failure_reason = ${input.outcome.failureCode},
            updated_at = now()
          where id = ${input.subscriptionId}
        `;
        await insertCollectionEvent(transaction, {
          subscriptionId: input.subscriptionId,
          collectionId: input.collectionId,
          action: row.state === "reconciling"
            ? "subscription.collection_reconciliation_deferred"
            : "subscription.collection_failed",
          metadata: {
            failureCode: input.outcome.failureCode,
            retryAt: input.outcome.retryAt.toISOString(),
            attemptCount: row.attempt_count,
            deadLettered: row.state === "dead_letter",
            signedEvidencePending: row.state === "reconciling"
          }
        });
        return true;
      });
    },

    async close() {
      if (ownsSql) await sql.end({ timeout: 5 });
    }
  };
}

interface DueSubscriptionRow {
  subscription_id: string;
  subscriber_user_id: string;
  subscriber_wallet: string;
  plan_id: string;
  amount_minor: string | number;
  amount_atomic: string | number;
  creator_amount_atomic: string | number;
  platform_fee_amount_atomic: string | number;
  allocation_amount_atomic: string | number;
  currency: "SOL" | "USDC";
  period_days: number;
  period_seconds: string | number;
  period_starts_at: Date;
  period_ends_at: Date;
  authority_address: string;
  delegation_address: string;
  subscriber_token_account: string;
  collector_address: string;
  token_mint: string;
  token_program: "spl_token" | "token_2022";
  provider: string;
  program_id: string;
  delegation_nonce: string | number;
  asset_decimals: number;
  scope: "platform" | "creator";
  creator_user_id: string | null;
  creator_receiver_wallet: string | null;
  platform_receiver_wallet: string;
  terms_version: string;
  withdrawal_waiver_version: string;
  accepted_at: Date;
  solana_network: "devnet" | "mainnet-beta";
  recipient_kyc_required: boolean;
  recipient_kyc_policy_mode: "disabled" | "risk_based" | "required";
  recipient_kyc_policy_version: string;
  recipient_kyc_decision_reason: string;
}

interface CollectionLeaseRow {
  id: string;
  state: string;
  attempt_count: number;
  idempotency_key: string | null;
  broadcast_signature: string | null;
  broadcast_transaction_base64: string | null;
  broadcast_blockhash: string | null;
  broadcast_last_valid_block_height: string | number | null;
}

async function insertCollectionEvent(
  transaction: postgres.TransactionSql,
  input: {
    subscriptionId: string;
    collectionId: string;
    action: string;
    metadata: Record<string, unknown>;
  }
): Promise<void> {
  await transaction`
    insert into subscription_events (
      id,
      subscription_id,
      actor_user_id,
      action,
      collection_id,
      metadata
    )
    values (
      ${randomUUID()},
      ${input.subscriptionId},
      null,
      ${input.action},
      ${input.collectionId},
      ${transaction.json(input.metadata as postgres.JSONValue)}
    )
  `;
}
