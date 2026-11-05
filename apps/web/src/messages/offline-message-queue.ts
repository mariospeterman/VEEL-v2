import type { CreateMessageRequest } from "../api-mutation-types";

export const legacyOfflineMessageQueueKey = "wevid:message-offline-queue:v1";
export const legacyOfflineMessageQueuePrefix = "wevid:message-offline-queue:v2:";
export const legacyOfflineMessageSessionKey = "wevid:message-offline-session:v2";
export const offlineMessageQueuePrefix = "wevid:message-offline-queue:v3:";
export const offlineMessageSessionKey = "wevid:message-offline-session:v3";
export const offlineMessageRetentionMs = 24 * 60 * 60 * 1000;
export const offlineMessageQueueLimit = 25;
export const offlineMessageDeliveryLeaseMs = 15_000;

export type OfflineMessageState =
  | "queued"
  | "sending"
  | "retrying"
  | "paused_auth"
  | "needs_attention"
  | "retryable_failed";

export interface OfflineMessageScope {
  actorUserId: string;
  clientSessionScope: string;
  browserTabId: string;
  conversationId: string;
}

export interface OfflineMessageRecord extends OfflineMessageScope {
  clientMessageId: string;
  idempotencyKey: string;
  request: CreateMessageRequest;
  createdAt: string;
  expiresAt: string;
  attemptCount: number;
  nextAttemptAt: string | null;
  state: OfflineMessageState;
  lastFailureKind: "transport" | "authentication" | "request" | null;
  deliveryLeaseOwnerId: string | null;
  deliveryLeaseExpiresAt: string | null;
}

export type MessageFailureDisposition = "auto_retry" | "pause_auth" | "manual_attention";

interface StorageLike {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function claimOfflineMessageSession(
  localStorage: StorageLike,
  sessionStorage: StorageLike,
  actorUserId: string,
  clientSessionScope: string,
  randomId = () => crypto.randomUUID()
): string {
  localStorage.removeItem(legacyOfflineMessageQueueKey);
  clearLegacyV2State(localStorage, sessionStorage);
  purgeExpiredQueues(localStorage);
  const current = parseSessionMarker(sessionStorage.getItem(offlineMessageSessionKey));
  if (current?.actorUserId === actorUserId && current.clientSessionScope === clientSessionScope) {
    return current.browserTabId;
  }

  if (current) clearQueuesForMarker(localStorage, current);
  const browserTabId = randomId();
  sessionStorage.setItem(offlineMessageSessionKey, JSON.stringify({
    actorUserId,
    clientSessionScope,
    browserTabId
  }));
  return browserTabId;
}

export function createOfflineMessage(
  scope: OfflineMessageScope,
  request: CreateMessageRequest,
  now = new Date(),
  randomId = () => crypto.randomUUID()
): OfflineMessageRecord {
  return {
    ...scope,
    clientMessageId: randomId(),
    idempotencyKey: randomId(),
    request,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + offlineMessageRetentionMs).toISOString(),
    attemptCount: 0,
    nextAttemptAt: now.toISOString(),
    state: "queued",
    lastFailureKind: null,
    deliveryLeaseOwnerId: null,
    deliveryLeaseExpiresAt: null
  };
}

export function readOfflineMessages(
  storage: StorageLike,
  scope: OfflineMessageScope,
  now = new Date()
): OfflineMessageRecord[] {
  const key = queueKey(scope);
  const parsed = parseArray(storage.getItem(key));
  const valid = parsed.filter((item): item is OfflineMessageRecord =>
    isOfflineMessage(item, scope) && Date.parse(item.expiresAt) > now.getTime()
  ).map((item) => normalizeExpiredDeliveryLease(item, now));

  if (valid.length === 0) storage.removeItem(key);
  else if (valid.length !== parsed.length || valid.some((item, index) => item !== parsed[index])) {
    storage.setItem(key, JSON.stringify(valid));
  }
  return valid;
}

export function enqueueOfflineMessage(storage: StorageLike, item: OfflineMessageRecord): boolean {
  const queue = readOfflineMessages(storage, item);
  if (queue.length >= offlineMessageQueueLimit) return false;
  if (queue.some((queued) => queued.clientMessageId === item.clientMessageId || queued.idempotencyKey === item.idempotencyKey)) {
    return false;
  }
  storage.setItem(queueKey(item), JSON.stringify([...queue, item]));
  return true;
}

