import { randomUUID } from "node:crypto";
import { address, createNoopSigner, type Instruction as KitInstruction } from "@solana/kit";
import { getTransferRecurringOverlayInstructionAsync } from "@solana/subscriptions";
import {
  TOKEN_PROGRAM_ADDRESS,
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstructionAsync
} from "@solana-program/token";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction
} from "@solana/web3.js";
import bs58 from "bs58";
import postgres from "postgres";

const token2022ProgramAddress = address("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

export type SubscriptionCollectionOutcome =
  | {
      state: "confirmed";
      collectionSignature: string;
    }
  | {
      state: "failed";
      failureCode: string;
      retryAt: Date;
    }
  | {
      state: "revoked";
      failureCode: string;
    };

export type SubscriptionCollectionReconciliation =
  | SubscriptionCollectionOutcome
  | { state: "not_found" }
  | { state: "unknown"; failureCode: string; retryAt: Date };

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
  creatorReceiverWallet: string | null;
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
  recordCollectionOutcome(input: {
    collectionId: string;
    subscriptionId: string;
    leaseToken: string;
    maxAttempts: number;
    outcome: SubscriptionCollectionOutcome;
  }): Promise<void>;
  close?(): Promise<void>;
}

export interface SubscriptionCollectionProvider {
  reconcile(input: DueSubscriptionCollection): Promise<SubscriptionCollectionReconciliation>;
  collect(input: DueSubscriptionCollection): Promise<SubscriptionCollectionOutcome>;
}

export interface ProcessSubscriptionCollectionsResult {
  expired: number;
  leased: number;
  confirmed: number;
  failed: number;
  revoked: number;
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
    revoked: 0
  };

  for (const dueCollection of dueCollections) {
    const reconciliation = dueCollection.attemptCount > 1
      ? await input.provider.reconcile(dueCollection)
      : { state: "not_found" as const };
    const outcome =
      reconciliation.state === "confirmed" || reconciliation.state === "failed" || reconciliation.state === "revoked"
        ? reconciliation
        : reconciliation.state === "unknown"
          ? {
              state: "failed" as const,
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
          : await input.provider.collect(dueCollection);
    await input.repository.recordCollectionOutcome({
      collectionId: dueCollection.collectionId,
      subscriptionId: dueCollection.subscriptionId,
      leaseToken: dueCollection.leaseToken,
      maxAttempts,
      outcome
    });

    if (outcome.state === "confirmed") result.confirmed += 1;
    else if (outcome.state === "revoked") result.revoked += 1;
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
      try {
        const signatures = await connection.getSignaturesForAddress(
          new PublicKey(collection.delegationAddress),
          { limit: 25 },
          "finalized"
        );
        for (const candidate of signatures) {
          if (candidate.err) continue;
          const transaction = await connection.getTransaction(candidate.signature, {
            commitment: "finalized",
            maxSupportedTransactionVersion: 0
          });
          if (transaction && hasCollectionEvidence(transaction, collection)) {
            return { state: "confirmed", collectionSignature: candidate.signature };
          }
        }
        return { state: "not_found" };
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
        const delegationInfo = await connection.getAccountInfo(
          new PublicKey(collection.delegationAddress),
          "finalized"
        );
        if (!delegationInfo) {
          return { state: "revoked", failureCode: "subscription_delegation_revoked" };
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

        const tokenProgram = collection.tokenProgram === "token_2022"
          ? token2022ProgramAddress
          : TOKEN_PROGRAM_ADDRESS;
        const mint = address(collection.tokenMint);
        const transaction = new Transaction();
        transaction.feePayer = collector.publicKey;
        transaction.recentBlockhash = (await connection.getLatestBlockhash("finalized")).blockhash;

        if (collection.creatorAmountAtomic > 0n) {
          if (!collection.creatorReceiverWallet) return retry("creator_receiver_wallet_missing");
          await addRecurringTransfer({
            transaction,
            collection,
            collector,
            receiverWallet: collection.creatorReceiverWallet,
            amount: collection.creatorAmountAtomic,
            mint,
            tokenProgram
          });
        }
        if (collection.platformAmountAtomic > 0n) {
          if (!input.platformWallet) return retry("platform_receiver_wallet_missing");
          await addRecurringTransfer({
            transaction,
            collection,
            collector,
            receiverWallet: input.platformWallet,
            amount: collection.platformAmountAtomic,
            mint,
            tokenProgram
          });
        }

        transaction.add(new TransactionInstruction({
          keys: [{ pubkey: new PublicKey(collection.delegationAddress), isSigner: false, isWritable: false }],
          programId: new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"),
          data: Buffer.from(`wevid:subscription-collection:${collection.collectionId}`, "utf8")
        }));
        const signature = await sendAndConfirmTransaction(connection, transaction, [collector], {
          commitment: "finalized",
          preflightCommitment: "confirmed"
        });
        return { state: "confirmed", collectionSignature: signature };
      } catch (error) {
        const message = error instanceof Error ? error.message : "subscription_collection_failed";
        if (/closed|not found|invalid account data|expired/i.test(message)) {
          return { state: "revoked", failureCode: "subscription_delegation_unavailable" };
        }
        return retry("subscription_collection_rpc_failed");
      }
    }
  };
}

