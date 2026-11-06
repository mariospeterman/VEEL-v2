import { address } from "@solana/kit";
import {
  AccountDiscriminator,
  findRecurringDelegationPda,
  findSubscriptionAuthorityPda,
  getRecurringDelegationEncoder,
  getSubscriptionAuthorityEncoder
} from "@solana/subscriptions";
import {
  AccountState,
  TOKEN_PROGRAM_ADDRESS,
  getTokenEncoder
} from "@solana-program/token";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import type postgres from "postgres";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createPostgresSubscriptionCollectionRepository,
  createSolanaSubscriptionCollectionProvider,
  processDueSubscriptionCollections,
  type DueSubscriptionCollection,
  type SubscriptionCollectionRepository
} from "../src/subscription-collections.js";

const programId = "De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44";

describe("subscription collection safety", () => {
  afterEach(() => vi.restoreAllMocks());

  it("treats a missing finalized delegation account as retryable, never as proof of revocation", async () => {
    const fixture = await collectionFixture();
    vi.spyOn(Connection.prototype, "getAccountInfo").mockResolvedValue(null);
    const latestBlockhash = vi.spyOn(Connection.prototype, "getLatestBlockhash");

    const outcome = await fixture.provider.collect(fixture.collection);

    expect(outcome).toMatchObject({
      state: "failed",
      failureCode: "subscription_delegation_account_missing"
    });
    expect(latestBlockhash).not.toHaveBeenCalled();
  });

  it("marks expiry terminal only after decoding the official recurring-delegation account", async () => {
    const fixture = await collectionFixture();
    const encoded = getRecurringDelegationEncoder().encode({
      header: {
        discriminator: AccountDiscriminator.RecurringDelegation,
        version: 1,
        bump: 255,
        delegator: address(fixture.collection.subscriberWallet),
        delegatee: address(fixture.collection.collectorAddress),
        payer: address(fixture.collection.subscriberWallet),
        initId: 1n
      },
      subscriptionAuthority: address(fixture.collection.authorityAddress),
      mint: address(fixture.collection.tokenMint),
      currentPeriodStartTs: 1n,
      periodLengthS: BigInt(fixture.collection.periodSeconds),
      expiryTs: 1n,
      amountPerPeriod: fixture.collection.amountAtomic,
      amountPulledInPeriod: 0n
    });
    const authority = getSubscriptionAuthorityEncoder().encode({
      discriminator: AccountDiscriminator.SubscriptionAuthority,
      user: address(fixture.collection.subscriberWallet),
      tokenMint: address(fixture.collection.tokenMint),
      payer: address(fixture.collection.subscriberWallet),
      bump: 255,
      initId: 1n
    });
    const token = getTokenEncoder().encode({
      mint: address(fixture.collection.tokenMint),
      owner: address(fixture.collection.subscriberWallet),
      amount: fixture.collection.amountAtomic,
      delegate: address(fixture.collection.authorityAddress),
      state: AccountState.Initialized,
      isNative: null,
      delegatedAmount: fixture.collection.amountAtomic,
      closeAuthority: null
    });
    const accountInfo = (data: Uint8Array, owner: PublicKey) => ({
      data: Buffer.from(data),
      executable: false,
      lamports: 1,
      owner,
      rentEpoch: 0
    });
    vi.spyOn(Connection.prototype, "getAccountInfo")
      .mockResolvedValueOnce(accountInfo(encoded, new PublicKey(programId)))
      .mockResolvedValueOnce(accountInfo(authority, new PublicKey(programId)))
      .mockResolvedValueOnce(accountInfo(token, new PublicKey(TOKEN_PROGRAM_ADDRESS)));

    await expect(fixture.provider.collect(fixture.collection)).resolves.toEqual({
      state: "revoked",
      failureCode: "subscription_delegation_expired"
    });
  });

  it("does not report confirmation when the durable outcome fence rejects an unpersisted signature", async () => {
    const fixture = await collectionFixture();
    const { queries, sql } = postgresFixture(() => []);
    const durableRepository = createPostgresSubscriptionCollectionRepository({ sql });
    const recordCollectionOutcome = vi.fn(
      (input: Parameters<SubscriptionCollectionRepository["recordCollectionOutcome"]>[0]) =>
        durableRepository.recordCollectionOutcome(input)
    );
    const repository: SubscriptionCollectionRepository = {
      async expireCancelledDueSubscriptions() {
        return 0;
      },
      async leaseDueCollections() {
        return [fixture.collection];
      },
      async authorizeCollectionBroadcast() {
        return true;
      },
      async recordPreparedCollectionBroadcast() {
        return false;
      },
      recordCollectionOutcome
    };

    const result = await processDueSubscriptionCollections({
      repository,
      provider: {
        async reconcile() {
          return { state: "not_found" };
        },
        async collect() {
          return {
            state: "confirmed",
            collectionSignature: "unpersisted-signature"
          };
        }
      }
    });

    expect(recordCollectionOutcome).toHaveBeenCalledWith(expect.objectContaining({
      outcome: {
        state: "confirmed",
        collectionSignature: "unpersisted-signature"
      }
    }));
    expect(queries.find((query) => query.includes("update subscription_collections")))
      .toContain("broadcast_signature = ?");
    expect(result).toEqual({
      expired: 0,
      leased: 1,
      confirmed: 0,
      failed: 0,
      reconciling: 0,
      revoked: 0,
      cancelled: 0
    });
  });

  it("reports confirmation after the provider persists the exact signed broadcast", async () => {
    const fixture = await collectionFixture();
    let persistedSignature: string | null = null;
    const repository: SubscriptionCollectionRepository = {
      async expireCancelledDueSubscriptions() {
        return 0;
      },
      async leaseDueCollections() {
        return [fixture.collection];
      },
      async authorizeCollectionBroadcast() {
        return true;
      },
      async recordPreparedCollectionBroadcast(input) {
        persistedSignature = input.prepared.signature;
        return true;
      },
      async recordCollectionOutcome(input) {
        return input.outcome.state === "confirmed" &&
          input.outcome.collectionSignature === persistedSignature;
      }
    };

    const result = await processDueSubscriptionCollections({
      repository,
      provider: {
        async reconcile() {
          return { state: "not_found" };
        },
        async collect(_collection, controls) {
          const collectionSignature = "persisted-signature";
          expect(await controls.authorize()).toBe(true);
          expect(await controls.persist({
            signature: collectionSignature,
            transactionBase64: "cGVyc2lzdGVkLXRyYW5zYWN0aW9u",
            blockhash: "persisted-blockhash",
            lastValidBlockHeight: 123
          })).toBe(true);
          return { state: "confirmed", collectionSignature };
        }
      }
    });

    expect(result).toMatchObject({ leased: 1, confirmed: 1 });
  });

  it("keeps uncertain signed reconciliation distinct and never issues another collection", async () => {
    const collect = vi.fn();
    const recordCollectionOutcome = vi.fn().mockResolvedValue(true);
    const fixture = await collectionFixture();
    const repository: SubscriptionCollectionRepository = {
      async expireCancelledDueSubscriptions() {
        return 0;
      },
      async leaseDueCollections() {
        return [{
          ...fixture.collection,
          attemptCount: 2,
          broadcastSignature: "persisted-signature",
          broadcastTransactionBase64: "cGVyc2lzdGVkLXRyYW5zYWN0aW9u",
          broadcastBlockhash: "persisted-blockhash",
          broadcastLastValidBlockHeight: 123
        }];
      },
      async authorizeCollectionBroadcast() {
        return false;
      },
      async recordPreparedCollectionBroadcast() {
        return false;
      },
      recordCollectionOutcome
    };

    const result = await processDueSubscriptionCollections({
      repository,
      provider: {
        async reconcile() {
          return {
            state: "unknown",
            failureCode: "subscription_collection_reconciliation_unavailable",
            retryAt: new Date("2026-11-05T12:05:00.000Z")
          };
        },
        collect
      },
      now: new Date("2026-11-05T12:00:00.000Z")
    });

    expect(collect).not.toHaveBeenCalled();
    expect(recordCollectionOutcome).toHaveBeenCalledWith(expect.objectContaining({
      outcome: expect.objectContaining({
        state: "reconciling",
        failureCode: "subscription_collection_reconciliation_unavailable"
      })
    }));
    expect(result).toMatchObject({ leased: 1, reconciling: 1, failed: 0, confirmed: 0 });
  });

  it("reuses a pending collection period instead of deriving a new key from retry time", async () => {
    const { queries, sql } = postgresFixture(() => []);
    const repository = createPostgresSubscriptionCollectionRepository({ sql });

    await expect(repository.leaseDueCollections({
      now: new Date("2026-11-05T12:05:00.000Z"),
      limit: 25,
      leaseDurationMs: 300_000,
      maxAttempts: 8
    })).resolves.toEqual([]);

    const dueQuery = queries.find((query) => query.includes("pending_collection"));
    expect(dueQuery).toContain("collection.state in ('due', 'processing', 'reconciling', 'failed')");
    expect(dueQuery).toContain("pending_collection.period_starts_at");
    expect(dueQuery).toContain("s.verified_at");
    expect(dueQuery).toContain("acceptance.period_seconds");
    expect(dueQuery).not.toContain("join subscription_plans");
    expect(dueQuery).not.toContain("sp.state = 'active'");
    expect(dueQuery).not.toContain("coalesce(s.current_period_ends_at, ?)");
    expect(dueQuery).toContain("for update of s skip locked");
  });

  it("never attempt-exhausts signed evidence and releases ambiguity into reconciliation", async () => {
    const fixture = await collectionFixture();
    const { queries, sql } = postgresFixture((query) => {
      if (query.includes("state = 'reconciling'")) return [{ id: "collection-id" }];
      if (query.includes("s.id as subscription_id")) {
        return [{
          subscription_id: fixture.collection.subscriptionId,
          subscriber_user_id: fixture.collection.subscriberUserId,
          subscriber_wallet: fixture.collection.subscriberWallet,
          plan_id: fixture.collection.planId,
          amount_minor: fixture.collection.amountMinor,
          amount_atomic: fixture.collection.amountAtomic,
          creator_amount_atomic: fixture.collection.creatorAmountAtomic,
          platform_fee_amount_atomic: fixture.collection.platformAmountAtomic,
          allocation_amount_atomic: fixture.collection.allocationAmountAtomic,
          currency: fixture.collection.currency,
          period_days: 30,
          period_seconds: fixture.collection.periodSeconds,
          period_starts_at: fixture.collection.periodStartsAt,
          period_ends_at: fixture.collection.periodEndsAt,
          authority_address: fixture.collection.authorityAddress,
          delegation_address: fixture.collection.delegationAddress,
          subscriber_token_account: fixture.collection.subscriberTokenAccount,
          collector_address: fixture.collection.collectorAddress,
          token_mint: fixture.collection.tokenMint,
          token_program: fixture.collection.tokenProgram,
          provider: fixture.collection.provider,
          program_id: fixture.collection.programId,
          delegation_nonce: fixture.collection.delegationNonce,
          asset_decimals: fixture.collection.assetDecimals,
          scope: fixture.collection.scope,
          creator_user_id: fixture.collection.creatorUserId,
          creator_receiver_wallet: fixture.collection.creatorReceiverWallet,
          platform_receiver_wallet: fixture.collection.platformReceiverWallet,
          terms_version: fixture.collection.termsVersion,
          withdrawal_waiver_version: fixture.collection.withdrawalWaiverVersion,
          accepted_at: fixture.collection.acceptedAt,
          solana_network: fixture.collection.solanaNetwork,
          recipient_kyc_required: false,
          recipient_kyc_policy_mode: "disabled",
          recipient_kyc_policy_version: "test",
          recipient_kyc_decision_reason: "test"
        }];
      }
      if (query.includes("collection.state in ('due', 'reconciling', 'failed')")) {
        return [{
          id: fixture.collection.collectionId,
          state: "processing",
          attempt_count: 8,
          idempotency_key: fixture.collection.providerIdempotencyKey,
          broadcast_signature: "persisted-signature",
          broadcast_transaction_base64: "cGVyc2lzdGVkLXRyYW5zYWN0aW9u",
          broadcast_blockhash: "persisted-blockhash",
          broadcast_last_valid_block_height: 123
        }];
      }
      return [];
    });
    const repository = createPostgresSubscriptionCollectionRepository({ sql });

    const applied = await repository.recordCollectionOutcome({
      collectionId: "00000000-0000-4000-8000-000000000101",
      subscriptionId: "00000000-0000-4000-8000-000000000103",
      leaseToken: "00000000-0000-4000-8000-000000000102",
      maxAttempts: 8,
      outcome: {
        state: "reconciling",
        failureCode: "subscription_collection_reconciliation_unavailable",
        retryAt: new Date("2026-11-05T12:05:00.000Z")
      }
    });

    expect(applied).toBe(true);
    const reconciliationUpdate = queries.find((query) => query.includes("state = 'reconciling'"));
    expect(reconciliationUpdate).toContain("broadcast_signature is not null");
    expect(queries.findIndex((query) => query.includes("from subscriptions")))
      .toBeLessThan(queries.indexOf(reconciliationUpdate ?? ""));

    await repository.leaseDueCollections({
      now: new Date("2026-11-05T12:05:00.000Z"),
      limit: 25,
      leaseDurationMs: 300_000,
      maxAttempts: 8
    });
    const exhaustion = queries.find((query) => query.includes("collection_attempt_limit_exceeded"));
    expect(exhaustion).toContain("collection.broadcast_signature is null");
    const leaseUpdate = queries.find((query) =>
      query.includes("update subscription_collections collection") &&
      query.includes("collection.state in ('due', 'reconciling', 'failed')")
    );
    expect(leaseUpdate).toContain("collection.broadcast_signature is not null");
  });

  it("forces a generic post-signature failure back into reconciliation", async () => {
    const { queries, sql } = postgresFixture((query) => {
      if (query.includes("returning attempt_count, broadcast_signature, state")) {
        return [{
          attempt_count: 8,
          broadcast_signature: "persisted-signature",
          state: "reconciling"
        }];
      }
      return [];
    });
    const repository = createPostgresSubscriptionCollectionRepository({ sql });

    const applied = await repository.recordCollectionOutcome({
      collectionId: "00000000-0000-4000-8000-000000000101",
      subscriptionId: "00000000-0000-4000-8000-000000000103",
      leaseToken: "00000000-0000-4000-8000-000000000102",
      maxAttempts: 8,
      outcome: {
        state: "failed",
        failureCode: "subscription_collection_rpc_failed",
        retryAt: new Date("2026-11-05T12:05:00.000Z")
      }
    });

    expect(applied).toBe(true);
    const outcomeUpdate = queries.find((query) =>
      query.includes("returning attempt_count, broadcast_signature, state")
    );
    expect(outcomeUpdate).toContain("when broadcast_signature is not null then 'reconciling'");
    expect(outcomeUpdate).not.toContain("broadcast_signature is not null or attempt_count");
    const subscriptionUpdate = queries.find((query) =>
      query.includes("update subscriptions") && query.includes("failure_reason")
    );
    expect(subscriptionUpdate).toContain("next_collection_at");
  });

  it("records a late confirmed debit without reactivating cancelled or revoked access", async () => {
    const period = {
      period_starts_at: new Date("2026-11-05T12:00:00.000Z"),
      period_ends_at: new Date("2026-12-05T12:00:00.000Z")
    };
    const { queries, sql } = postgresFixture((query) =>
      query.includes("update subscription_collections") ? [period] : []
    );
    const repository = createPostgresSubscriptionCollectionRepository({ sql });

    const applied = await repository.recordCollectionOutcome({
      collectionId: "00000000-0000-4000-8000-000000000101",
      subscriptionId: "00000000-0000-4000-8000-000000000103",
      leaseToken: "00000000-0000-4000-8000-000000000102",
      maxAttempts: 8,
      outcome: { state: "confirmed", collectionSignature: "confirmed-signature" }
    });

    expect(applied).toBe(true);

    const subscriptionUpdate = queries.find((query) =>
      query.includes("update subscriptions") && query.includes("current_period_starts_at")
    );
    expect(subscriptionUpdate).toContain("cancelled_at is not null or state = 'cancelled'");
    expect(subscriptionUpdate).toContain("revoked_at is not null or state = 'revoked'");
    expect(subscriptionUpdate).toContain("else null");
    expect(queries.find((query) => query.includes("jsonb_build_object")))
      .toContain("'settlementSignature', ?::text");
  });
});

