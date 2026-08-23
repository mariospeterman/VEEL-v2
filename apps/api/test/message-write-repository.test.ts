import { describe, expect, it } from "vitest";
import type postgres from "postgres";
import { createMessage } from "../src/modules/message/message-write-repository";

describe("message notification delivery", () => {
  it("makes notification creation conditional on the recipient not muting the conversation", async () => {
    const queries: string[] = [];
    const transaction = (async (strings: TemplateStringsArray) => {
      const query = strings.join("?");
      queries.push(query);
      if (query.includes("join conversation_members own_member")) {
        return [{
          actor_id: "actor-1",
          other_user_id: "recipient-1",
          conversation_state: "active",
          request_state: "accepted",
          initiator_user_id: "actor-1",
          recipient_user_id: "recipient-1",
          requester_message_count: 1
        }];
      }
      if (query.includes("as blocked")) return [{ blocked: false }];
      if (query.includes("as trusted")) return [{ trusted: false }];
      if (query.includes("from messages m") && query.includes("idempotency_key")) return [];
      if (query.includes("from messages m") && query.includes("where m.id")) {
        return [{
          id: "message-1",
          conversation_id: "conversation-1",
          body: "Hello",
          delivery_state: "visible",
          payment_intent_id: null,
          reply_to_message_id: null,
          shared_content_item_id: null,
          attachments: [],
          reactions: [],
          created_at: new Date("2026-08-23T12:00:00.000Z"),
          sender_id: "actor-1",
          sender_handle: "creator",
          sender_display_name: "Creator",
          sender_avatar_url: null
        }];
      }
      return [];
    }) as unknown as postgres.TransactionSql;
    transaction.json = ((value: unknown) => value) as postgres.TransactionSql["json"];
    const sql = {
      begin: async (run: (tx: postgres.TransactionSql) => Promise<unknown>) => run(transaction)
    } as unknown as postgres.Sql;

    await createMessage(sql, {
      supabaseUserId: "supabase-actor",
      conversationId: "conversation-1",
      body: "Hello",
      idempotencyKey: "message-1"
    });

    const notificationQuery = queries.find((query) => query.includes("insert into notifications"));
    expect(notificationQuery).toContain("from conversation_members recipient_member");
    expect(notificationQuery).toContain("recipient_member.muted_at is null");
  });
});
