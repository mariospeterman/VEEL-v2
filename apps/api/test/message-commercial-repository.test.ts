import { describe, expect, it, vi } from "vitest";
import type postgres from "postgres";
import { listCommercialInteractions } from "../src/modules/message/message-commercial-repository";

describe("message commercial projections", () => {
  it("projects unpaid expired interactions as expired instead of actionable", async () => {
    const expiredAt = new Date(Date.now() - 60_000);
    const createdAt = new Date(Date.now() - 120_000);
    const sql = vi.fn((strings: TemplateStringsArray) => {
      const query = strings.join("?");
      if (query.includes("from users actor")) {
        return Promise.resolve([{
          actor_id: "buyer-1",
          other_user_id: "creator-1",
          request_state: "accepted",
          blocked: false
        }]);
      }
      if (query.includes("from creator_media_offers")) {
        return Promise.resolve([{
          id: "offer-1",
          conversation_id: "conversation-1",
          creator_user_id: "creator-1",
          buyer_user_id: "buyer-1",
          content_item_id: "content-1",
          content_revision: 2,
          title: "Expired offer",
          description: null,
          amount_minor: 10,
          currency: "SOL",
          state: "offered",
          payment_intent_id: null,
          expires_at: expiredAt,
          purchased_at: null,
          created_at: createdAt,
          updated_at: createdAt
        }]);
      }
      return Promise.resolve([{
        id: "request-1",
        conversation_id: "conversation-1",
        requester_user_id: "buyer-1",
        creator_user_id: "creator-1",
        deliverable: "One approved clip",
        permitted_category: "video",
        proposed_amount_minor: 10,
        agreed_amount_minor: 10,
        currency: "SOL",
        expected_delivery_days: 7,
        clarification_rule: "One clarification",
        cancellation_rule: "Cancel before payment",
        state: "accepted",
        payment_intent_id: null,
        expires_at: expiredAt,
        accepted_at: createdAt,
        activated_at: null,
        delivered_at: null,
        completed_at: null,
        created_at: createdAt,
        updated_at: createdAt
      }]);
    }) as unknown as postgres.Sql;

    const result = await listCommercialInteractions(sql, {
      supabaseUserId: "supabase-buyer",
      conversationId: "conversation-1"
    });

    expect(result?.mediaOffers[0]?.state).toBe("expired");
    expect(result?.creatorRequests[0]?.state).toBe("expired");
  });
});
