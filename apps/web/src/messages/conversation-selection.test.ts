import { describe, expect, it } from "vitest";
import {
  conversationReadAttemptKey,
  findSelectedConversation,
  replyForConversation
} from "./conversation-selection";

const conversations = [{ id: "first" }, { id: "second" }];

describe("message conversation selection", () => {
  it("keeps the inbox visible when the URL has no conversation", () => {
    expect(findSelectedConversation(conversations, null)).toBeNull();
  });

  it("does not silently replace an invalid URL selection with the first thread", () => {
    expect(findSelectedConversation(conversations, "missing")).toBeNull();
  });

  it("returns the explicitly selected conversation", () => {
    expect(findSelectedConversation(conversations, "second")).toEqual({ id: "second" });
  });
});

describe("conversation-local state", () => {
  it("does not carry a reply target into another thread", () => {
    const reply = { conversationId: "thread-a", message: { id: "message-a" } };

    expect(replyForConversation(reply, "thread-a")).toEqual({ id: "message-a" });
    expect(replyForConversation(reply, "thread-b")).toBeNull();
    expect(replyForConversation(reply, null)).toBeNull();
  });

  it("keys read attempts by the open thread and its latest unread count", () => {
    const threadA = { id: "thread-a", requestState: "accepted", unreadCount: 1 };
    const threadB = { id: "thread-b", requestState: "accepted", unreadCount: 2 };

    expect(conversationReadAttemptKey(threadA, true)).toBe("thread-a:1");
    expect(conversationReadAttemptKey(threadB, true)).toBe("thread-b:2");
    expect(conversationReadAttemptKey({ ...threadA, unreadCount: 2 }, true)).toBe("thread-a:2");
    expect(conversationReadAttemptKey(threadA, false)).toBeNull();
  });
});
