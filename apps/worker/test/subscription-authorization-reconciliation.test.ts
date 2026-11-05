import type postgres from "postgres";
import { describe, expect, it, vi } from "vitest";
import {
  createPostgresSubscriptionAuthorizationReconciliationRepository,
  processSubscriptionAuthorizationReconciliations,
  type PendingSubscriptionAuthorizationEvidence
} from "../src/subscription-authorization-reconciliation";

describe("subscription authorization evidence reconciliation", () => {
  it("progresses the same accepted signature after a retryable observation and worker restart", async () => {
    const evidence = evidenceFixture();
    const database = statefulPostgresFixture();

    await expect(processSubscriptionAuthorizationReconciliations({
      repository: database.createRepository(),
      verifier: {
        async verifyAuthorization(input) {
          expect(input.signature).toBe(evidence.signature);
          return {
            verified: false,
            failureCode: "transaction_not_found",
            retryable: true
          };
        }
      }
    })).resolves.toMatchObject({ retrying: 1, verified: 0 });

    await expect(processSubscriptionAuthorizationReconciliations({
      repository: database.createRepository(),
      verifier: {
        async verifyAuthorization(input) {
          expect(input.signature).toBe(evidence.signature);
          return verifiedOutcome();
        }
      },
      now: new Date("2026-11-05T12:01:01.000Z")
    })).resolves.toMatchObject({ retrying: 0, verified: 1 });
    expect(database.intentState()).toBe("verified");
    expect(database.signaturesObserved()).toEqual([
      evidence.signature,
      evidence.signature
    ]);
    expect(database.attemptCount()).toBe(2);
    expect(database.completionCount()).toBe(2);
    expect(database.queries().some((query) => query.includes("mutation_command_receipts"))).toBe(false);
  });

  it("commits a fenced claim before RPC and applies only the latest exact-signature claim", async () => {
    const queries: string[] = [];
    const evidence = evidenceRow();
    const transaction = vi.fn((strings: TemplateStringsArray) => {
      const query = strings.join("?");
      queries.push(query);
      if (query.includes("left join lateral")) {
        return Promise.resolve([evidence]);
      }
      if (query.includes("select sai.id")) return Promise.resolve([{ id: evidence.authorization_intent_id }]);
      if (query.includes("update subscription_authorization_intents")) {
        return Promise.resolve([{ id: evidence.authorization_intent_id }]);
      }
      if (query.includes("update subscriptions s")) {
        return Promise.resolve([{ id: evidence.subscription_id }]);
      }
      return Promise.resolve([]);
    }) as unknown as postgres.TransactionSql;
    (transaction as unknown as { json(value: unknown): unknown }).json = (value) => value;

    const sql = vi.fn() as unknown as postgres.Sql;
    let transactionActive = false;
    let claimCommitted = false;
    let transactionCount = 0;
    (sql as unknown as {
      begin<T>(work: (tx: postgres.TransactionSql) => Promise<T>): Promise<T>;
    }).begin = async (work) => {
      transactionActive = true;
      try {
        return await work(transaction);
      } finally {
        transactionActive = false;
        transactionCount += 1;
        if (transactionCount === 1) claimCommitted = true;
      }
    };
    const repository = createPostgresSubscriptionAuthorizationReconciliationRepository({ sql });
    const verifyAuthorization = vi.fn(async () => {
      expect(transactionActive).toBe(false);
      expect(claimCommitted).toBe(true);
      return {
        verified: false as const,
        failureCode: "rpc_unavailable" as const,
        retryable: true
      };
    });

    await expect(repository.reconcileDue({
      now: new Date("2026-11-05T12:00:00.000Z"),
      limit: 10,
      retryDelayMs: 60_000,
      verifier: { verifyAuthorization }
    })).resolves.toEqual({
      claimed: 1,
      verified: 0,
      retrying: 1,
      terminal: 0,
      stale: 0
    });

    const claimQuery = queries.find((query) => query.includes("left join lateral"));
    expect(claimQuery).toContain("for update of sai, s skip locked");
    expect(claimQuery).toContain("s.state = 'authorization_pending'");
    expect(claimQuery).toContain("s.cancel_at_period_end = false");
    expect(claimQuery).toContain("s.cancelled_at is null");
    expect(claimQuery).toContain("s.revoked_at is null");
    const applyQuery = queries.find((query) => query.includes("select sai.id"));
    expect(applyQuery).toContain("subscription.authorization_reverification_attempted");
    expect(applyQuery).toContain("order by event.created_at desc, event.id desc");
    expect(applyQuery).toContain("s.setup_signature is null or s.setup_signature = ?");
    expect(transactionCount).toBe(2);
    expect(queries.some((query) => query.includes("mutation_command_receipts"))).toBe(false);
    expect(verifyAuthorization).toHaveBeenCalledWith(expect.objectContaining({
      signature: evidence.submitted_signature,
      acceptedAt: evidence.submitted_at,
      amountAtomic: evidence.amount_atomic
    }));
  });

  it("records a finalized chain failure as terminal instead of retrying it", async () => {
    const { repository } = postgresRepositoryFixture();

    await expect(repository.reconcileDue({
      now: new Date("2026-11-05T12:00:00.000Z"),
      limit: 1,
      retryDelayMs: 60_000,
      verifier: {
        async verifyAuthorization() {
          return {
            verified: false,
            failureCode: "transaction_failed",
            retryable: false
          };
        }
      }
    })).resolves.toMatchObject({
      claimed: 1,
      verified: 0,
      retrying: 0,
      terminal: 1
    });
  });
});

