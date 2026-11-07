import { describe, expect, it } from "vitest";
import {
  subscriptionCursor,
  subscriptionPageHref
} from "./subscription-page-navigation";

describe("subscription page navigation", () => {
  it("advances one bounded scope without consuming or dropping the other scopes", () => {
    expect(subscriptionPageHref({
      searchParams: {
        platformCursor: "platform-page-2",
        creatorCursor: "creator-page-3",
        historyCursor: "history-page-4"
      },
      cursorKey: "creatorCursor",
      cursor: "creator-page-4/value"
    })).toBe(
      "/app/subscriptions?platformCursor=platform-page-2&historyCursor=history-page-4&creatorCursor=creator-page-4%2Fvalue"
    );
  });

  it("bounds scalar cursor input and ignores duplicate query values after the first", () => {
    expect(subscriptionCursor({ historyCursor: ["first", "second"] }, "historyCursor")).toBe("first");
    expect(subscriptionCursor({ platformCursor: "x".repeat(4_097) }, "platformCursor")).toBeUndefined();
  });
});