async function addRecurringTransfer(input: {
  transaction: Transaction;
  collection: DueSubscriptionCollection;
  collector: Keypair;
  receiverWallet: string;
  amount: bigint;
  mint: ReturnType<typeof address>;
  tokenProgram: ReturnType<typeof address>;
}) {
  const receiver = address(input.receiverWallet);
  const [receiverAta] = await findAssociatedTokenPda({
    owner: receiver,
    mint: input.mint,
    tokenProgram: input.tokenProgram
  });
  input.transaction.add(
    toLegacyInstruction(await getCreateAssociatedTokenIdempotentInstructionAsync({
      payer: createNoopSigner(address(input.collector.publicKey.toBase58())),
      ata: receiverAta,
      owner: receiver,
      mint: input.mint,
      tokenProgram: input.tokenProgram
    })),
    toLegacyInstruction(await getTransferRecurringOverlayInstructionAsync({
      amount: input.amount,
      delegatee: createNoopSigner(address(input.collector.publicKey.toBase58())),
      delegationPda: address(input.collection.delegationAddress),
      delegator: address(input.collection.subscriberWallet),
      delegatorAta: address(input.collection.subscriberTokenAccount),
      receiverAta,
      tokenMint: address(input.collection.tokenMint),
      tokenProgram: input.tokenProgram,
      programAddress: address(input.collection.programId)
    }))
  );
}

function toLegacyInstruction(instruction: KitInstruction): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(instruction.programAddress),
    keys: (instruction.accounts ?? []).map((account) => {
      const role = Number(account.role);
      return {
        pubkey: new PublicKey(account.address),
        isSigner: role === 2 || role === 3,
        isWritable: role === 1 || role === 3
      };
    }),
    data: Buffer.from(instruction.data ?? new Uint8Array())
  });
}