function postgresRepositoryFixture() {
  const evidence = evidenceRow();
  const transaction = vi.fn((strings: TemplateStringsArray) => {
    const query = strings.join("?");
    if (query.includes("left join lateral")) {
      return Promise.resolve([evidence]);
    }
    if (query.includes("select sai.id")) return Promise.resolve([{ id: evidence.authorization_intent_id }]);
    if (query.includes("update subscription_authorization_intents")) {
      return Promise.resolve([{ id: evidence.authorization_intent_id }]);
    }
    if (query.includes("update subscriptions s")) {
      return Promise.resolve([{ id: evidence.subscription_id }]);
    }
    return Promise.resolve([]);
  }) as unknown as postgres.TransactionSql;
  (transaction as unknown as { json(value: unknown): unknown }).json = (value) => value;
  const sql = vi.fn() as unknown as postgres.Sql;
  (sql as unknown as {
    begin<T>(work: (tx: postgres.TransactionSql) => Promise<T>): Promise<T>;
  }).begin = (work) => work(transaction);
  return {
    repository: createPostgresSubscriptionAuthorizationReconciliationRepository({ sql }),
    transaction
  };
}

function statefulPostgresFixture() {
  const evidence = evidenceRow();
  let intentState: "submitted" | "verified" | "expired" = "submitted";
  let attempts = 0;
  let completions = 0;
  const signatures: string[] = [];
  const queries: string[] = [];
  const transaction = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.join("?");
    queries.push(query);
    if (query.includes("left join lateral")) {
      return Promise.resolve(intentState === "submitted" ? [evidence] : []);
    }
    if (query.includes("select sai.id")) {
      return Promise.resolve(intentState === "submitted" ? [{ id: evidence.authorization_intent_id }] : []);
    }
    if (query.includes("update subscription_authorization_intents")) {
      signatures.push(String(values.at(-1)));
      intentState = values[0] === true
        ? "verified"
        : values[1] === true
          ? "expired"
          : "submitted";
      return Promise.resolve([{ id: evidence.authorization_intent_id }]);
    }
    if (query.includes("update subscriptions s")) {
      return Promise.resolve([{ id: evidence.subscription_id }]);
    }
    if (query.includes("insert into subscription_events")) {
      if (query.includes("subscription.authorization_reverification_attempted")) attempts += 1;
      if (query.includes("subscription.authorization_reverification_completed")) completions += 1;
    }
    return Promise.resolve([]);
  }) as unknown as postgres.TransactionSql;
  (transaction as unknown as { json(value: unknown): unknown }).json = (value) => value;
  const sql = vi.fn() as unknown as postgres.Sql;
  (sql as unknown as {
    begin<T>(work: (tx: postgres.TransactionSql) => Promise<T>): Promise<T>;
  }).begin = (work) => work(transaction);

  return {
    createRepository: () => createPostgresSubscriptionAuthorizationReconciliationRepository({ sql }),
    intentState: () => intentState,
    signaturesObserved: () => signatures,
    attemptCount: () => attempts,
    completionCount: () => completions,
    queries: () => queries
  };
}

