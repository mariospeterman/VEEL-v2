import { describe, expect, it, vi } from "vitest";
import {
  notifyUserScopeInvalidation,
  sameSessionAuthority,
  sessionAuthority,
  userScopeInvalidationEvent,
  userScopeInvalidationStorageKey
} from "./user-scope-invalidation";

describe("user scope invalidation", () => {
  it("matches both canonical user and rotated application-session scope", () => {
    const expected = { userId: "user-a", clientSessionScope: "scope-a" };
    expect(sameSessionAuthority(expected, {
      authenticated: true,
      clientSessionScope: "scope-a",
      user: { id: "user-a" }
    })).toBe(true);
    expect(sameSessionAuthority(expected, {
      authenticated: true,
      clientSessionScope: "scope-b",
      user: { id: "user-a" }
    })).toBe(false);
    expect(sameSessionAuthority(expected, {
      authenticated: true,
      clientSessionScope: "scope-a",
      user: { id: "user-b" }
    })).toBe(false);
    expect(sessionAuthority({ authenticated: false, clientSessionScope: "anonymous" })).toBeNull();
  });

  it("emits a transient cross-tab marker and a same-tab event", () => {
    const values = new Map<string, string>();
    const storage = {
      setItem: vi.fn((key: string, value: string) => values.set(key, value)),
      removeItem: vi.fn((key: string) => values.delete(key))
    };
    const target = new EventTarget();
    const listener = vi.fn();
    target.addEventListener(userScopeInvalidationEvent, listener);

    notifyUserScopeInvalidation(storage, target);

    expect(storage.setItem).toHaveBeenCalledWith(
      userScopeInvalidationStorageKey,
      expect.any(String)
    );
    expect(storage.removeItem).toHaveBeenCalledWith(userScopeInvalidationStorageKey);
    expect(values.size).toBe(0);
    expect(listener).toHaveBeenCalledOnce();
  });
});