export function updateOfflineMessage(
  storage: StorageLike,
  scope: OfflineMessageScope,
  item: OfflineMessageRecord
): boolean {
  if (!sameScope(scope, item)) return false;
  const queue = readOfflineMessages(storage, scope);
  const index = queue.findIndex((queued) => queued.clientMessageId === item.clientMessageId);
  if (index === -1) return false;
  queue[index] = item;
  storage.setItem(queueKey(scope), JSON.stringify(queue));
  return true;
}

export function claimOfflineMessageDelivery(
  storage: StorageLike,
  scope: OfflineMessageScope,
  clientMessageId: string,
  deliveryLeaseOwnerId: string,
  now = new Date(),
  leaseDurationMs = offlineMessageDeliveryLeaseMs
): OfflineMessageRecord | null {
  if (!deliveryLeaseOwnerId || !Number.isInteger(leaseDurationMs) || leaseDurationMs < 1) return null;
  const queue = readOfflineMessages(storage, scope, now);
  const index = queue.findIndex((item) => item.clientMessageId === clientMessageId);
  if (index === -1) return null;
  const current = queue[index]!;
  const leaseExpiresAt = current.deliveryLeaseExpiresAt
    ? Date.parse(current.deliveryLeaseExpiresAt)
    : Number.NaN;
  if (
    current.deliveryLeaseOwnerId &&
    current.deliveryLeaseOwnerId !== deliveryLeaseOwnerId &&
    Number.isFinite(leaseExpiresAt) &&
    leaseExpiresAt > now.getTime()
  ) {
    return null;
  }

  const claimed: OfflineMessageRecord = {
    ...current,
    state: current.attemptCount === 0 ? "sending" : "retrying",
    deliveryLeaseOwnerId,
    deliveryLeaseExpiresAt: new Date(now.getTime() + leaseDurationMs).toISOString()
  };
  queue[index] = claimed;
  storage.setItem(queueKey(scope), JSON.stringify(queue));
  return claimed;
}

export function removeOfflineMessage(
  storage: StorageLike,
  scope: OfflineMessageScope,
  clientMessageId: string
): void {
  const queue = readOfflineMessages(storage, scope)
    .filter((item) => item.clientMessageId !== clientMessageId);
  if (queue.length === 0) storage.removeItem(queueKey(scope));
  else storage.setItem(queueKey(scope), JSON.stringify(queue));
}

export function clearPrivateMessageClientState(
  localStorage: StorageLike = window.localStorage,
  sessionStorage: StorageLike = window.sessionStorage
): void {
  localStorage.removeItem(legacyOfflineMessageQueueKey);
  for (let index = localStorage.length - 1; index >= 0; index -= 1) {
    const key = localStorage.key(index);
    if (key?.startsWith(offlineMessageQueuePrefix) || key?.startsWith(legacyOfflineMessageQueuePrefix)) {
      localStorage.removeItem(key);
    }
  }
  sessionStorage.removeItem(offlineMessageSessionKey);
  sessionStorage.removeItem(legacyOfflineMessageSessionKey);
}

export function classifyMessageFailure(status?: number): MessageFailureDisposition {
  if (status === undefined || status === 408 || status === 425 || status === 429 || status >= 500) {
    return "auto_retry";
  }
  if (status === 401) return "pause_auth";
  return "manual_attention";
}

export function isOfflineMessageStorageKeyForScope(
  key: string | null,
  scope: OfflineMessageScope
): boolean {
  return key === queueKey(scope);
}

export function offlineMessageQueueKey(scope: OfflineMessageScope): string {
  return queueKey(scope);
}

function queueKey(scope: OfflineMessageScope): string {
  return `${offlineMessageQueuePrefix}${scope.actorUserId}:${scope.clientSessionScope}:${scope.browserTabId}:${scope.conversationId}`;
}

function sameScope(left: OfflineMessageScope, right: OfflineMessageScope): boolean {
  return left.actorUserId === right.actorUserId &&
    left.clientSessionScope === right.clientSessionScope &&
    left.browserTabId === right.browserTabId &&
    left.conversationId === right.conversationId;
}

