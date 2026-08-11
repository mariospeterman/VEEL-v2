import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearWalletSession,
  getWalletSession,
  saveWalletSession,
  walletSessionCookieName
} from "./wallet-session";

describe("wallet session storage", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("stores display metadata separately from the bearer cookie", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-03T16:00:00.000Z"));
    const storage = new Map<string, string>();
    const cookieWrites: string[] = [];

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
    vi.stubGlobal("document", {
      get cookie() {
        return "";
      },
      set cookie(value: string) {
        cookieWrites.push(value);
      }
    });

    saveWalletSession({
      accessToken: "veel_wallet_secret",
      address: "Fu9FakeWalletAddress",
      expiresAt: "2026-07-03T16:30:00.000Z",
      provider: "phantom"
    });

    expect(getWalletSession()).toEqual({
      address: "Fu9FakeWalletAddress",
      expiresAt: "2026-07-03T16:30:00.000Z",
      provider: "phantom"
    });
    expect(JSON.stringify([...storage.values()])).not.toContain("veel_wallet_secret");
    expect(cookieWrites.at(-1)).toContain(`${walletSessionCookieName}=veel_wallet_secret`);
    expect(cookieWrites.at(-1)).toContain("max-age=1800");
    expect(cookieWrites.at(-1)).toContain("secure");

    clearWalletSession();

    expect(storage.size).toBe(0);
    expect(cookieWrites.at(-1)).toBe(`${walletSessionCookieName}=; path=/; max-age=0; samesite=lax; secure`);
  });
});
