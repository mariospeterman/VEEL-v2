import type postgres from "postgres";
import { describe, expect, it, vi } from "vitest";
import { createAuthorizationIntent } from
  "../src/modules/subscription/subscription-authorization-intent-repository";
import { SubscriptionIdempotencyConflictError, SubscriptionPolicyError } from
  "../src/modules/subscription/subscription-errors";

const response = {
  id: "00000000-0000-4000-8000-000000000071",
  subscription: {
    id: "00000000-0000-4000-8000-000000000070",
    scope: "platform" as const,
    planId: "platform_plus_monthly",
    state: "authorization_pending" as const,
    renewalMode: "delegated_solana_subscription" as const,
    currentPeriodEndsAt: null,
    nextCollectionAt: null,
    cancelledAt: null,
    revokedAt: null,
    authorityAddress: null,
    delegationAddress: null,
    subscriberWallet: "11111111111111111111111111111111",
    subscriberTokenAccount: null,
    tokenMint: "USDC_MINT_CONFIG_REQUIRED",
    provider: "official_solana_subscription_program",
    programId: "De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44",
    planPda: null,
    subscriptionPda: null,
    failureReason: null
  },
  authorizationMode: "delegated_solana_subscription" as const,
  setupReference: "00000000-0000-4000-8000-000000000072",
  transactionRequestUrl: null,
  expiresAt: "2026-11-05T12:10:00.000Z",
  providerReadiness: {
    activeMode: "delegated_solana_subscription" as const,
    delegatedSubscriptions: "launch_approved" as const
  }
};

describe("subscription authorization intent idempotency", () => {
  it("replays the exact durable actor/action/key receipt before consulting mutable plan state", async () => {
    const { queries, sql } = receiptSql("request-hash");

    await expect(createAuthorizationIntent(sql, input())).resolves.toEqual(response);
    expect(queries.some((query) => query.includes("from subscription_plans"))).toBe(false);
    expect(queries.some((query) => query.includes("subscription_action_receipts"))).toBe(true);
  });

  it("rejects changed input against the durable actor/action/key receipt", async () => {
    const { sql } = receiptSql("different-request-hash");

    await expect(createAuthorizationIntent(sql, input()))
      .rejects.toBeInstanceOf(SubscriptionIdempotencyConflictError);
  });

  it("locks and revalidates current debit terms inside the acceptance transaction", async () => {
    const { queries, sql } = invalidPlanSql();

    await expect(createAuthorizationIntent(sql, input()))
      .rejects.toBeInstanceOf(SubscriptionPolicyError);

    const planQuery = queries.find((query) => query.includes("from subscription_plans sp"));
    expect(planQuery).toContain("for share of sp");
    expect(planQuery).toContain("sp.state = 'active'");
    expect(planQuery).toContain("sp.provider_state <> 'disabled'");
  });
});

function input() {
  return {
    supabaseUserId: "supabase-user",
    idempotencyKey: "intent-key",
    requestHash: "request-hash",
    body: {
      planId: "platform_plus_monthly",
      termsVersion: "subscription-recurring-terms-v1" as const,
      withdrawalWaiverVersion: "subscription-initial-access-waiver-v1" as const,
      immediateAccessAcknowledged: true as const
    },
    expiresAt: new Date("2026-11-05T12:10:00.000Z"),
    collectorAddress: "11111111111111111111111111111111",
    delegationProgramId: "De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44",
    provider: "official_solana_subscription_program",
    supportedMints: ["USDC_MINT_CONFIG_REQUIRED"],
    platformReceiverWallet: "11111111111111111111111111111111",
    assetDecimals: 6,
    network: "devnet" as const
  };
}

function receiptSql(receiptRequestHash: string): { queries: string[]; sql: postgres.Sql } {
  const queries: string[] = [];
  const sql = vi.fn((strings: TemplateStringsArray) => {
    const query = strings.join("?");
    queries.push(query);
    if (query.includes("from users")) {
      return Promise.resolve([{ id: "00000000-0000-4000-8000-000000000104" }]);
    }
    if (query.includes("from subscription_action_receipts")) {
      return Promise.resolve([{ request_hash: receiptRequestHash, response_body: response }]);
    }
    throw new Error(`unexpected_query:${query}`);
  }) as unknown as postgres.Sql;
  return { queries, sql };
}

function invalidPlanSql(): { queries: string[]; sql: postgres.Sql } {
  const queries: string[] = [];
  const actorId = "00000000-0000-4000-8000-000000000104";
  const transaction = vi.fn((strings: TemplateStringsArray) => {
    const query = strings.join("?");
    queries.push(query);
    if (query.includes("from subscription_action_receipts")) return Promise.resolve([]);
    if (query.includes("from subscription_authorization_intents")) return Promise.resolve([]);
    if (query.includes("from subscription_plans sp")) {
      return Promise.resolve([{
        id: "platform_plus_monthly",
        scope: "platform",
        label: "Plus",
        description: null,
        benefits: [],
        amount_minor: 899,
        asset_decimals: 6,
        amount_atomic: 8_990_001,
        currency: "USDC",
        period_days: 30,
        period_seconds: 2_592_000,
        billing_mode: "delegated_solana_subscription",
        provider_state: "launch_approved",
        token_mint: "USDC_MINT_CONFIG_REQUIRED",
        token_program: "spl_token",
        provider: "official_solana_subscription_program",
        program_id: "De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44",
        plan_pda: null,
        merchant_wallet: null,
        creator_amount_atomic: 0,
        platform_fee_amount_atomic: 8_990_001,
        allocation_amount_atomic: 0,
        creator_user_id: null,
        creator_handle: null,
        creator_display_name: null,
        creator_avatar_url: null
      }]);
    }
    return Promise.resolve([]);
  }) as unknown as postgres.TransactionSql;
  (transaction as unknown as { json(value: unknown): unknown }).json = (value) => value;
  const sql = vi.fn((strings: TemplateStringsArray) => {
    const query = strings.join("?");
    queries.push(query);
    if (query.includes("from users")) return Promise.resolve([{ id: actorId }]);
    if (query.includes("from subscription_action_receipts")) return Promise.resolve([]);
    if (query.includes("from subscription_authorization_intents")) return Promise.resolve([]);
    if (query.includes("from wallets")) {
      return Promise.resolve([{ address: "11111111111111111111111111111111" }]);
    }
    throw new Error(`unexpected_query:${query}`);
  }) as unknown as postgres.Sql;
  (sql as unknown as {
    begin<T>(work: (tx: postgres.TransactionSql) => Promise<T>): Promise<T>;
  }).begin = (work) => work(transaction);
  return { queries, sql };
}