function postgresFixture(
  rowsForQuery: (query: string) => unknown[]
): { queries: string[]; sql: postgres.Sql } {
  const queries: string[] = [];
  const transaction = vi.fn((strings: TemplateStringsArray) => {
    const query = strings.join("?");
    queries.push(query);
    return Promise.resolve(rowsForQuery(query));
  }) as unknown as postgres.TransactionSql;
  (transaction as unknown as { json(value: unknown): unknown }).json = (value) => value;
  const sql = vi.fn() as unknown as postgres.Sql;
  (sql as unknown as {
    begin<T>(work: (tx: postgres.TransactionSql) => Promise<T>): Promise<T>;
  }).begin = (work) => work(transaction);
  return { queries, sql };
}

async function collectionFixture() {
  const collector = Keypair.generate();
  const subscriber = Keypair.generate().publicKey.toBase58();
  const creator = Keypair.generate().publicKey.toBase58();
  const mint = Keypair.generate().publicKey.toBase58();
  const [authority] = await findSubscriptionAuthorityPda(
    { user: address(subscriber), tokenMint: address(mint) },
    { programAddress: address(programId) }
  );
  const [delegation] = await findRecurringDelegationPda(
    {
      subscriptionAuthority: authority,
      delegator: address(subscriber),
      delegatee: address(collector.publicKey.toBase58()),
      nonce: 1
    },
    { programAddress: address(programId) }
  );
  const tokenAccount = Keypair.generate().publicKey.toBase58();
  const platformReceiverWallet = Keypair.generate().publicKey.toBase58();
  const collection: DueSubscriptionCollection = {
    collectionId: "00000000-0000-4000-8000-000000000101",
    leaseToken: "00000000-0000-4000-8000-000000000102",
    attemptCount: 1,
    providerIdempotencyKey: "subscription:period",
    subscriptionId: "00000000-0000-4000-8000-000000000103",
    subscriberUserId: "00000000-0000-4000-8000-000000000104",
    subscriberWallet: subscriber,
    planId: "creator_test_monthly",
    amountMinor: 1_000n,
    amountAtomic: 10_000_000n,
    creatorAmountAtomic: 9_000_000n,
    platformAmountAtomic: 1_000_000n,
    allocationAmountAtomic: 0n,
    currency: "USDC",
    periodStartsAt: new Date("2026-11-05T12:00:00.000Z"),
    periodEndsAt: new Date("2026-12-05T12:00:00.000Z"),
    authorityAddress: authority,
    delegationAddress: delegation,
    subscriberTokenAccount: tokenAccount,
    collectorAddress: collector.publicKey.toBase58(),
    tokenMint: mint,
    tokenProgram: "spl_token",
    provider: "official_solana_subscription_program",
    programId,
    periodSeconds: 2_592_000,
    delegationNonce: 1,
    assetDecimals: 6,
    scope: "creator",
    creatorUserId: "00000000-0000-4000-8000-000000000105",
    creatorReceiverWallet: creator,
    platformReceiverWallet,
    termsVersion: "subscription-recurring-terms-v1",
    withdrawalWaiverVersion: "subscription-immediate-access-waiver-v1",
    acceptedAt: new Date("2026-11-01T12:00:00.000Z"),
    solanaNetwork: "devnet",
    broadcastSignature: null,
    broadcastTransactionBase64: null,
    broadcastBlockhash: null,
    broadcastLastValidBlockHeight: null,
    recipientKycRequired: false,
    recipientKycPolicyMode: "disabled",
    recipientKycPolicyVersion: "test",
    recipientKycDecisionReason: "test"
  };

  return {
    collection,
    provider: createSolanaSubscriptionCollectionProvider({
      rpcUrl: "https://api.devnet.solana.com",
      collectorPrivateKey: bs58.encode(collector.secretKey),
      collectorWallet: collector.publicKey.toBase58(),
      platformWallet: platformReceiverWallet
    })
  };
}