function evidenceFixture(): PendingSubscriptionAuthorizationEvidence {
  return {
    authorizationIntentId: uuidFor(1),
    subscriptionId: uuidFor(2),
    subscriberUserId: uuidFor(3),
    signature: "accepted-signature",
    setupReference: uuidFor(4),
    authorityAddress: "authority",
    delegationAddress: "delegation",
    subscriberTokenAccount: "token-account",
    delegationProgramId: "program",
    collectorAddress: "collector",
    subscriberWallet: "subscriber",
    tokenMint: "mint",
    tokenProgram: "spl_token",
    amountMinor: 1_500,
    amountAtomic: "900719925474099312345",
    periodDays: 30,
    periodSeconds: 2_592_000,
    delegationExpiresAt: new Date("2027-11-05T12:00:00.000Z"),
    provider: "official_solana_subscription_program",
    planId: "platform_plus_monthly",
    planPda: null,
    subscriptionPda: null,
    merchantWallet: "merchant",
    expiresAt: new Date("2026-11-05T11:55:00.000Z"),
    acceptedAt: new Date("2026-11-05T11:54:00.000Z"),
    submittedAt: new Date("2026-11-05T11:54:00.000Z")
  };
}

function evidenceRow() {
  const evidence = evidenceFixture();
  return {
    authorization_intent_id: evidence.authorizationIntentId,
    subscription_id: evidence.subscriptionId,
    subscriber_user_id: evidence.subscriberUserId,
    setup_reference: evidence.setupReference,
    submitted_signature: evidence.signature,
    submitted_at: evidence.submittedAt,
    expires_at: evidence.expiresAt,
    authority_address: evidence.authorityAddress,
    delegation_address: evidence.delegationAddress,
    subscriber_token_account: evidence.subscriberTokenAccount,
    delegation_expires_at: evidence.delegationExpiresAt,
    collector_address: evidence.collectorAddress,
    subscriber_wallet: evidence.subscriberWallet,
    provider: evidence.provider,
    program_id: evidence.delegationProgramId,
    token_mint: evidence.tokenMint,
    token_program: evidence.tokenProgram,
    amount_minor: evidence.amountMinor,
    amount_atomic: evidence.amountAtomic,
    period_days: evidence.periodDays,
    period_seconds: evidence.periodSeconds,
    plan_id: evidence.planId,
    plan_pda: evidence.planPda,
    subscription_pda: evidence.subscriptionPda,
    merchant_wallet: evidence.merchantWallet,
    last_attempt_at: null
  };
}

function verifiedOutcome() {
  const evidence = evidenceFixture();
  return {
    verified: true as const,
    retryable: false,
    facts: {
      subscriberWallet: evidence.subscriberWallet as string,
      subscriberTokenAccount: evidence.subscriberTokenAccount,
      tokenMint: evidence.tokenMint as string,
      authorityAddress: evidence.authorityAddress,
      delegationAddress: evidence.delegationAddress,
      subscriptionPda: evidence.delegationAddress,
      planPda: null,
      programId: evidence.delegationProgramId,
      merchantWallet: evidence.merchantWallet,
      collectorWallet: evidence.collectorAddress,
      amountMinor: evidence.amountMinor,
      periodDays: evidence.periodDays,
      delegationExpiresAt: evidence.delegationExpiresAt.toISOString(),
      verifiedAt: "2026-11-05T12:00:00.000Z"
    }
  };
}

function uuidFor(value: number): string {
  return `00000000-0000-4000-8000-${value.toString(16).padStart(12, "0")}`;
}
