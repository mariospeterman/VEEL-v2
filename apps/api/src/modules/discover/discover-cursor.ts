import {
  cursorTimestamp,
  isCanonicalCursorTimestamp
} from "../../shared/database-timestamp.js";

const cursorVersion = 2;
const maxCursorLength = 512;
const base64UrlPattern = /^[A-Za-z0-9_-]+$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type DiscoverCursorScope = "content" | "creator" | "hashtag" | "event" | "live";

interface DiscoverCursorPayload {
  version: typeof cursorVersion;
  scope: DiscoverCursorScope;
  binding: string;
  keys: unknown[];
}

export class InvalidDiscoverCursorError extends Error {
  constructor() {
    super("INVALID_DISCOVER_CURSOR");
    this.name = "InvalidDiscoverCursorError";
  }
}

export function encodeContentCursor(createdAt: Date, id: string, binding: string): string {
  return encodeCursor("content", binding, [cursorTimestamp(createdAt), assertUuid(id)]);
}

export function decodeContentCursor(cursor: string | undefined, binding: string): {
  createdAt: string;
  id: string;
} | null {
  const keys = decodeCursor("content", binding, cursor);
  if (!keys) return null;
  if (keys.length !== 2) throw new InvalidDiscoverCursorError();
  const [createdAt, id] = keys;
  if (!isCanonicalIsoDate(createdAt) || !isUuid(id)) throw new InvalidDiscoverCursorError();
  return { createdAt, id };
}

export function encodeCreatorCursor(handle: string, id: string, binding: string): string {
  return encodeCursor("creator", binding, [assertBoundedText(handle, 120), assertUuid(id)]);
}

export function decodeCreatorCursor(cursor: string | undefined, binding: string): {
  handle: string;
  id: string;
} | null {
  const keys = decodeCursor("creator", binding, cursor);
  if (!keys) return null;
  if (keys.length !== 2) throw new InvalidDiscoverCursorError();
  const [handle, id] = keys;
  if (!isBoundedText(handle, 120) || !isUuid(id)) throw new InvalidDiscoverCursorError();
  return { handle, id };
}

export function encodeHashtagCursor(slug: string, binding: string): string {
  return encodeCursor("hashtag", binding, [assertBoundedText(slug, 64)]);
}

export function decodeHashtagCursor(cursor: string | undefined, binding: string): { slug: string } | null {
  const keys = decodeCursor("hashtag", binding, cursor);
  if (!keys) return null;
  if (keys.length !== 1) throw new InvalidDiscoverCursorError();
  const [slug] = keys;
  if (!isBoundedText(slug, 64)) throw new InvalidDiscoverCursorError();
  return { slug };
}

export function encodeEventCursor(startsAt: Date, id: string, binding: string): string {
  return encodeCursor("event", binding, [cursorTimestamp(startsAt), assertUuid(id)]);
}

export function decodeEventCursor(cursor: string | undefined, binding: string): {
  startsAt: string;
  id: string;
} | null {
  const keys = decodeCursor("event", binding, cursor);
  if (!keys) return null;
  if (keys.length !== 2) throw new InvalidDiscoverCursorError();
  const [startsAt, id] = keys;
  if (!isCanonicalIsoDate(startsAt) || !isUuid(id)) throw new InvalidDiscoverCursorError();
  return { startsAt, id };
}

export function encodeLiveCursor(createdAt: Date, id: string, binding: string): string {
  return encodeCursor("live", binding, [cursorTimestamp(createdAt), assertUuid(id)]);
}

export function decodeLiveCursor(cursor: string | undefined, binding: string): {
  createdAt: string;
  id: string;
} | null {
  const keys = decodeCursor("live", binding, cursor);
  if (!keys) return null;
  if (keys.length !== 2) throw new InvalidDiscoverCursorError();
  const [createdAt, id] = keys;
  if (!isCanonicalIsoDate(createdAt) || !isUuid(id)) {
    throw new InvalidDiscoverCursorError();
  }
  return { createdAt, id };
}

function encodeCursor(scope: DiscoverCursorScope, binding: string, keys: unknown[]): string {
  if (!isBoundedText(binding, 160)) throw new InvalidDiscoverCursorError();
  const payload: DiscoverCursorPayload = { version: cursorVersion, scope, binding, keys };
  const cursor = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  if (cursor.length > maxCursorLength) throw new InvalidDiscoverCursorError();
  return cursor;
}

function decodeCursor(
  scope: DiscoverCursorScope,
  binding: string,
  cursor: string | undefined
): unknown[] | null {
  if (cursor === undefined) return null;
  if (
    cursor.length === 0 ||
    cursor.length > maxCursorLength ||
    !base64UrlPattern.test(cursor)
  ) {
    throw new InvalidDiscoverCursorError();
  }

  try {
    const bytes = Buffer.from(cursor, "base64url");
    if (bytes.toString("base64url") !== cursor) throw new InvalidDiscoverCursorError();
    const decoded = JSON.parse(bytes.toString("utf8")) as Partial<DiscoverCursorPayload>;
    if (
      decoded.version !== cursorVersion ||
      decoded.scope !== scope ||
      decoded.binding !== binding ||
      !Array.isArray(decoded.keys)
    ) {
      throw new InvalidDiscoverCursorError();
    }
    return decoded.keys;
  } catch (error) {
    if (error instanceof InvalidDiscoverCursorError) throw error;
    throw new InvalidDiscoverCursorError();
  }
}

function assertUuid(value: string): string {
  if (!isUuid(value)) throw new InvalidDiscoverCursorError();
  return value;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

function assertBoundedText(value: string, maxLength: number): string {
  if (!isBoundedText(value, maxLength)) throw new InvalidDiscoverCursorError();
  return value;
}

function isBoundedText(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength;
}

function isCanonicalIsoDate(value: unknown): value is string {
  return isCanonicalCursorTimestamp(value);
}
