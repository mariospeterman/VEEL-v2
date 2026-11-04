import type {
  AdminComplianceLedgerEntry
} from "./types.js";

export const pageSize = 50;

const adminCursorVersion = 1;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const featureFlagKeyPattern = /^[a-z0-9_.:-]{2,120}$/;

interface AdminCursorPayload {
  v: typeof adminCursorVersion;
  s: string;
  k: Array<string | number>;
  i: string;
}

export class AdminPaginationCursorError extends Error {
  readonly code = "validation_failed";
  readonly statusCode = 400;

  constructor() {
    super("The admin pagination cursor is invalid for this collection");
    this.name = "AdminPaginationCursorError";
  }
}

export function page<Row, Item>(
  rows: Row[],
  mapper: (row: Row) => Item,
  encodeCursor: (row: Row) => string
): { items: Item[]; nextCursor: string | null } {
  const visibleRows = rows.slice(0, pageSize);
  const next = rows.length > pageSize ? visibleRows.at(-1) ?? null : null;

  return {
    items: visibleRows.map(mapper),
    nextCursor: next ? encodeCursor(next) : null
  };
}

export function encodeTimestampIdCursor(scope: string, timestamp: Date, id: string): string {
  return encodeAdminCursor(scope, [timestamp.toISOString()], id);
}

export function decodeTimestampIdCursor(scope: string, cursor: string | undefined): {
  timestamp: string | null;
  id: string | null;
} {
  if (!cursor) return { timestamp: null, id: null };

  const payload = decodeAdminCursor(scope, cursor);
  if (payload) {
    const [timestamp] = payload.k;
    if (payload.k.length !== 1 || !isTimestamp(timestamp)) {
      throw new AdminPaginationCursorError();
    }
    return { timestamp, id: payload.i };
  }

  // Accept the short-lived unversioned compound cursor emitted by an earlier repair build.
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as {
      createdAt?: unknown;
      id?: unknown;
    };
    if (
      isTimestamp(parsed.createdAt) &&
      typeof parsed.id === "string" &&
      uuidPattern.test(parsed.id)
    ) {
      return { timestamp: parsed.createdAt, id: parsed.id };
    }
  } catch {
    // Fall through to the timestamp-only compatibility path.
  }

  // Legacy timestamp cursors include the whole boundary timestamp on the next request. This can
  // repeat rows from that timestamp, but it cannot omit them; every response emits a v1 cursor.
  if (isTimestamp(cursor)) return { timestamp: cursor, id: null };
  throw new AdminPaginationCursorError();
}

export function encodeTimestampKeyCursor(scope: string, timestamp: Date, key: string): string {
  return encodeAdminCursor(scope, [timestamp.toISOString()], key, featureFlagKeyPattern);
}

export function decodeTimestampKeyCursor(scope: string, cursor: string | undefined): {
  timestamp: string | null;
  key: string | null;
} {
  if (!cursor) return { timestamp: null, key: null };

  const payload = decodeAdminCursor(scope, cursor, featureFlagKeyPattern);
  if (payload) {
    const [timestamp] = payload.k;
    if (payload.k.length !== 1 || !isTimestamp(timestamp)) {
      throw new AdminPaginationCursorError();
    }
    return { timestamp, key: payload.i };
  }

  if (isTimestamp(cursor)) return { timestamp: cursor, key: null };
  throw new AdminPaginationCursorError();
}

export function encodePriorityTimestampIdCursor(
  scope: string,
  priority: number,
  timestamp: Date,
  id: string
): string {
  return encodeAdminCursor(scope, [priority, timestamp.toISOString()], id);
}

export function decodePriorityTimestampIdCursor(scope: string, cursor: string | undefined): {
  priority: number | null;
  timestamp: string | null;
  id: string | null;
} {
  if (!cursor) return { priority: null, timestamp: null, id: null };

  const payload = decodeAdminCursor(scope, cursor);
  if (payload) {
    const [priority, timestamp] = payload.k;
    if (
      payload.k.length !== 2 ||
      typeof priority !== "number" ||
      !Number.isInteger(priority) ||
      !isTimestamp(timestamp)
    ) {
      throw new AdminPaginationCursorError();
    }
    return { priority, timestamp, id: payload.i };
  }

  // A legacy timestamp did not carry the queue priority. Restarting this one collection is the only
  // complete continuation: applying the timestamp to every priority bucket could omit newer rows in
  // a later bucket. The first restarted response upgrades the client to a v1 compound cursor.
  if (isTimestamp(cursor)) return { priority: null, timestamp: cursor, id: null };
  throw new AdminPaginationCursorError();
}

export function encodeTwoTimestampIdCursor(
  scope: string,
  firstTimestamp: Date,
  secondTimestamp: Date,
  id: string
): string {
  return encodeAdminCursor(
    scope,
    [firstTimestamp.toISOString(), secondTimestamp.toISOString()],
    id
  );
}

export function decodeTwoTimestampIdCursor(scope: string, cursor: string | undefined): {
  firstTimestamp: string | null;
  secondTimestamp: string | null;
  id: string | null;
} {
  if (!cursor) return { firstTimestamp: null, secondTimestamp: null, id: null };

  const payload = decodeAdminCursor(scope, cursor);
  if (payload) {
    const [firstTimestamp, secondTimestamp] = payload.k;
    if (
      payload.k.length !== 2 ||
      !isTimestamp(firstTimestamp) ||
      !isTimestamp(secondTimestamp)
    ) {
      throw new AdminPaginationCursorError();
    }
    return { firstTimestamp, secondTimestamp, id: payload.i };
  }

  if (isTimestamp(cursor)) {
    return { firstTimestamp: cursor, secondTimestamp: null, id: null };
  }
  throw new AdminPaginationCursorError();
}

function encodeAdminCursor(
  scope: string,
  keys: Array<string | number>,
  id: string,
  idPattern = uuidPattern
): string {
  if (!scope || !idPattern.test(id)) throw new AdminPaginationCursorError();
  const payload: AdminCursorPayload = {
    v: adminCursorVersion,
    s: scope,
    k: keys,
    i: id
  };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeAdminCursor(
  scope: string,
  cursor: string,
  idPattern = uuidPattern
): AdminCursorPayload | null {
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (
    typeof decoded !== "object" ||
    decoded === null ||
    !("v" in decoded) ||
    !("s" in decoded) ||
    !("k" in decoded) ||
    !("i" in decoded)
  ) {
    return null;
  }

  const payload = decoded as Partial<AdminCursorPayload>;
  if (
    payload.v !== adminCursorVersion ||
    payload.s !== scope ||
    !Array.isArray(payload.k) ||
    typeof payload.i !== "string" ||
    !idPattern.test(payload.i)
  ) {
    throw new AdminPaginationCursorError();
  }
  return payload as AdminCursorPayload;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

export function nullableNumber(value: string | number | null): number | null {
  return value === null ? null : Number(value);
}

export function normalizeAdminProductType(productType: string): AdminComplianceLedgerEntry["productType"] {
  switch (productType) {
    case "tip":
      return "support";
    case "event_ticket":
      return "event_access_pass";
    case "creator_subscription":
      return "membership";
    case "platform_subscription":
      return "platform_plus";
    default:
      return productType as AdminComplianceLedgerEntry["productType"];
  }
}
