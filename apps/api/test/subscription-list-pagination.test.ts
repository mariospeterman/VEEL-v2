import { describe, expect, it, vi } from "vitest";
import type { PostgresSql } from "../src/shared/postgres.js";
import { createPostgresSubscriptionRepository } from "../src/modules/subscription/subscription-repository.js";
import { sanitizeSubscriptionFailureReason } from "../src/modules/subscription/subscription-repository-mappers.js";

describe("bounded subscription projections", () => {
  it("projects only sanitized, actionable failure categories", () => {
    expect(sanitizeSubscriptionFailureReason("insufficient_allowance")).toBe("insufficient_funds");
    expect(sanitizeSubscriptionFailureReason("subscription_delegation_revoked"))
      .toBe("authorization_revoked");
    expect(sanitizeSubscriptionFailureReason("subscription_collection_rpc_failed"))
      .toBe("provider_unavailable");
    expect(sanitizeSubscriptionFailureReason("plan_terms_mismatch:provider-detail"))
      .toBe("setup_mismatch");
    expect(sanitizeSubscriptionFailureReason(null)).toBeNull();
  });

  it("bounds the platform catalog and resumes after the last visible plan", async () => {
    const plans = Array.from({ length: 21 }, (_, index) => planRow(index + 1));
    const sql = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      const query = strings.join("?");
      expect(query).toContain("where sp.scope = 'platform'");
      const afterId = values[0] as string | null;
      const limit = values[2] as number;
      return Promise.resolve(plans.filter((plan) => !afterId || plan.id > afterId).slice(0, limit));
    }) as unknown as PostgresSql;
    const repository = createPostgresSubscriptionRepository(sql);

    const first = await repository.listPlans({ supabaseUserId: uuidFor(900), limit: 20 });
    if (!first.nextCursor) throw new Error("EXPECTED_PLAN_CURSOR");
    const second = await repository.listPlans({
      supabaseUserId: uuidFor(900),
      limit: 20,
      cursor: first.nextCursor
    });

    expect(first.items).toHaveLength(20);
    expect(first.nextCursor).toBeTruthy();
    expect(second.items.map((plan) => plan.id)).toEqual([plans[20]?.id]);
    expect(second.nextCursor).toBeNull();
  });

  it("walks tied active subscriptions once and preserves the server-owned filter", async () => {
    const createdAt = new Date("2026-11-04T12:00:00.000Z");
    const rows = Array.from({ length: 21 }, (_, index) => subscriptionRow(index + 1, createdAt))
      .sort((left, right) => right.id.localeCompare(left.id));
    const sql = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      const query = strings.join("?");
      expect(query).toContain("'authorization_pending', 'active', 'renewal_pending', 'grace_period'");
      expect(values.slice(1, 5)).toEqual(["creator", "creator", "active", "active"]);
      const timestamp = values[5] as string | null;
      const id = values[8] as string | null;
      const limit = values[10] as number;
      return Promise.resolve(rows.filter((row) => {
        if (!timestamp) return true;
        const value = row.created_at.toISOString();
        return value < timestamp || (value === timestamp && (!id || row.id < id));
      }).slice(0, limit));
    }) as unknown as PostgresSql;
    const repository = createPostgresSubscriptionRepository(sql);
    const seen: string[] = [];
    let cursor: string | undefined;

    do {
      const page = await repository.listSubscriptions({
        supabaseUserId: uuidFor(900),
        limit: 5,
        view: "active",
        scope: "creator",
        ...(cursor ? { cursor } : {})
      });
      seen.push(...page.items.map((subscription) => subscription.id));
      expect(page.items.every((subscription) => subscription.failureReason === "insufficient_funds"))
        .toBe(true);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);

    expect(seen).toEqual(rows.map((row) => row.id));
    expect(new Set(seen)).toHaveLength(21);
  });
});

function planRow(index: number) {
  return {
    id: `platform_${index.toString().padStart(3, "0")}`,
    scope: "platform" as const,
    label: `Plan ${index}`,
    description: null,
    benefits: [],
    amount_minor: index,
    amount_atomic: index,
    currency: "USDC" as const,
    period_days: 30,
    period_seconds: 2_592_000,
    billing_mode: "delegated_solana_subscription" as const,
    provider_state: "staging_required" as const,
    token_mint: "mint",
    token_program: "spl_token" as const,
    provider: "official_solana_subscription_program",
    program_id: "program",
    plan_pda: null,
    merchant_wallet: "merchant",
    creator_user_id: null,
    creator_handle: null,
    creator_display_name: null,
    creator_avatar_url: null
  };
}

function subscriptionRow(index: number, createdAt: Date) {
  return {
    id: uuidFor(index),
    created_at: createdAt,
    scope: "creator" as const,
    plan_id: "creator_plan",
    state: "grace_period" as const,
    renewal_mode: "delegated_solana_subscription" as const,
    current_period_ends_at: null,
    next_collection_at: null,
    cancelled_at: null,
    revoked_at: null,
    authority_address: null,
    delegation_address: null,
    subscriber_wallet: null,
    subscriber_token_account: null,
    provider: "official_solana_subscription_program",
    program_id: "program",
    token_mint: "mint",
    amount_atomic: 10,
    period_seconds: 2_592_000,
    plan_pda: null,
    subscription_pda: null,
    failure_reason: "insufficient_allowance",
    merchant_wallet: null,
    creator_user_id: uuidFor(700),
    creator_handle: "creator",
    creator_display_name: "Creator",
    creator_avatar_url: null
  };
}

function uuidFor(value: number): string {
  return `00000000-0000-4000-8000-${value.toString(16).padStart(12, "0")}`;
}