function hasCollectionEvidence(
  transaction: Awaited<ReturnType<Connection["getTransaction"]>>,
  collection: DueSubscriptionCollection
) {
  if (!transaction || transaction.meta?.err) return false;
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

function retry(failureCode: string): SubscriptionCollectionOutcome {
  return {
    state: "failed",
    failureCode,
    retryAt: new Date(Date.now() + 5 * 60 * 1000)
  };
}

export function createPostgresSubscriptionCollectionRepository(
  databaseUrl?: string
): SubscriptionCollectionRepository {
  if (!databaseUrl) {
    return {
      async expireCancelledDueSubscriptions() {
        return 0;
      },
      async leaseDueCollections() {
        return [];
      },
      async recordCollectionOutcome() {
        return;
      }
    };
  }

  const sql = postgres(databaseUrl, {
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
            and due.state in ('active', 'renewal_pending', 'grace_period')
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
            set state = 'suspended', next_collection_at = null, updated_at = now()
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
            join subscription_plans sp on sp.id = s.plan_id
            cross join lateral private.resolve_recipient_monetisation_policy(
              s.creator_user_id, 'creator_subscription'
            ) policy
            where s.scope = 'creator'
              and s.state in ('active', 'renewal_pending', 'grace_period')
              and s.cancel_at_period_end = false
              and s.next_collection_at <= ${input.now}
              and sp.state = 'active'
              and sp.provider_state = 'launch_approved'
              and policy.kyc_required
              and not exists (
                select 1 from verification_records verification
                where verification.subject_type = 'user'
                  and verification.subject_id = s.creator_user_id
                  and verification.purpose = 'creator_kyc'
                  and verification.status = 'valid'
                  and verification.assurance_level in ('high', 'documentary')
                  and (verification.expires_at is null or verification.expires_at > ${input.now})
              )
            order by s.next_collection_at asc
            limit ${input.limit}
            for update of s skip locked
          )
          update subscriptions subscription
          set state = 'suspended', next_collection_at = null, updated_at = now()
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
            sp.amount_minor,
            sp.creator_amount_atomic,
            sp.platform_fee_amount_atomic,
            sp.allocation_amount_atomic,
            sp.currency,
            sp.period_days,
            coalesce(s.amount_atomic, sp.amount_atomic, sp.amount_minor) as amount_atomic,
            coalesce(s.period_seconds, sp.period_seconds, sp.period_days * 86400) as period_seconds,
            coalesce(s.current_period_ends_at, ${input.now}) as period_starts_at,
            coalesce(s.current_period_ends_at, ${input.now}) + (sp.period_days || ' days')::interval as period_ends_at,
            s.authority_address,
            s.delegation_address,
            s.subscriber_token_account,
            s.collector_address,
            sp.token_mint,
            sp.token_program,
            coalesce(s.provider, sp.provider) as provider,
            coalesce(s.program_id, sp.program_id) as program_id,
            s.merchant_wallet as creator_receiver_wallet,
            coalesce(policy.kyc_required, false) as recipient_kyc_required,
            coalesce(policy.effective_kyc_mode, 'disabled') as recipient_kyc_policy_mode,
            coalesce(policy.policy_version, 'platform-plan-not-applicable') as recipient_kyc_policy_version,
            coalesce(policy.decision_reason, 'platform_plan_not_applicable') as recipient_kyc_decision_reason
          from subscriptions s
          join subscription_plans sp on sp.id = s.plan_id
          left join lateral private.resolve_recipient_monetisation_policy(
            s.creator_user_id, 'creator_subscription'
          ) policy on s.scope = 'creator'
          where s.state in ('active', 'renewal_pending', 'grace_period')
            and s.renewal_mode = 'delegated_solana_subscription'
            and s.cancel_at_period_end = false
            and (s.expires_at is null or s.expires_at > ${input.now})
            and sp.state = 'active'
            and sp.provider_state = 'launch_approved'
            and sp.provider = 'official_solana_subscription_program'
            and sp.currency <> 'SOL'
            and s.next_collection_at <= ${input.now}
            and s.authority_address is not null
            and s.subscriber_wallet is not null
            and s.delegation_address is not null
            and s.subscriber_token_account is not null
            and s.collector_address is not null
            and sp.token_mint is not null
            and sp.token_program is not null
            and coalesce(s.program_id, sp.program_id) is not null
            and coalesce(s.amount_atomic, sp.amount_atomic, sp.amount_minor) <= sp.amount_atomic
            and (
              s.scope = 'platform'
              or not policy.kyc_required
              or exists (
                select 1 from verification_records verification
                where verification.subject_type = 'user'
                  and verification.subject_id = s.creator_user_id
                  and verification.purpose = 'creator_kyc'
                  and verification.status = 'valid'
                  and verification.assurance_level in ('high', 'documentary')
                  and (verification.expires_at is null or verification.expires_at > ${input.now})
              )
            )
          order by s.next_collection_at asc
          limit ${input.limit}
          for update skip locked
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
              attempt_count = collection.attempt_count + 1,
              attempted_at = ${input.now},
              submitted_at = coalesce(collection.submitted_at, ${input.now}),
              failure_code = null
            where collection.subscription_id = ${row.subscription_id}
              and collection.period_starts_at = ${row.period_starts_at}
              and collection.attempt_count < ${input.maxAttempts}
              and (
                (
                  collection.state in ('due', 'failed')
                  and collection.next_attempt_at <= ${input.now}
                )
                or (
                  collection.state = 'processing'
                  and (collection.leased_until is null or collection.leased_until <= ${input.now})
                )
              )
            returning collection.id, collection.state, collection.attempt_count, collection.idempotency_key
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
            creatorReceiverWallet: row.creator_receiver_wallet,
            recipientKycRequired: row.recipient_kyc_required,
            recipientKycPolicyMode: row.recipient_kyc_policy_mode,
            recipientKycPolicyVersion: row.recipient_kyc_policy_version,
            recipientKycDecisionReason: row.recipient_kyc_decision_reason
          });
        }

        return leased;
      });
    },

    async recordCollectionOutcome(input) {
      await sql.begin(async (transaction) => {
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
            returning period_starts_at, period_ends_at
          `;
          const row = rows[0];
          if (!row) return;

          await transaction`
            update subscriptions
            set
              state = 'active',
              current_period_starts_at = ${row.period_starts_at},
              current_period_ends_at = ${row.period_ends_at},
              next_collection_at = ${row.period_ends_at},
              updated_at = now()
            where id = ${input.subscriptionId}
          `;

          await insertCollectionEvent(transaction, {
            subscriptionId: input.subscriptionId,
            collectionId: input.collectionId,
            action: "subscription.collection_confirmed",
            metadata: {
              collectionSignature: input.outcome.collectionSignature
            }
          });
          return;
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
            returning id
          `;
          if (rows.length === 0) return;
          await transaction`
            update subscriptions
            set
              state = 'revoked',
              revoked_at = coalesce(revoked_at, now()),
              next_collection_at = null,
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
          return;
        }

        const rows = await transaction<{ attempt_count: number }[]>`
          update subscription_collections
          set
            state = case when attempt_count >= ${input.maxAttempts} then 'dead_letter' else 'failed' end,
            failure_code = ${input.outcome.failureCode},
            next_attempt_at = ${input.outcome.retryAt},
            lease_token = null,
            leased_until = null
          where id = ${input.collectionId}
            and subscription_id = ${input.subscriptionId}
            and state = 'processing'
            and lease_token = ${input.leaseToken}
          returning attempt_count
        `;
        const row = rows[0];
        if (!row) return;
        await transaction`
          update subscriptions
          set
            state = ${row.attempt_count >= input.maxAttempts ? "suspended" : "grace_period"},
            next_collection_at = ${row.attempt_count >= input.maxAttempts ? null : input.outcome.retryAt},
            updated_at = now()
          where id = ${input.subscriptionId}
        `;
        await insertCollectionEvent(transaction, {
          subscriptionId: input.subscriptionId,
          collectionId: input.collectionId,
          action: "subscription.collection_failed",
          metadata: {
            failureCode: input.outcome.failureCode,
            retryAt: input.outcome.retryAt.toISOString(),
            attemptCount: row.attempt_count,
            deadLettered: row.attempt_count >= input.maxAttempts
          }
        });
      });
    },

    async close() {
      await sql.end({ timeout: 5 });
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
  creator_receiver_wallet: string | null;
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
