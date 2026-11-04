import { describe, expect, it } from "vitest";
import {
  claimRecentSearches,
  clearRecentSearchesForActor,
  legacyRecentSearchKey,
  normalizeRecentSearch,
  recentSearchKeyPrefix,
  recentSearchLimit,
  recordRecentSearch
} from "./recent-searches";

const actorA = "00000000-0000-4000-8000-000000000001";
const actorB = "00000000-0000-4000-8000-000000000002";
const now = new Date("2026-11-04T10:00:00.000Z");

describe("recent searches", () => {
  it("isolates actors and purges the prior actor when a new actor claims the session", () => {
    const storage = new MemoryStorage();
    expect(recordRecentSearch(storage, actorA, "private A query", now)).toEqual(["private A query"]);

    expect(claimRecentSearches(storage, actorB, now)).toEqual([]);
    expect(storage.getItem(`${recentSearchKeyPrefix}${actorA}`)).toBeNull();
    expect(JSON.stringify(storage.values())).not.toContain("private A query");
  });

  it("purges the legacy global key and every foreign actor key on claim", () => {
    const legacyStorage = new MemoryStorage([[legacyRecentSearchKey, '["legacy query"]']]);
    const storage = new MemoryStorage([
      [`${recentSearchKeyPrefix}${actorA}`, JSON.stringify([record("actor A", now)])],
      [`${recentSearchKeyPrefix}${actorB}`, JSON.stringify([record("actor B", now)])]
    ]);

    expect(claimRecentSearches(storage, actorB, now, legacyStorage)).toEqual(["actor B"]);
    expect(legacyStorage.getItem(legacyRecentSearchKey)).toBeNull();
    expect(storage.getItem(`${recentSearchKeyPrefix}${actorA}`)).toBeNull();
  });

  it("expires entries after 24 hours and rewrites a partially expired list", () => {
    const storage = new MemoryStorage([
      [`${recentSearchKeyPrefix}${actorA}`, JSON.stringify([
        record("fresh", new Date(now.getTime() - 23 * 60 * 60 * 1000)),
        record("expired", new Date(now.getTime() - 24 * 60 * 60 * 1000))
      ])]
    ]);

    expect(claimRecentSearches(storage, actorA, now)).toEqual(["fresh"]);
    expect(storage.getItem(`${recentSearchKeyPrefix}${actorA}`)).not.toContain("expired");
  });

  it("normalizes, deduplicates case-insensitively, and retains only the newest six", () => {
    const storage = new MemoryStorage();
    expect(recordRecentSearch(storage, actorA, "  FOO\n bar  ", now)).toEqual(["FOO bar"]);
    expect(recordRecentSearch(storage, actorA, "foo bar", new Date(now.getTime() + 1_000))).toEqual(["foo bar"]);

    for (let index = 0; index < recentSearchLimit + 2; index += 1) {
      recordRecentSearch(storage, actorA, `query ${index}`, new Date(now.getTime() + 2_000 + index));
    }

    expect(claimRecentSearches(storage, actorA, new Date(now.getTime() + 10_000))).toEqual([
      "query 7",
      "query 6",
      "query 5",
      "query 4",
      "query 3",
      "query 2"
    ]);
    expect(normalizeRecentSearch(` ${"a".repeat(140)} `)).toHaveLength(120);
  });

  it.each([
    "not-json",
    JSON.stringify(["old-shape"]),
    JSON.stringify([{ query: "", savedAt: now.toISOString() }]),
    JSON.stringify([{ query: "duplicate", savedAt: now.toISOString() }, { query: "DUPLICATE", savedAt: now.toISOString() }]),
    JSON.stringify([{ query: "future", savedAt: new Date(now.getTime() + 1_000).toISOString() }])
  ])("fails closed and removes malformed or invalid state: %s", (stored) => {
    const key = `${recentSearchKeyPrefix}${actorA}`;
    const storage = new MemoryStorage([[key, stored]]);
    expect(claimRecentSearches(storage, actorA, now)).toEqual([]);
    expect(storage.getItem(key)).toBeNull();
  });

  it("does not touch storage without a canonical actor", () => {
    const storage = new ThrowingStorage();
    expect(claimRecentSearches(storage, null, now)).toEqual([]);
    expect(recordRecentSearch(storage, null, "query", now)).toEqual([]);
    clearRecentSearchesForActor(storage, null);
  });

  it("fails closed without throwing when session storage is unavailable", () => {
    const storage = new ThrowingStorage();
    expect(claimRecentSearches(storage, actorA, now)).toEqual([]);
    expect(recordRecentSearch(storage, actorA, "query", now)).toEqual([]);
    expect(() => clearRecentSearchesForActor(storage, actorA)).not.toThrow();
  });
});

function record(query: string, date: Date) {
  return { query, savedAt: date.toISOString() };
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

class ThrowingStorage {
  get length(): number { throw new Error("storage unavailable"); }
  key(_index: number): string | null { throw new Error("storage unavailable"); }
  getItem(_key: string): string | null { throw new Error("storage unavailable"); }
  setItem(_key: string, _value: string): void { throw new Error("storage unavailable"); }
  removeItem(_key: string): void { throw new Error("storage unavailable"); }
}
