const cursorVersion = 1;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface CursorPayload {
  v: typeof cursorVersion;
  s: string;
  t: string;
  i: string;
  k?: string;
}

export interface TimestampIdCursor {
  timestamp: string | null;
  id: string | null;
}

export interface TimestampKindIdCursor extends TimestampIdCursor {
  kind: string | null;
}

export class KeysetPaginationCursorError extends Error {
  readonly code = "validation_failed";
  readonly statusCode = 400;

  constructor() {
    super("The pagination cursor is invalid for this collection");
    this.name = "KeysetPaginationCursorError";
  }
}

export function keysetPage<Row, Item>(
  rows: Row[],
  limit: number,
  map: (row: Row) => Item,
  encodeCursor: (row: Row) => string
): { items: Item[]; nextCursor: string | null } {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError("Pagination limit must be a positive integer");
  }

  const visibleRows = rows.slice(0, limit);
  const lastVisibleRow = rows.length > limit ? visibleRows.at(-1) : undefined;

  return {
    items: visibleRows.map(map),
    nextCursor: lastVisibleRow ? encodeCursor(lastVisibleRow) : null
  };
}

export function encodeTimestampIdCursor(
  scope: string,
  timestamp: Date | string,
  id: string
): string {
  return encodeCursor({
    v: cursorVersion,
    s: scope,
    t: canonicalTimestamp(timestamp),
    i: id
  });
}

export function decodeTimestampIdCursor(
  scope: string,
  cursor: string | undefined
): TimestampIdCursor {
  if (!cursor) return { timestamp: null, id: null };

  const payload = decodeCursorPayload(scope, cursor);
  if (payload) {
    if (payload.k !== undefined) throw new KeysetPaginationCursorError();
    return { timestamp: payload.t, id: payload.i };
  }

  return legacyTimestampCursor(cursor);
}

export function encodeTimestampKindIdCursor(
  scope: string,
  timestamp: Date | string,
  kind: string,
  id: string
): string {
  if (!validKind(kind)) throw new KeysetPaginationCursorError();
  return encodeCursor({
    v: cursorVersion,
    s: scope,
    t: canonicalTimestamp(timestamp),
    k: kind,
    i: id
  });
}

export function decodeTimestampKindIdCursor(
  scope: string,
  cursor: string | undefined,
  allowedKinds: readonly string[]
): TimestampKindIdCursor {
  if (!cursor) return { timestamp: null, kind: null, id: null };

  const payload = decodeCursorPayload(scope, cursor);
  if (payload) {
    if (!payload.k || !allowedKinds.includes(payload.k)) {
      throw new KeysetPaginationCursorError();
    }
    return { timestamp: payload.t, kind: payload.k, id: payload.i };
  }

  return { ...legacyTimestampCursor(cursor), kind: null };
}

function encodeCursor(payload: CursorPayload): string {
  if (!payload.s || payload.s.length > 160 || !uuidPattern.test(payload.i)) {
    throw new KeysetPaginationCursorError();
  }
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeCursorPayload(scope: string, cursor: string): CursorPayload | null {
  if (cursor.length < 1 || cursor.length > 512) throw new KeysetPaginationCursorError();
  if (!/^[A-Za-z0-9_-]+$/.test(cursor)) return null;

  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw new KeysetPaginationCursorError();
  }

  if (
    typeof decoded !== "object" ||
    decoded === null ||
    !("v" in decoded) ||
    !("s" in decoded) ||
    !("t" in decoded) ||
    !("i" in decoded)
  ) {
    throw new KeysetPaginationCursorError();
  }

  const payload = decoded as Partial<CursorPayload>;
  if (
    payload.v !== cursorVersion ||
    payload.s !== scope ||
    !isCanonicalTimestamp(payload.t) ||
    typeof payload.i !== "string" ||
    !uuidPattern.test(payload.i) ||
    (payload.k !== undefined && !validKind(payload.k))
  ) {
    throw new KeysetPaginationCursorError();
  }

  return payload as CursorPayload;
}

function legacyTimestampCursor(cursor: string): TimestampIdCursor {
  try {
    return { timestamp: canonicalTimestamp(cursor), id: null };
  } catch {
    throw new KeysetPaginationCursorError();
  }
}

function canonicalTimestamp(value: Date | string): string {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new KeysetPaginationCursorError();
  return parsed.toISOString();
}

function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function validKind(value: unknown): value is string {
  return typeof value === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(value);
}
