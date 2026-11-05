import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimOfflineMessageDelivery,
  claimOfflineMessageSession,
  classifyMessageFailure,
  clearPrivateMessageClientState,
  createOfflineMessage,
  enqueueOfflineMessage,
  isOfflineMessageStorageKeyForScope,
  legacyOfflineMessageQueueKey,
  offlineMessageQueueKey,
  offlineMessageQueueLimit,
  readOfflineMessages,
  updateOfflineMessage,
  type OfflineMessageScope
} from "./offline-message-queue";

describe("offline message queue", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-04T10:05:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("never exposes or replays one actor's queued body after logout and account switch", () => {
    const local = new MemoryStorage();
    const session = new MemoryStorage();
    const actorA = "00000000-0000-4000-8000-000000000001";
    const actorB = "00000000-0000-4000-8000-000000000002";
    const conversationId = "00000000-0000-4000-8000-000000000010";
    const browserTabA = claimOfflineMessageSession(local, session, actorA, "session-a", () => "tab-a");
    const queued = createOfflineMessage(
      scope(actorA, "session-a", browserTabA, conversationId),
      request("private A body"),
      new Date("2026-11-04T10:00:00.000Z"),
      sequenceIds("client-a", "key-a")
    );
    expect(enqueueOfflineMessage(local, queued)).toBe(true);

    clearPrivateMessageClientState(local, session);
    const browserTabB = claimOfflineMessageSession(local, session, actorB, "session-b", () => "tab-b");
    expect(readOfflineMessages(local, scope(actorB, "session-b", browserTabB, conversationId))).toEqual([]);
    expect(JSON.stringify(local.values())).not.toContain("private A body");
  });

  it("keeps same-account queues isolated and intact when a second tab opens", () => {
    const local = new MemoryStorage();
    const firstTabSession = new MemoryStorage();
    const secondTabSession = new MemoryStorage();
    const actor = "00000000-0000-4000-8000-000000000001";
    const conversationId = "00000000-0000-4000-8000-000000000010";
    const firstTabId = claimOfflineMessageSession(local, firstTabSession, actor, "session-a", () => "tab-a");
    const firstScope = scope(actor, "session-a", firstTabId, conversationId);
    expect(enqueueOfflineMessage(local, createOfflineMessage(
      firstScope,
      request("first tab private body"),
      new Date("2026-11-04T10:00:00.000Z"),
      sequenceIds("client-a", "key-a")
    ))).toBe(true);

    const secondTabId = claimOfflineMessageSession(local, secondTabSession, actor, "session-a", () => "tab-b");
    const secondScope = scope(actor, "session-a", secondTabId, conversationId);

    expect(secondTabId).toBe("tab-b");
    expect(readOfflineMessages(local, secondScope)).toEqual([]);
    expect(readOfflineMessages(local, firstScope)).toHaveLength(1);
    expect(JSON.stringify(local.values())).toContain("first tab private body");
  });

  it("reuses a tab marker across reloads and clears only that tab on actor or app-session rotation", () => {
    const local = new MemoryStorage();
    const firstTabSession = new MemoryStorage();
    const otherTabSession = new MemoryStorage();
    const conversationId = "00000000-0000-4000-8000-000000000010";
    const firstScope = scope("actor-a", "session-a", claimOfflineMessageSession(
      local,
      firstTabSession,
      "actor-a",
      "session-a",
      () => "tab-a"
    ), conversationId);
    const otherScope = scope("actor-a", "session-a", claimOfflineMessageSession(
      local,
      otherTabSession,
      "actor-a",
      "session-a",
      () => "tab-b"
    ), conversationId);
    enqueueOfflineMessage(local, createOfflineMessage(firstScope, request("first"), new Date(), sequenceIds("c1", "k1")));
    enqueueOfflineMessage(local, createOfflineMessage(otherScope, request("other"), new Date(), sequenceIds("c2", "k2")));

    expect(claimOfflineMessageSession(
      local,
      firstTabSession,
      "actor-a",
      "session-a",
      () => { throw new Error("must reuse the existing tab id"); }
    )).toBe("tab-a");

    const rotatedTabId = claimOfflineMessageSession(
      local,
      firstTabSession,
      "actor-a",
      "session-b",
      () => "tab-a-rotated"
    );
    expect(rotatedTabId).toBe("tab-a-rotated");
    expect(readOfflineMessages(local, firstScope)).toEqual([]);
    expect(readOfflineMessages(local, otherScope)).toHaveLength(1);
  });

  it("purges expired abandoned-tab records without deleting another tab's live queue", () => {
    const local = new MemoryStorage();
    const liveScope = scope("actor-a", "session-a", "tab-live", "conversation-a");
    const expiredScope = scope("actor-a", "session-a", "tab-expired", "conversation-a");
    const live = createOfflineMessage(
      liveScope,
      request("live"),
      new Date(Date.now() - 60_000),
      sequenceIds("live-client", "live-key")
    );
    const expired = {
      ...createOfflineMessage(expiredScope, request("expired"), new Date(), sequenceIds("old-client", "old-key")),
      expiresAt: new Date(Date.now() - 1).toISOString()
    };
    local.setItem(offlineMessageQueueKey(liveScope), JSON.stringify([live]));
    local.setItem(offlineMessageQueueKey(expiredScope), JSON.stringify([expired]));

    claimOfflineMessageSession(local, new MemoryStorage(), "actor-a", "session-a", () => "new-tab");

    expect(readOfflineMessages(local, liveScope)).toHaveLength(1);
    expect(local.getItem(offlineMessageQueueKey(expiredScope))).toBeNull();
  });

  it("leases a duplicated-tab send to one page instance and safely reclaims a stale lease", () => {
    const local = new MemoryStorage();
    const messageScope = scope("actor-a", "session-a", "cloned-tab", "conversation-a");
    const original = createOfflineMessage(
      messageScope,
      request("send once"),
      new Date("2026-11-04T10:00:00.000Z"),
      sequenceIds("client-a", "stable-key")
    );
    enqueueOfflineMessage(local, original);

    const first = claimOfflineMessageDelivery(
      local,
      messageScope,
      original.clientMessageId,
      "page-a",
      new Date("2026-11-04T10:00:01.000Z"),
      1_000
    );
    const blocked = claimOfflineMessageDelivery(
      local,
      messageScope,
      original.clientMessageId,
      "page-b",
      new Date("2026-11-04T10:00:01.500Z"),
      1_000
    );
    const reclaimed = claimOfflineMessageDelivery(
      local,
      messageScope,
      original.clientMessageId,
      "page-b",
      new Date("2026-11-04T10:00:02.001Z"),
      1_000
    );

    expect(first?.deliveryLeaseOwnerId).toBe("page-a");
    expect(blocked).toBeNull();
    expect(reclaimed).toMatchObject({
      clientMessageId: "client-a",
      idempotencyKey: "stable-key",
      deliveryLeaseOwnerId: "page-b",
      state: "sending"
    });
  });

  it("creates distinct logical sends for byte-identical requests and preserves retry keys", () => {
    const local = new MemoryStorage();
    const messageScope = scope(
      "00000000-0000-4000-8000-000000000001",
      "session-a",
      "tab-a",
      "00000000-0000-4000-8000-000000000010"
    );
    const first = createOfflineMessage(messageScope, request("same"), new Date("2026-11-04T10:00:00.000Z"), sequenceIds("client-1", "key-1"));
    const second = createOfflineMessage(messageScope, request("same"), new Date("2026-11-04T10:00:01.000Z"), sequenceIds("client-2", "key-2"));
    expect(enqueueOfflineMessage(local, first)).toBe(true);
    expect(enqueueOfflineMessage(local, second)).toBe(true);

    expect(updateOfflineMessage(local, messageScope, { ...first, state: "retrying", attemptCount: 1 })).toBe(true);
    expect(readOfflineMessages(local, messageScope).map((item) => [item.clientMessageId, item.idempotencyKey])).toEqual([
      ["client-1", "key-1"],
      ["client-2", "key-2"]
    ]);
  });

  it("refuses the 26th item without evicting older private messages", () => {
    const local = new MemoryStorage();
    const messageScope = scope(
      "00000000-0000-4000-8000-000000000001",
      "session-a",
      "tab-a",
      "00000000-0000-4000-8000-000000000010"
    );
    for (let index = 0; index < offlineMessageQueueLimit; index += 1) {
      expect(enqueueOfflineMessage(local, createOfflineMessage(
        messageScope,
        request(`message-${index}`),
        new Date("2026-11-04T10:00:00.000Z"),
        sequenceIds(`client-${index}`, `key-${index}`)
      ))).toBe(true);
    }
    expect(enqueueOfflineMessage(local, createOfflineMessage(
      messageScope,
      request("overflow"),
      new Date("2026-11-04T10:00:00.000Z"),
      sequenceIds("client-overflow", "key-overflow")
    ))).toBe(false);
    expect(readOfflineMessages(local, messageScope)).toHaveLength(offlineMessageQueueLimit);
    expect(JSON.stringify(local.values())).not.toContain("overflow");
  });

  it("matches storage events only to the exact actor, app session, tab, and conversation", () => {
    const messageScope = scope("actor-a", "session-a", "tab-a", "conversation-a");
    expect(isOfflineMessageStorageKeyForScope(offlineMessageQueueKey(messageScope), messageScope)).toBe(true);
    expect(isOfflineMessageStorageKeyForScope(
      offlineMessageQueueKey({ ...messageScope, browserTabId: "tab-b" }),
      messageScope
    )).toBe(false);
    expect(isOfflineMessageStorageKeyForScope(null, messageScope)).toBe(false);
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
    claimOfflineMessageSession(local, session, "actor-a", "session-a", () => "tab-a");
    expect(local.getItem(legacyOfflineMessageQueueKey)).toBeNull();
  });
});

function scope(
  actorUserId: string,
  clientSessionScope: string,
  browserTabId: string,
  conversationId: string
): OfflineMessageScope {
  return { actorUserId, clientSessionScope, browserTabId, conversationId };
}

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
