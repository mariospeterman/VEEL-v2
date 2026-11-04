import type { CreateMessageRequest } from "../api-mutation-types";

export const legacyOfflineMessageQueueKey = "wevid:message-offline-queue:v1";
export const offlineMessageQueuePrefix = "wevid:message-offline-queue:v2:";
export const offlineMessageSessionKey = "wevid:message-offline-session:v2";
export const offlineMessageRetentionMs = 24 * 60 * 60 * 1000;
export const offlineMessageQueueLimit = 25;

export type OfflineMessageState =
  | "queued"
  | "sending"
  | "retrying"
  | "paused_auth"
  | "needs_attention"
  | "retryable_failed";

export interface OfflineMessageScope {
  actorUserId: string;
  browserSessionId: string;
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
  randomId = () => crypto.randomUUID()
): string {
  localStorage.removeItem(legacyOfflineMessageQueueKey);
  const current = parseSessionMarker(sessionStorage.getItem(offlineMessageSessionKey));
  if (current?.actorUserId === actorUserId) return current.browserSessionId;

  clearPrivateMessageClientState(localStorage, sessionStorage);
  const browserSessionId = randomId();
  sessionStorage.setItem(offlineMessageSessionKey, JSON.stringify({ actorUserId, browserSessionId }));
  return browserSessionId;
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
    lastFailureKind: null
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
  );

  if (valid.length === 0) storage.removeItem(key);
  else if (valid.length !== parsed.length) storage.setItem(key, JSON.stringify(valid));
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
    if (key?.startsWith(offlineMessageQueuePrefix)) localStorage.removeItem(key);
  }
  sessionStorage.removeItem(offlineMessageSessionKey);
}

export function classifyMessageFailure(status?: number): MessageFailureDisposition {
  if (status === undefined || status === 408 || status === 425 || status === 429 || status >= 500) {
    return "auto_retry";
  }
  if (status === 401) return "pause_auth";
  return "manual_attention";
}

export function isOfflineMessageStorageKey(key: string | null): boolean {
  return key === legacyOfflineMessageQueueKey || key === offlineMessageSessionKey || Boolean(key?.startsWith(offlineMessageQueuePrefix));
}

function queueKey(scope: OfflineMessageScope): string {
  return `${offlineMessageQueuePrefix}${scope.actorUserId}:${scope.browserSessionId}:${scope.conversationId}`;
}

function sameScope(left: OfflineMessageScope, right: OfflineMessageScope): boolean {
  return left.actorUserId === right.actorUserId &&
    left.browserSessionId === right.browserSessionId &&
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

function parseSessionMarker(value: string | null): { actorUserId: string; browserSessionId: string } | null {
  try {
    const parsed = JSON.parse(value ?? "null") as Record<string, unknown> | null;
    return parsed && typeof parsed.actorUserId === "string" && typeof parsed.browserSessionId === "string"
      ? { actorUserId: parsed.actorUserId, browserSessionId: parsed.browserSessionId }
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
    [null, "transport", "authentication", "request"].includes(item.lastFailureKind ?? null);
}
