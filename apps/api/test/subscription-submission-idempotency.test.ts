import { describe, expect, it, vi } from "vitest";
import type { PostgresSql, PostgresTransaction } from "../src/shared/postgres.js";
import {
  applyAuthorizationVerificationToSubscription,
  findAuthorizationVerificationContext,
  submitAuthorization
} from "../src/modules/subscription/subscription-authorization-verification-repository.js";
import { MutationCommandIdempotencyConflictError } from "../src/shared/mutation-command-receipt.js";

describe("subscription authorization command receipts", () => {
  it("keeps verified intents discoverable for exact response replay", async () => {
    let query = "";
    const sql = vi.fn((strings: TemplateStringsArray) => {
      query = strings.join("?");
      return Promise.resolve([]);
    }) as unknown as PostgresSql;

    await findAuthorizationVerificationContext(sql, {
      supabaseUserId: uuidFor(1),
      authorizationIntentId: uuidFor(2),
      delegationProgramId: "program"
    });

    expect(query).toContain("sai.state in ('created', 'submitted', 'verified')");
  });

  it("serializes concurrent verified submissions and rejects a changed signature", async () => {
    const actorId = uuidFor(1);
    const intentId = uuidFor(2);
    const subscriptionId = uuidFor(3);
    let mutationCount = 0;
    let receipt: ReceiptRow | null = null;

    const transaction = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      const query = strings.join("?");
      if (query.includes("from mutation_command_receipts")) {
        return Promise.resolve(receipt ? [receipt] : []);
      }
      if (query.includes("insert into mutation_command_receipts")) {
        receipt = {
          target_type: String(values[2]),
          target_id: String(values[3]),
          request_version: Number(values[5]),
          request_body_hash: String(values[6]),
          response_status: Number(values[7]),
          response_body: typeof values[8] === "string" ? JSON.parse(values[8]) : values[8]
        };
        return Promise.resolve([]);
      }
      if (query.includes("update subscription_authorization_intents sai")) {
        mutationCount += 1;
        return Promise.resolve([authorizationUpdateRow(subscriptionId, intentId)]);
      }
      if (query.includes("from subscriptions s") && query.includes("join users u")) {
        return Promise.resolve([subscriptionRow(subscriptionId)]);
      }
      return Promise.resolve([]);
    }) as unknown as PostgresTransaction;
    (transaction as unknown as { json: (value: unknown) => unknown }).json = (value) => value;

    let queue = Promise.resolve();
    const sql = vi.fn((strings: TemplateStringsArray) => {
      if (strings.join("?").includes("from users")) return Promise.resolve([{ id: actorId }]);
      return Promise.resolve([]);
    }) as unknown as PostgresSql;
    (sql as unknown as {
      begin: <T>(work: (tx: PostgresTransaction) => Promise<T>) => Promise<T>;
    }).begin = <T>(work: (tx: PostgresTransaction) => Promise<T>) => {
      const result = queue.then(() => work(transaction));
      queue = result.then(() => undefined, () => undefined);
      return result;
    };
    const input = submissionInput(intentId);

    const [first, concurrentReplay] = await Promise.all([
      submitAuthorization(sql, input),
      submitAuthorization(sql, input)
    ]);
    const lostResponseReplay = await submitAuthorization(sql, input);

    expect(first).toEqual(subscriptionResponse(subscriptionId));
    expect(concurrentReplay).toEqual(first);
    expect(lostResponseReplay).toEqual(first);
    expect(mutationCount).toBe(1);
    expect(receipt).toMatchObject({
      target_type: "subscription_authorization_intent",
      target_id: intentId,
      response_status: 202
    });

    await expect(submitAuthorization(sql, {
      ...input,
      body: { signature: "changed-signature" }
    })).rejects.toBeInstanceOf(MutationCommandIdempotencyConflictError);
    expect(mutationCount).toBe(1);
  });

  it("guards canonical progression against cancellation, revocation, and signature replacement", async () => {
    let query = "";
    const transaction = vi.fn((strings: TemplateStringsArray) => {
      query = strings.join("?");
      return Promise.resolve([{ id: uuidFor(3) }]);
    }) as unknown as PostgresTransaction;

    await expect(applyAuthorizationVerificationToSubscription(transaction, {
      subscriptionId: uuidFor(3),
      signature: "accepted-signature",
      verification: submissionInput(uuidFor(2)).verification
    })).resolves.toBe(true);

    expect(query).toContain("s.state = 'authorization_pending'");
    expect(query).toContain("s.cancel_at_period_end = false");
    expect(query).toContain("s.cancelled_at is null");
    expect(query).toContain("s.revoked_at is null");
    expect(query).toContain("s.setup_signature is null or s.setup_signature = ?");
  });
});

