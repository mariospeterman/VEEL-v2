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
    const [delegation, authority, token] = encodedCollectionAccounts(fixture.collection, 1n);
    vi.spyOn(Connection.prototype, "getAccountInfo")
      .mockResolvedValueOnce(delegation)
      .mockResolvedValueOnce(authority)
      .mockResolvedValueOnce(token);

    await expect(fixture.provider.collect(fixture.collection)).resolves.toEqual({
      state: "revoked",
      failureCode: "subscription_delegation_expired"
    });
  });

  it("keeps a platform-scoped USDC collection fully atomic with no creator share", async () => {
    const fixture = await collectionFixture();
    const platformCollection: DueSubscriptionCollection = {
      ...fixture.collection,
      planId: "platform_plus_monthly",
      amountMinor: 1_001n,
      amountAtomic: 10_010_000n,
      creatorAmountAtomic: 0n,
      platformAmountAtomic: 10_010_000n,
      scope: "platform",
      creatorUserId: null,
      creatorReceiverWallet: null
    };
    const [delegation, authority, token] = encodedCollectionAccounts(
      platformCollection,
      4_102_444_800n
    );
    vi.spyOn(Connection.prototype, "getAccountInfo")
      .mockResolvedValueOnce(delegation)
      .mockResolvedValueOnce(authority)
      .mockResolvedValueOnce(token);

    await expect(fixture.provider.collect(platformCollection)).resolves.toMatchObject({
      state: "failed",
      failureCode: "subscription_collection_provider_not_configured"
    });
    expect(platformCollection.creatorAmountAtomic + platformCollection.platformAmountAtomic)
      .toBe(platformCollection.amountAtomic);
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

  it("leases and persists exact atomic splits beyond Number.MAX_SAFE_INTEGER", async () => {
    const fixture = await collectionFixture();
    const amountAtomic = 9_007_199_254_750_000n;
    const creatorAmountAtomic = 7_656_119_366_537_500n;
    const platformAmountAtomic = 1_351_079_888_212_500n;
    expect(creatorAmountAtomic + platformAmountAtomic).toBe(amountAtomic);

    const { queryCalls, sql } = postgresFixture((query) => {
      if (query.includes("acceptance.amount_atomic") && query.includes("pending_collection")) {
        return [{
          subscription_id: fixture.collection.subscriptionId,
          subscriber_user_id: fixture.collection.subscriberUserId,
          subscriber_wallet: fixture.collection.subscriberWallet,
          plan_id: fixture.collection.planId,
          amount_minor: "900719925475",
          amount_atomic: amountAtomic.toString(),
          creator_amount_atomic: creatorAmountAtomic.toString(),
          platform_fee_amount_atomic: platformAmountAtomic.toString(),
          allocation_amount_atomic: "0",
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
      if (
        query.includes("update subscription_collections collection") &&
        query.includes("collection.broadcast_last_valid_block_height")
      ) {
        return [{
          id: fixture.collection.collectionId,
          state: "processing",
          attempt_count: 1,
          idempotency_key: fixture.collection.providerIdempotencyKey,
          broadcast_signature: null,
          broadcast_transaction_base64: null,
          broadcast_blockhash: null,
          broadcast_last_valid_block_height: null
        }];
      }
      return [];
    });
    const repository = createPostgresSubscriptionCollectionRepository({ sql });

    const leased = await repository.leaseDueCollections({
      now: new Date("2026-11-05T12:00:00.000Z"),
      limit: 1,
      leaseDurationMs: 300_000,
      maxAttempts: 8
    });

    expect(leased).toHaveLength(1);
    expect(leased[0]).toMatchObject({
      amountAtomic,
      creatorAmountAtomic,
      platformAmountAtomic,
      allocationAmountAtomic: 0n
    });
    const collectionInsert = queryCalls.find(({ query }) =>
      query.includes("insert into subscription_collections")
    );
    expect(collectionInsert?.values).toEqual(expect.arrayContaining([
      amountAtomic.toString(),
      creatorAmountAtomic.toString(),
      platformAmountAtomic.toString(),
      "0"
    ]));
    expect(collectionInsert?.values.some((value) => typeof value === "number" && !Number.isSafeInteger(value)))
      .toBe(false);
  });

  it("propagates a non-cent creator renewal through every recurring finance boundary", async () => {
    const fixture = await collectionFixture();
    const collection: DueSubscriptionCollection = {
      ...fixture.collection,
      amountMinor: 1_001n,
      amountAtomic: 10_010_000n,
      creatorAmountAtomic: 8_508_500n,
      platformAmountAtomic: 1_501_500n
    };

    const proof = await exerciseConfirmedFinanceWriter(collection, "creator-renewal-signature");

    expect(proof.applied).toBe(true);
    expect(proof.leased).toMatchObject({
      amountMinor: 1_001n,
      amountAtomic: 10_010_000n,
      creatorAmountAtomic: 8_508_500n,
      platformAmountAtomic: 1_501_500n,
      scope: "creator"
    });
    expect(proof.persistedAmounts).toEqual({
      acceptedPriceMinor: 1_001n,
      amountAtomic: 10_010_000n,
      creatorAmountAtomic: 8_508_500n,
      platformFeeAmountAtomic: 1_501_500n,
      allocationAmountAtomic: 0n
    });
    expectRecurringFinanceWriter(proof, {
      acceptedPriceMinor: 1_001n,
      amountAtomic: 10_010_000n,
      creatorAmountAtomic: 8_508_500n,
      platformFeeAmountAtomic: 1_501_500n,
      scope: "creator"
    });
  });

  it("persists a platform renewal with the full atomic amount and no creator share", async () => {
    const fixture = await collectionFixture();
    const collection: DueSubscriptionCollection = {
      ...fixture.collection,
      planId: "platform_plus_monthly",
      amountMinor: 1_001n,
      amountAtomic: 10_010_000n,
      creatorAmountAtomic: 0n,
      platformAmountAtomic: 10_010_000n,
      scope: "platform",
      creatorUserId: null,
      creatorReceiverWallet: null
    };

    const proof = await exerciseConfirmedFinanceWriter(collection, "platform-renewal-signature");

    expect(proof.applied).toBe(true);
    expect(proof.leased).toMatchObject({
      amountMinor: 1_001n,
      amountAtomic: 10_010_000n,
      creatorAmountAtomic: 0n,
      platformAmountAtomic: 10_010_000n,
      scope: "platform",
      creatorUserId: null
    });
    expect(proof.persistedAmounts).toEqual({
      acceptedPriceMinor: 1_001n,
      amountAtomic: 10_010_000n,
      creatorAmountAtomic: 0n,
      platformFeeAmountAtomic: 10_010_000n,
      allocationAmountAtomic: 0n
    });
    expectRecurringFinanceWriter(proof, {
      acceptedPriceMinor: 1_001n,
      amountAtomic: 10_010_000n,
      creatorAmountAtomic: 0n,
      platformFeeAmountAtomic: 10_010_000n,
      scope: "platform"
    });
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
    const financeProjection = queries.find((query) => query.includes("with finance as"));
    expect(financeProjection).toContain("collection.amount_minor as accepted_price_minor");
    expect(financeProjection).toContain("collection.amount_atomic");
    expect(financeProjection).toContain("collection.creator_amount_atomic");
    expect(financeProjection).toContain("collection.platform_fee_amount_atomic");
    expect(financeProjection).toContain("collection.allocation_amount_atomic");
    const normalizedFinanceProjection = financeProjection?.replace(/\s+/gu, " ");
    expect(normalizedFinanceProjection).toContain(
      "case when scope = 'creator' then 'creator_subscription' else 'platform_subscription' end, amount_atomic, currency"
    );
    expect(normalizedFinanceProjection).toContain(
      "'purchase_total', 'Recurring subscription period', finance.amount_atomic, finance.currency"
    );
    expect(normalizedFinanceProjection).toContain(
      "'outgoing', finance.amount_atomic, finance.currency"
    );
    expect(normalizedFinanceProjection).toContain(
      "finance.collection_id, finance.amount_atomic, finance.platform_fee_amount_atomic, case when finance.scope = 'creator' then finance.creator_amount_atomic else null end"
    );
    expect(normalizedFinanceProjection).toContain(
      "finance.collection_id, 'subscription_collection_confirmed', finance.accepted_price_minor, finance.amount_atomic"
    );
    expect(financeProjection).toContain("'confirmationVersion', 'subscription-collection-confirmation-v2'");
    expect(normalizedFinanceProjection).not.toContain("'purchase_total', 'Recurring subscription period', finance.accepted_price_minor");
    expect(normalizedFinanceProjection).not.toContain("'outgoing', finance.accepted_price_minor");
    expect(normalizedFinanceProjection).not.toContain("round(finance.platform_fee_amount_atomic::numeric / 10000)");
  });
});

function postgresFixture(
  rowsForQuery: (query: string) => unknown[]
): {
  queries: string[];
  queryCalls: Array<{ query: string; values: unknown[] }>;
  sql: postgres.Sql;
} {
  const queries: string[] = [];
  const queryCalls: Array<{ query: string; values: unknown[] }> = [];
  const transaction = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.join("?");
    queries.push(query);
    queryCalls.push({ query, values });
    return Promise.resolve(rowsForQuery(query));
  }) as unknown as postgres.TransactionSql;
  (transaction as unknown as { json(value: unknown): unknown }).json = (value) => value;
  const sql = vi.fn() as unknown as postgres.Sql;
  (sql as unknown as {
    begin<T>(work: (tx: postgres.TransactionSql) => Promise<T>): Promise<T>;
  }).begin = (work) => work(transaction);
  return { queries, queryCalls, sql };
}

async function exerciseConfirmedFinanceWriter(
  collection: DueSubscriptionCollection,
  collectionSignature: string
) {
  const { queryCalls, sql } = postgresFixture((query) => {
    if (query.includes("acceptance.amount_atomic") && query.includes("pending_collection")) {
      return [dueSubscriptionRow(collection)];
    }
    if (
      query.includes("update subscription_collections collection") &&
      query.includes("collection.broadcast_last_valid_block_height")
    ) {
      return [{
        id: collection.collectionId,
        state: "processing",
        attempt_count: collection.attemptCount,
        idempotency_key: collection.providerIdempotencyKey,
        broadcast_signature: null,
        broadcast_transaction_base64: null,
        broadcast_blockhash: null,
        broadcast_last_valid_block_height: null
      }];
    }
    if (
      query.includes("update subscription_collections") &&
      query.includes("state = 'confirmed'") &&
      query.includes("returning period_starts_at, period_ends_at")
    ) {
      return [{
        period_starts_at: collection.periodStartsAt,
        period_ends_at: collection.periodEndsAt
      }];
    }
    return [];
  });
  const repository = createPostgresSubscriptionCollectionRepository({ sql });
  const leased = await repository.leaseDueCollections({
    now: new Date("2026-11-05T12:00:00.000Z"),
    limit: 1,
    leaseDurationMs: 300_000,
    maxAttempts: 8
  });
  const leasedCollection = leased[0];
  if (!leasedCollection) throw new Error("Expected the recurring collection to be leased");

  const applied = await repository.recordCollectionOutcome({
    collectionId: leasedCollection.collectionId,
    subscriptionId: leasedCollection.subscriptionId,
    leaseToken: leasedCollection.leaseToken,
    maxAttempts: 8,
    outcome: { state: "confirmed", collectionSignature }
  });
  const collectionInsert = queryCalls.find(({ query }) =>
    query.includes("insert into subscription_collections")
  );
  const financeWrite = queryCalls.find(({ query }) => query.includes("with finance as"));
  if (!collectionInsert || !financeWrite) {
    throw new Error("Expected collection persistence and recurring finance writer queries");
  }

  return {
    applied,
    leased: leasedCollection,
    collectionSignature,
    financeWrite,
    persistedAmounts: {
      acceptedPriceMinor: BigInt(String(collectionInsert.values[4])),
      amountAtomic: BigInt(String(collectionInsert.values[5])),
      creatorAmountAtomic: BigInt(String(collectionInsert.values[6])),
      platformFeeAmountAtomic: BigInt(String(collectionInsert.values[7])),
      allocationAmountAtomic: BigInt(String(collectionInsert.values[8]))
    }
  };
}

function dueSubscriptionRow(collection: DueSubscriptionCollection) {
  return {
    subscription_id: collection.subscriptionId,
    subscriber_user_id: collection.subscriberUserId,
    subscriber_wallet: collection.subscriberWallet,
    plan_id: collection.planId,
    amount_minor: collection.amountMinor.toString(),
    amount_atomic: collection.amountAtomic.toString(),
    creator_amount_atomic: collection.creatorAmountAtomic.toString(),
    platform_fee_amount_atomic: collection.platformAmountAtomic.toString(),
    allocation_amount_atomic: collection.allocationAmountAtomic.toString(),
    currency: collection.currency,
    period_days: 30,
    period_seconds: collection.periodSeconds,
    period_starts_at: collection.periodStartsAt,
    period_ends_at: collection.periodEndsAt,
    authority_address: collection.authorityAddress,
    delegation_address: collection.delegationAddress,
    subscriber_token_account: collection.subscriberTokenAccount,
    collector_address: collection.collectorAddress,
    token_mint: collection.tokenMint,
    token_program: collection.tokenProgram,
    provider: collection.provider,
    program_id: collection.programId,
    delegation_nonce: collection.delegationNonce,
    asset_decimals: collection.assetDecimals,
    scope: collection.scope,
    creator_user_id: collection.creatorUserId,
    creator_receiver_wallet: collection.creatorReceiverWallet,
    platform_receiver_wallet: collection.platformReceiverWallet,
    terms_version: collection.termsVersion,
    withdrawal_waiver_version: collection.withdrawalWaiverVersion,
    accepted_at: collection.acceptedAt,
    solana_network: collection.solanaNetwork,
    recipient_kyc_required: collection.recipientKycRequired,
    recipient_kyc_policy_mode: collection.recipientKycPolicyMode,
    recipient_kyc_policy_version: collection.recipientKycPolicyVersion,
    recipient_kyc_decision_reason: collection.recipientKycDecisionReason
  };
}

function expectRecurringFinanceWriter(
  proof: Awaited<ReturnType<typeof exerciseConfirmedFinanceWriter>>,
  expected: {
    acceptedPriceMinor: bigint;
    amountAtomic: bigint;
    creatorAmountAtomic: bigint;
    platformFeeAmountAtomic: bigint;
    scope: "creator" | "platform";
  }
) {
  const normalized = proof.financeWrite.query.replace(/\s+/gu, " ");
  expect(proof.financeWrite.values.slice(0, 3)).toEqual([
    proof.leased.collectionId,
    proof.leased.subscriptionId,
    proof.collectionSignature
  ]);
  expect(normalized).toContain(
    "collection.amount_minor as accepted_price_minor, collection.amount_atomic, collection.creator_amount_atomic, collection.platform_fee_amount_atomic"
  );
  expect(normalized).toContain(
    "case when scope = 'creator' then 'creator_subscription' else 'platform_subscription' end, amount_atomic, currency"
  );
  expect(normalized).toContain(
    "'purchase_total', 'Recurring subscription period', finance.amount_atomic, finance.currency"
  );
  expect(normalized).toContain("'outgoing', finance.amount_atomic, finance.currency");
  expect(normalized).toContain(
    "finance.collection_id, finance.amount_atomic, finance.platform_fee_amount_atomic, case when finance.scope = 'creator' then finance.creator_amount_atomic else null end"
  );
  expect(normalized).toContain(
    "case when finance.scope = 'creator' then 'user_to_creator_split' else 'user_to_platform' end"
  );
  expect(normalized).toContain(
    "case when finance.scope = 'creator' then 'creator' else 'veel' end"
  );
  expect(normalized).toContain(
    "'acceptedPriceMinor', finance.accepted_price_minor, 'amountAtomic', finance.amount_atomic, 'creatorAmountAtomic', finance.creator_amount_atomic, 'platformFeeAmountAtomic', finance.platform_fee_amount_atomic"
  );
  expect(normalized).toContain(
    "finance.collection_id, 'subscription_collection_confirmed', finance.accepted_price_minor, finance.amount_atomic"
  );
  expect(normalized).not.toContain(
    "'purchase_total', 'Recurring subscription period', finance.accepted_price_minor"
  );
  expect(normalized).not.toContain("'outgoing', finance.accepted_price_minor");
  expect(normalized).not.toContain("round(finance.platform_fee_amount_atomic::numeric / 10000)");
  expect({
    receiptGrossAtomic: proof.persistedAmounts.amountAtomic,
    receiptLineAtomic: proof.persistedAmounts.amountAtomic,
    walletAtomic: proof.persistedAmounts.amountAtomic,
    ledgerGrossAtomic: proof.persistedAmounts.amountAtomic,
    ledgerPlatformFeeAtomic: proof.persistedAmounts.platformFeeAmountAtomic,
    ledgerCreatorNetAtomic: expected.scope === "creator"
      ? proof.persistedAmounts.creatorAmountAtomic
      : null,
    outboxPriceMinor: proof.persistedAmounts.acceptedPriceMinor,
    outboxAmountAtomic: proof.persistedAmounts.amountAtomic
  }).toEqual({
    receiptGrossAtomic: expected.amountAtomic,
    receiptLineAtomic: expected.amountAtomic,
    walletAtomic: expected.amountAtomic,
    ledgerGrossAtomic: expected.amountAtomic,
    ledgerPlatformFeeAtomic: expected.platformFeeAmountAtomic,
    ledgerCreatorNetAtomic: expected.scope === "creator" ? expected.creatorAmountAtomic : null,
    outboxPriceMinor: expected.acceptedPriceMinor,
    outboxAmountAtomic: expected.amountAtomic
  });
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
    amountMinor: 1_500n,
    amountAtomic: 15_000_000n,
    creatorAmountAtomic: 12_750_000n,
    platformAmountAtomic: 2_250_000n,
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

function encodedCollectionAccounts(
  collection: DueSubscriptionCollection,
  expiryTs: bigint
) {
  const delegation = getRecurringDelegationEncoder().encode({
    header: {
      discriminator: AccountDiscriminator.RecurringDelegation,
      version: 1,
      bump: 255,
      delegator: address(collection.subscriberWallet),
      delegatee: address(collection.collectorAddress),
      payer: address(collection.subscriberWallet),
      initId: 1n
    },
    subscriptionAuthority: address(collection.authorityAddress),
    mint: address(collection.tokenMint),
    currentPeriodStartTs: 1n,
    periodLengthS: BigInt(collection.periodSeconds),
    expiryTs,
    amountPerPeriod: collection.amountAtomic,
    amountPulledInPeriod: 0n
  });
  const authority = getSubscriptionAuthorityEncoder().encode({
    discriminator: AccountDiscriminator.SubscriptionAuthority,
    user: address(collection.subscriberWallet),
    tokenMint: address(collection.tokenMint),
    payer: address(collection.subscriberWallet),
    bump: 255,
    initId: 1n
  });
  const token = getTokenEncoder().encode({
    mint: address(collection.tokenMint),
    owner: address(collection.subscriberWallet),
    amount: collection.amountAtomic,
    delegate: address(collection.authorityAddress),
    state: AccountState.Initialized,
    isNative: null,
    delegatedAmount: collection.amountAtomic,
    closeAuthority: null
  });
  const accountInfo = (data: Uint8Array, owner: PublicKey) => ({
    data: Buffer.from(data),
    executable: false,
    lamports: 1,
    owner,
    rentEpoch: 0
  });

  return [
    accountInfo(delegation, new PublicKey(collection.programId)),
    accountInfo(authority, new PublicKey(collection.programId)),
    accountInfo(token, new PublicKey(TOKEN_PROGRAM_ADDRESS))
  ] as const;
}