function parseArray(value: string | null): unknown[] {
  try {
    const parsed = JSON.parse(value ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

interface OfflineMessageSessionMarker {
  actorUserId: string;
  clientSessionScope: string;
  browserTabId: string;
}

function parseSessionMarker(value: string | null): OfflineMessageSessionMarker | null {
  try {
    const parsed = JSON.parse(value ?? "null") as Record<string, unknown> | null;
    return parsed &&
      typeof parsed.actorUserId === "string" &&
      typeof parsed.clientSessionScope === "string" &&
      typeof parsed.browserTabId === "string"
      ? {
          actorUserId: parsed.actorUserId,
          clientSessionScope: parsed.clientSessionScope,
          browserTabId: parsed.browserTabId
        }
      : null;
  } catch {
    return null;
  }
}

function isOfflineMessage(value: unknown, scope: OfflineMessageScope): value is OfflineMessageRecord {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<OfflineMessageRecord>;
  return sameScope(scope, item as OfflineMessageScope) &&
    typeof item.clientMessageId === "string" &&
    typeof item.idempotencyKey === "string" &&
    typeof item.request?.body === "string" &&
    typeof item.createdAt === "string" &&
    typeof item.expiresAt === "string" &&
    typeof item.attemptCount === "number" &&
    (typeof item.nextAttemptAt === "string" || item.nextAttemptAt === null) &&
    ["queued", "sending", "retrying", "paused_auth", "needs_attention", "retryable_failed"].includes(item.state ?? "") &&
    [null, "transport", "authentication", "request"].includes(item.lastFailureKind ?? null) &&
    (typeof item.deliveryLeaseOwnerId === "string" || item.deliveryLeaseOwnerId === null) &&
    (typeof item.deliveryLeaseExpiresAt === "string" || item.deliveryLeaseExpiresAt === null);
}

function normalizeExpiredDeliveryLease(
  item: OfflineMessageRecord,
  now: Date
): OfflineMessageRecord {
  if (
    !item.deliveryLeaseOwnerId ||
    !item.deliveryLeaseExpiresAt ||
    Date.parse(item.deliveryLeaseExpiresAt) > now.getTime()
  ) {
    return item;
  }
  return {
    ...item,
    state: item.attemptCount === 0 ? "queued" : "retrying",
    deliveryLeaseOwnerId: null,
    deliveryLeaseExpiresAt: null
  };
}

function clearQueuesForMarker(storage: StorageLike, marker: OfflineMessageSessionMarker): void {
  const prefix = `${offlineMessageQueuePrefix}${marker.actorUserId}:${marker.clientSessionScope}:${marker.browserTabId}:`;
  for (let index = storage.length - 1; index >= 0; index -= 1) {
    const key = storage.key(index);
    if (key?.startsWith(prefix)) storage.removeItem(key);
  }
}

function clearLegacyV2State(localStorage: StorageLike, sessionStorage: StorageLike): void {
  const legacyMarker = parseLegacySessionMarker(sessionStorage.getItem(legacyOfflineMessageSessionKey));
  if (legacyMarker) {
    const prefix = `${legacyOfflineMessageQueuePrefix}${legacyMarker.actorUserId}:${legacyMarker.browserSessionId}:`;
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(prefix)) localStorage.removeItem(key);
    }
  }
  sessionStorage.removeItem(legacyOfflineMessageSessionKey);
}

function purgeExpiredQueues(storage: StorageLike, now = new Date()): void {
  for (let index = storage.length - 1; index >= 0; index -= 1) {
    const key = storage.key(index);
    if (!key?.startsWith(offlineMessageQueuePrefix)) continue;
    const parsed = parseArray(storage.getItem(key));
    const retained = parsed.filter((value) => {
      if (!value || typeof value !== "object") return false;
      const expiresAt = (value as { expiresAt?: unknown }).expiresAt;
      return typeof expiresAt === "string" && Date.parse(expiresAt) > now.getTime();
    });
    if (retained.length === 0) storage.removeItem(key);
    else if (retained.length !== parsed.length) storage.setItem(key, JSON.stringify(retained));
  }
}

function parseLegacySessionMarker(value: string | null): {
  actorUserId: string;
  browserSessionId: string;
} | null {
  try {
    const parsed = JSON.parse(value ?? "null") as Record<string, unknown> | null;
    return parsed && typeof parsed.actorUserId === "string" && typeof parsed.browserSessionId === "string"
      ? { actorUserId: parsed.actorUserId, browserSessionId: parsed.browserSessionId }
      : null;
  } catch {
    return null;
  }
}
