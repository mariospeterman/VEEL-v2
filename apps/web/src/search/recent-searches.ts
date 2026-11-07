export const legacyRecentSearchKey = "wevid:search:recent";
export const recentSearchKeyPrefix = "wevid:search:recent:v2:";
export const recentSearchLimit = 6;
export const recentSearchRetentionMs = 24 * 60 * 60 * 1000;
export const recentSearchMaxLength = 120;

export interface RecentSearchStorage {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface StoredRecentSearch {
  query: string;
  savedAt: string;
}

interface ClaimedRecentSearches {
  ok: boolean;
  records: StoredRecentSearch[];
}

export function claimRecentSearches(
  storage: RecentSearchStorage,
  actorUserId: string | null,
  now = new Date(),
  legacyStorage: RecentSearchStorage = storage
): string[] {
  return claimRecentSearchRecords(storage, actorUserId, now, legacyStorage).records.map((record) => record.query);
}

export function recordRecentSearch(
  storage: RecentSearchStorage,
  actorUserId: string | null,
  rawQuery: string,
  now = new Date(),
  legacyStorage: RecentSearchStorage = storage
): string[] {
  const actorKey = recentSearchKey(actorUserId);
  const query = normalizeRecentSearch(rawQuery);
  if (!actorKey || !query) return [];

  const claimed = claimRecentSearchRecords(storage, actorUserId, now, legacyStorage);
  if (!claimed.ok) return [];

  try {
    const savedAt = now.toISOString();
    const dedupeKey = query.toLowerCase();
    const records = [
      { query, savedAt },
      ...claimed.records.filter((record) => record.query.toLowerCase() !== dedupeKey)
    ].slice(0, recentSearchLimit);
    storage.setItem(actorKey, JSON.stringify(records));
    return records.map((record) => record.query);
  } catch {
    removeItemBestEffort(storage, actorKey);
    return [];
  }
}

export function clearRecentSearchesForActor(
  storage: RecentSearchStorage,
  actorUserId: string | null,
  legacyStorage: RecentSearchStorage = storage
): void {
  const actorKey = recentSearchKey(actorUserId);
  if (!actorKey) return;

  try {
    purgeUnownedRecentSearches(storage, actorKey, legacyStorage);
    storage.removeItem(actorKey);
  } catch {
    removeItemBestEffort(storage, actorKey);
  }
}

export function clearRecentSearchClientState(
  storage: RecentSearchStorage = window.sessionStorage,
  legacyStorage: RecentSearchStorage = window.localStorage
): void {
  removeItemBestEffort(storage, legacyRecentSearchKey);
  if (legacyStorage !== storage) removeItemBestEffort(legacyStorage, legacyRecentSearchKey);

  let keys: string[];
  try {
    keys = storageKeys(storage).filter((key) => key.startsWith(recentSearchKeyPrefix));
  } catch {
    return;
  }

  for (const key of keys) removeItemBestEffort(storage, key);
}

export function normalizeRecentSearch(rawQuery: string): string {
  return rawQuery
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, recentSearchMaxLength);
}

function claimRecentSearchRecords(
  storage: RecentSearchStorage,
  actorUserId: string | null,
  now: Date,
  legacyStorage: RecentSearchStorage
): ClaimedRecentSearches {
  const actorKey = recentSearchKey(actorUserId);
  if (!actorKey) return { ok: true, records: [] };

  try {
    const nowMs = now.getTime();
    if (!Number.isFinite(nowMs)) return { ok: false, records: [] };

    purgeUnownedRecentSearches(storage, actorKey, legacyStorage);
    const stored = storage.getItem(actorKey);
    if (stored === null) return { ok: true, records: [] };

    const records = parseRecentSearchRecords(stored);
    if (!records) {
      storage.removeItem(actorKey);
      return { ok: false, records: [] };
    }

    const fresh = records.filter((record) => {
      const savedAtMs = Date.parse(record.savedAt);
      return savedAtMs <= nowMs && nowMs - savedAtMs < recentSearchRetentionMs;
    });

    if (fresh.length === 0) storage.removeItem(actorKey);
    else if (fresh.length !== records.length) storage.setItem(actorKey, JSON.stringify(fresh));
    return { ok: true, records: fresh };
  } catch {
    removeItemBestEffort(storage, actorKey);
    return { ok: false, records: [] };
  }
}

function parseRecentSearchRecords(value: string): StoredRecentSearch[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    return null;
  }

  if (!Array.isArray(parsed) || parsed.length > recentSearchLimit) return null;

  const seen = new Set<string>();
  const records: StoredRecentSearch[] = [];
  for (const item of parsed) {
    if (!isRecord(item) || typeof item.query !== "string" || typeof item.savedAt !== "string") {
      return null;
    }

    const query = normalizeRecentSearch(item.query);
    const savedAtMs = Date.parse(item.savedAt);
    const dedupeKey = query.toLowerCase();
    if (
      query.length === 0 ||
      query !== item.query ||
      !Number.isFinite(savedAtMs) ||
      new Date(savedAtMs).toISOString() !== item.savedAt ||
      seen.has(dedupeKey)
    ) {
      return null;
    }

    seen.add(dedupeKey);
    records.push({ query, savedAt: item.savedAt });
  }
  return records;
}

function purgeUnownedRecentSearches(
  storage: RecentSearchStorage,
  actorKey: string,
  legacyStorage: RecentSearchStorage
): void {
  legacyStorage.removeItem(legacyRecentSearchKey);
  const keys = storageKeys(storage);
  for (const key of keys) {
    if (key === legacyRecentSearchKey || (key.startsWith(recentSearchKeyPrefix) && key !== actorKey)) {
      storage.removeItem(key);
    }
  }
}

function storageKeys(storage: RecentSearchStorage): string[] {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key !== null) keys.push(key);
  }
  return keys;
}

function recentSearchKey(actorUserId: string | null): string | null {
  if (typeof actorUserId !== "string" || actorUserId.length === 0) return null;
  return `${recentSearchKeyPrefix}${actorUserId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function removeItemBestEffort(storage: RecentSearchStorage, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    // Browser privacy settings can disable session storage. Search remains in memory only.
  }
}
