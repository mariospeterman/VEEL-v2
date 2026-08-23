import { describe, expect, it, vi } from "vitest";
import type { PostgresTransaction } from "../src/shared/postgres";
import {
  settleCreatorMediaOffer,
  settleStructuredCreatorRequest
} from "../src/modules/payment/payment-creator-commercial-settlement";

describe("structured creator request settlement", () => {
  it("activates delivery only while the accepted conversation remains eligible", async () => {
    const { transaction, queries, values } = transactionWithRequest(true);

    await expect(settleStructuredCreatorRequest(transaction, {
      userId: "buyer-1",
      paymentIntentId: "intent-1"
    })).resolves.toBe(true);

    expect(queries.join("\n")).toContain("set state = 'active'");
    expect(queries.join("\n")).not.toContain("set state = 'remediation'");
    expect(queries[0]).toContain("request.payment_intent_id = intent.id");
    expect(queries[0]).toContain("request.expires_at > now()");
    expect(values).toContain("creator_request.activated_after_settlement");
  });

  it("keeps verified payment truth but enters remediation when consent changed", async () => {
    const { transaction, queries, values } = transactionWithRequest(false);

    await expect(settleStructuredCreatorRequest(transaction, {
      userId: "buyer-1",
      paymentIntentId: "intent-2"
    })).resolves.toBe(true);

    expect(queries.join("\n")).toContain("set state = 'remediation'");
    expect(queries.join("\n")).not.toContain("set state = 'active'");
    expect(values).toContain("creator_request.remediation_after_settlement");
  });

  it("returns false so historical paid-message settlement remains compatible", async () => {
    const queries: string[] = [];
    const transaction = vi.fn((strings: TemplateStringsArray) => {
      queries.push(strings.join("?"));
      return Promise.resolve([]);
    }) as unknown as PostgresTransaction;
    Object.assign(transaction, { json: (value: unknown) => value });

    await expect(settleStructuredCreatorRequest(transaction, {
      userId: "buyer-1",
      paymentIntentId: "historical-intent"
    })).resolves.toBe(false);
    expect(queries).toHaveLength(1);
  });
});

describe("creator media offer settlement", () => {
  it("returns the exact content target only when offer consent remains eligible", async () => {
    const { transaction, queries } = mediaOfferTransaction(true);
    await expect(settleCreatorMediaOffer(transaction, {
      userId: "buyer-1",
      paymentIntentId: "intent-1"
    })).resolves.toEqual({ kind: "purchased", contentItemId: "content-1" });
    expect(queries.join("\n")).toContain("set state = 'purchased'");
    expect(queries.join("\n")).not.toContain("set state = 'remediation'");
    expect(queries[0]).toContain("offer.payment_intent_id = intent.id");
  });

  it("withholds entitlement and records remediation after a consent change", async () => {
    const { transaction, queries } = mediaOfferTransaction(false);
    await expect(settleCreatorMediaOffer(transaction, {
      userId: "buyer-1",
      paymentIntentId: "intent-2"
    })).resolves.toEqual({ kind: "remediation" });
    expect(queries.join("\n")).toContain("set state = 'remediation'");
  });
});

function transactionWithRequest(eligible: boolean) {
  const queries: string[] = [];
  const values: unknown[] = [];
  let queryIndex = 0;
  const transaction = vi.fn((strings: TemplateStringsArray, ...queryValues: unknown[]) => {
    queries.push(strings.join("?"));
    values.push(...queryValues);
    queryIndex += 1;
    if (queryIndex === 1) {
      return Promise.resolve([{
        id: "request-1",
        conversation_id: "conversation-1",
        creator_user_id: "creator-1",
        state: "payment_pending",
        eligible
      }]);
    }
    return Promise.resolve([]);
  }) as unknown as PostgresTransaction;
  Object.assign(transaction, { json: (value: unknown) => value });
  return { transaction, queries, values };
}

function mediaOfferTransaction(eligible: boolean) {
  const queries: string[] = [];
  let queryIndex = 0;
  const transaction = vi.fn((strings: TemplateStringsArray) => {
    queries.push(strings.join("?"));
    queryIndex += 1;
    if (queryIndex === 1) {
      return Promise.resolve([{
        id: "offer-1",
        content_item_id: "content-1",
        content_revision: 1,
        buyer_user_id: "buyer-1",
        creator_user_id: "creator-1",
        conversation_id: "conversation-1",
        eligible
      }]);
    }
    return Promise.resolve([]);
  }) as unknown as PostgresTransaction;
  Object.assign(transaction, { json: (value: unknown) => value });
  return { transaction, queries };
}