interface ReceiptRow {
  target_type: string;
  target_id: string;
  request_version: number;
  request_body_hash: string;
  response_status: number;
  response_body: unknown;
}

function submissionInput(authorizationIntentId: string) {
  return {
    supabaseUserId: uuidFor(10),
    authorizationIntentId,
    idempotencyKey: "subscription-submit-1",
    body: { signature: "verified-signature-a" },
    verification: {
      verified: true as const,
      facts: {
        subscriberWallet: "subscriber-wallet",
        subscriberTokenAccount: "subscriber-token-account",
        tokenMint: "mint",
        authorityAddress: "authority",
        delegationAddress: "delegation",
        subscriptionPda: null,
        planPda: null,
        programId: "program",
        merchantWallet: "merchant",
        collectorWallet: "collector",
        amountMinor: 100,
        periodDays: 30,
        delegationExpiresAt: "2027-11-04T12:00:00.000Z",
        verifiedAt: "2026-11-04T12:00:00.000Z"
      }
    }
  };
}

function authorizationUpdateRow(subscriptionId: string, intentId: string) {
  return {
    ...subscriptionRow(subscriptionId),
    authorization_intent_id: intentId,
    plan_period_days: 30,
    plan_amount_minor: 100,
    plan_amount_atomic: 100,
    plan_creator_amount_atomic: 0,
    plan_platform_fee_amount_atomic: 100,
    plan_allocation_amount_atomic: 0,
    plan_currency: "USDC" as const
  };
}

function subscriptionRow(id: string) {
  return {
    id,
    created_at: new Date("2026-11-04T12:00:00.000Z"),
    scope: "platform" as const,
    plan_id: "platform_plus_monthly",
    state: "authorization_pending" as const,
    renewal_mode: "delegated_solana_subscription" as const,
    current_period_ends_at: null,
    next_collection_at: null,
    cancelled_at: null,
    revoked_at: null,
    authority_address: null,
    delegation_address: null,
    subscriber_wallet: "subscriber-wallet",
    subscriber_token_account: "subscriber-token-account",
    provider: "official_solana_subscription_program",
    program_id: "program",
    token_mint: "mint",
    amount_atomic: 100,
    period_seconds: 2_592_000,
    plan_pda: null,
    subscription_pda: null,
    failure_reason: null,
    merchant_wallet: "merchant",
    creator_user_id: null,
    creator_handle: null,
    creator_display_name: null,
    creator_avatar_url: null
  };
}

function subscriptionResponse(id: string) {
  return {
    id,
    scope: "platform",
    planId: "platform_plus_monthly",
    state: "authorization_pending",
    renewalMode: "delegated_solana_subscription",
    currentPeriodEndsAt: null,
    nextCollectionAt: null,
    cancelledAt: null,
    revokedAt: null,
    authorityAddress: null,
    delegationAddress: null,
    subscriberWallet: "subscriber-wallet",
    subscriberTokenAccount: "subscriber-token-account",
    tokenMint: "mint",
    provider: "official_solana_subscription_program",
    programId: "program",
    planPda: null,
    subscriptionPda: null,
    failureReason: null
  };
}

function uuidFor(value: number): string {
  return `00000000-0000-4000-8000-${value.toString(16).padStart(12, "0")}`;
}
