import { address } from "@solana/kit";
import {
  AccountDiscriminator,
  getRecurringDelegationEncoder
} from "@solana/subscriptions";
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
    const fixture = collectionFixture();
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
    const fixture = collectionFixture();
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
    vi.spyOn(Connection.prototype, "getAccountInfo").mockResolvedValue({
      data: Buffer.from(encoded),
      executable: false,
      lamports: 1,
      owner: new PublicKey(programId),
      rentEpoch: 0
    });

    await expect(fixture.provider.collect(fixture.collection)).resolves.toEqual({
      state: "revoked",
      failureCode: "subscription_delegation_expired"
    });
  });

  it("fails closed on an uncertain retry reconciliation without issuing another collection", async () => {
    const collect = vi.fn();
    const recordCollectionOutcome = vi.fn();
    const repository: SubscriptionCollectionRepository = {
      async expireCancelledDueSubscriptions() {
        return 0;
      },
      async leaseDueCollections() {
        return [{ ...collectionFixture().collection, attemptCount: 2 }];
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
        state: "failed",
        failureCode: "subscription_collection_reconciliation_unavailable"
      })
    }));
    expect(result).toMatchObject({ leased: 1, failed: 1, confirmed: 0 });
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
    expect(dueQuery).toContain("collection.state in ('due', 'processing', 'failed')");
    expect(dueQuery).toContain("pending_collection.period_starts_at");
    expect(dueQuery).toContain("s.verified_at");
    expect(dueQuery).toContain("coalesce(s.period_seconds, sp.period_seconds");
    expect(dueQuery).not.toContain("coalesce(s.current_period_ends_at, ?)");
    expect(dueQuery).toContain("for update of s skip locked");
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

    await repository.recordCollectionOutcome({
      collectionId: "00000000-0000-4000-8000-000000000101",
      subscriptionId: "00000000-0000-4000-8000-000000000103",
      leaseToken: "00000000-0000-4000-8000-000000000102",
      maxAttempts: 8,
      outcome: { state: "confirmed", collectionSignature: "confirmed-signature" }
    });

    const subscriptionUpdate = queries.find((query) =>
      query.includes("update subscriptions") && query.includes("current_period_starts_at")
    );
    expect(subscriptionUpdate).toContain("cancelled_at is not null or state = 'cancelled'");
    expect(subscriptionUpdate).toContain("revoked_at is not null or state = 'revoked'");
    expect(subscriptionUpdate).toContain("else null");
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

function collectionFixture() {
  const collector = Keypair.generate();
  const subscriber = Keypair.generate().publicKey.toBase58();
  const creator = Keypair.generate().publicKey.toBase58();
  const mint = Keypair.generate().publicKey.toBase58();
  const authority = Keypair.generate().publicKey.toBase58();
  const delegation = Keypair.generate().publicKey.toBase58();
  const tokenAccount = Keypair.generate().publicKey.toBase58();
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
    creatorReceiverWallet: creator,
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
      platformWallet: Keypair.generate().publicKey.toBase58()
    })
  };
}
