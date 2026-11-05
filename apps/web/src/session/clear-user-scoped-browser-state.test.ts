import { describe, expect, it } from "vitest";
import {
  legacyOfflineMessageQueueKey,
  legacyOfflineMessageQueuePrefix,
  legacyOfflineMessageSessionKey,
  offlineMessageQueuePrefix,
  offlineMessageSessionKey
} from "../messages/offline-message-queue";
import { legacyRecentSearchKey, recentSearchKeyPrefix } from "../search/recent-searches";
import { clearUserScopedBrowserState } from "./clear-user-scoped-browser-state";

describe("clearUserScopedBrowserState", () => {
  it("removes message and recent-search state used by both logout surfaces", () => {
    const localStorage = new MemoryStorage([
      [legacyOfflineMessageQueueKey, "legacy"],
      [legacyRecentSearchKey, "legacy search"],
      [`${legacyOfflineMessageQueuePrefix}actor:browser:conversation`, "private v2 message"],
      [`${offlineMessageQueuePrefix}actor:session:tab:conversation`, "private v3 message"]
    ]);
    const sessionStorage = new MemoryStorage([
      [`${recentSearchKeyPrefix}actor`, "private query"],
      [legacyOfflineMessageSessionKey, "legacy session"],
      [offlineMessageSessionKey, "current session"]
    ]);

    clearUserScopedBrowserState(localStorage, sessionStorage);

    expect(localStorage.values()).toEqual([]);
    expect(sessionStorage.values()).toEqual([]);
  });

  it("still clears search state when message storage cleanup fails", () => {
    const localStorage = new ThrowingStorage();
    const sessionStorage = new MemoryStorage([[`${recentSearchKeyPrefix}actor`, "private query"]]);

    expect(() => clearUserScopedBrowserState(localStorage, sessionStorage)).not.toThrow();
    expect(sessionStorage.values()).toEqual([]);
  });
});

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

class ThrowingStorage {
  get length(): number { throw new Error("storage unavailable"); }
  key(_index: number): string | null { throw new Error("storage unavailable"); }
  getItem(_key: string): string | null { throw new Error("storage unavailable"); }
  setItem(_key: string, _value: string): void { throw new Error("storage unavailable"); }
  removeItem(_key: string): void { throw new Error("storage unavailable"); }
}
