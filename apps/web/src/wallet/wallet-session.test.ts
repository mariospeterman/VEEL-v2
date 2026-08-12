import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearWalletSession,
  getWalletSession,
  saveWalletSession
} from "./wallet-session";

describe("wallet session storage", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("stores only non-sensitive display metadata and never writes cookies", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-03T16:00:00.000Z"));
    const storage = new Map<string, string>();

    vi.stubGlobal("window", {
      location: { protocol: "https:" },
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        removeItem: (key: string) => {
          storage.delete(key);
        },
        setItem: (key: string, value: string) => {
          storage.set(key, value);
        }
      }
    });
    const documentCookie = vi.fn();
    vi.stubGlobal("document", { set cookie(value: string) { documentCookie(value); } });

    saveWalletSession({
      address: "Fu9FakeWalletAddress",
      expiresAt: "2026-07-03T16:30:00.000Z",
      provider: "phantom"
    });

    expect(getWalletSession()).toEqual({
      address: "Fu9FakeWalletAddress",
      expiresAt: "2026-07-03T16:30:00.000Z",
      provider: "phantom"
    });
    expect(JSON.stringify([...storage.values()])).not.toContain("accessToken");
    expect(documentCookie).not.toHaveBeenCalled();

    clearWalletSession();

    expect(storage.size).toBe(0);
    expect(documentCookie).not.toHaveBeenCalled();
  });
});
