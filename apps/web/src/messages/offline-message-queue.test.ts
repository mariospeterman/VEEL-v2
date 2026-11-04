import { describe, expect, it } from "vitest";
import {
  claimOfflineMessageSession,
  classifyMessageFailure,
  clearPrivateMessageClientState,
  createOfflineMessage,
  enqueueOfflineMessage,
  legacyOfflineMessageQueueKey,
  offlineMessageQueueLimit,
  readOfflineMessages,
  updateOfflineMessage
} from "./offline-message-queue";

describe("offline message queue", () => {
  it("never exposes or replays one actor's queued body after logout and account switch", () => {
    const local = new MemoryStorage();
    const session = new MemoryStorage();
    const actorA = "00000000-0000-4000-8000-000000000001";
    const actorB = "00000000-0000-4000-8000-000000000002";
    const conversationId = "00000000-0000-4000-8000-000000000010";
    const browserSessionA = claimOfflineMessageSession(local, session, actorA, () => "browser-a");
    const queued = createOfflineMessage(
      { actorUserId: actorA, browserSessionId: browserSessionA, conversationId },
      request("private A body"),
      new Date("2026-11-04T10:00:00.000Z"),
      sequenceIds("client-a", "key-a")
    );
    expect(enqueueOfflineMessage(local, queued)).toBe(true);

    clearPrivateMessageClientState(local, session);
    const browserSessionB = claimOfflineMessageSession(local, session, actorB, () => "browser-b");
    expect(readOfflineMessages(local, {
      actorUserId: actorB,
      browserSessionId: browserSessionB,
      conversationId
    })).toEqual([]);
    expect(JSON.stringify(local.values())).not.toContain("private A body");
  });

  it("creates distinct logical sends for byte-identical requests and preserves retry keys", () => {
    const local = new MemoryStorage();
    const scope = {
      actorUserId: "00000000-0000-4000-8000-000000000001",
      browserSessionId: "browser-a",
      conversationId: "00000000-0000-4000-8000-000000000010"
    };
    const first = createOfflineMessage(scope, request("same"), new Date("2026-11-04T10:00:00.000Z"), sequenceIds("client-1", "key-1"));
    const second = createOfflineMessage(scope, request("same"), new Date("2026-11-04T10:00:01.000Z"), sequenceIds("client-2", "key-2"));
    expect(enqueueOfflineMessage(local, first)).toBe(true);
    expect(enqueueOfflineMessage(local, second)).toBe(true);

    expect(updateOfflineMessage(local, scope, { ...first, state: "retrying", attemptCount: 1 })).toBe(true);
    expect(readOfflineMessages(local, scope).map((item) => [item.clientMessageId, item.idempotencyKey])).toEqual([
      ["client-1", "key-1"],
      ["client-2", "key-2"]
    ]);
  });

  it("refuses the 26th item without evicting older private messages", () => {
    const local = new MemoryStorage();
    const scope = {
      actorUserId: "00000000-0000-4000-8000-000000000001",
      browserSessionId: "browser-a",
      conversationId: "00000000-0000-4000-8000-000000000010"
    };
    for (let index = 0; index < offlineMessageQueueLimit; index += 1) {
      expect(enqueueOfflineMessage(local, createOfflineMessage(
        scope,
        request(`message-${index}`),
        new Date("2026-11-04T10:00:00.000Z"),
        sequenceIds(`client-${index}`, `key-${index}`)
      ))).toBe(true);
    }
    expect(enqueueOfflineMessage(local, createOfflineMessage(
      scope,
      request("overflow"),
      new Date("2026-11-04T10:00:00.000Z"),
      sequenceIds("client-overflow", "key-overflow")
    ))).toBe(false);
    expect(readOfflineMessages(local, scope)).toHaveLength(offlineMessageQueueLimit);
    expect(JSON.stringify(local.values())).not.toContain("overflow");
  });

  it.each([
    [undefined, "auto_retry"], [408, "auto_retry"], [425, "auto_retry"],
    [429, "auto_retry"], [500, "auto_retry"], [503, "auto_retry"],
    [401, "pause_auth"], [400, "manual_attention"], [403, "manual_attention"],
    [404, "manual_attention"], [409, "manual_attention"], [422, "manual_attention"]
  ] as const)("classifies status %s as %s", (status, expected) => {
    expect(classifyMessageFailure(status)).toBe(expected);
  });

  it("purges the legacy unowned plaintext queue", () => {
    const local = new MemoryStorage([[legacyOfflineMessageQueueKey, '[{"body":"legacy"}]']]);
    const session = new MemoryStorage();
    claimOfflineMessageSession(local, session, "actor-a", () => "browser-a");
    expect(local.getItem(legacyOfflineMessageQueueKey)).toBeNull();
  });
});

function request(body: string) {
  return { body, replyToMessageId: null, sharedContentItemId: null, attachmentContentItemIds: [] };
}

function sequenceIds(...ids: string[]) {
  let index = 0;
  return () => ids[index++] as string;
}

class MemoryStorage {
  private readonly data = new Map<string, string>();

  constructor(entries: Array<[string, string]> = []) {
    for (const [key, value] of entries) this.data.set(key, value);
  }

  get length() { return this.data.size; }
  key(index: number) { return [...this.data.keys()][index] ?? null; }
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { this.data.set(key, value); }
  removeItem(key: string) { this.data.delete(key); }
  values() { return [...this.data.values()]; }
}
