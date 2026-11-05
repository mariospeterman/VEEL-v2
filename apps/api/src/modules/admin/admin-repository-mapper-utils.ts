import {
  cursorTimestamp,
  isCanonicalCursorTimestamp
} from "../../shared/database-timestamp.js";
import {
  decodeTimestampIdCursor,
  encodeTimestampIdCursor,
  KeysetPaginationCursorError
} from "../../shared/keyset-pagination.js";
import type {
  AdminComplianceLedgerEntry
} from "./types.js";

export {
  decodeTimestampIdCursor,
  encodeTimestampIdCursor,
  KeysetPaginationCursorError as AdminPaginationCursorError
};

export const pageSize = 50;

const adminCursorVersion = 2;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const featureFlagKeyPattern = /^[a-z0-9_.:-]{2,120}$/;

interface AdminCursorPayload {
  v: typeof adminCursorVersion;
  s: string;
  k: Array<string | number>;
  i: string;
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

export function encodeTimestampKeyCursor(scope: string, timestamp: Date, key: string): string {
  return encodeAdminCursor(scope, [cursorTimestamp(timestamp)], key, featureFlagKeyPattern);
}

export function decodeTimestampKeyCursor(scope: string, cursor: string | undefined): {
  timestamp: string | null;
  key: string | null;
} {
  if (!cursor) return { timestamp: null, key: null };

  const payload = decodeAdminCursor(scope, cursor, featureFlagKeyPattern);
  const [timestamp] = payload.k;
  if (payload.k.length !== 1 || !isTimestamp(timestamp)) {
    throw new KeysetPaginationCursorError();
  }
  return { timestamp, key: payload.i };
}

export function encodePriorityTimestampIdCursor(
  scope: string,
  priority: number,
  timestamp: Date,
  id: string
): string {
  return encodeAdminCursor(scope, [priority, cursorTimestamp(timestamp)], id);
}

export function decodePriorityTimestampIdCursor(scope: string, cursor: string | undefined): {
  priority: number | null;
  timestamp: string | null;
  id: string | null;
} {
  if (!cursor) return { priority: null, timestamp: null, id: null };

  const payload = decodeAdminCursor(scope, cursor);
  const [priority, timestamp] = payload.k;
  if (
    payload.k.length !== 2 ||
    typeof priority !== "number" ||
    !Number.isInteger(priority) ||
    !isTimestamp(timestamp)
  ) {
    throw new KeysetPaginationCursorError();
  }
  return { priority, timestamp, id: payload.i };
}

export function encodeTwoTimestampIdCursor(
  scope: string,
  firstTimestamp: Date,
  secondTimestamp: Date,
  id: string
): string {
  return encodeAdminCursor(
    scope,
    [cursorTimestamp(firstTimestamp), cursorTimestamp(secondTimestamp)],
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
  const [firstTimestamp, secondTimestamp] = payload.k;
  if (
    payload.k.length !== 2 ||
    !isTimestamp(firstTimestamp) ||
    !isTimestamp(secondTimestamp)
  ) {
    throw new KeysetPaginationCursorError();
  }
  return { firstTimestamp, secondTimestamp, id: payload.i };
}

function encodeAdminCursor(
  scope: string,
  keys: Array<string | number>,
  id: string,
  idPattern = uuidPattern
): string {
  if (!scope || scope.length > 160 || !idPattern.test(id)) {
    throw new KeysetPaginationCursorError();
  }
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
): AdminCursorPayload {
  if (cursor.length < 1 || cursor.length > 512 || !/^[A-Za-z0-9_-]+$/.test(cursor)) {
    throw new KeysetPaginationCursorError();
  }
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
    !("k" in decoded) ||
    !("i" in decoded)
  ) {
    throw new KeysetPaginationCursorError();
  }

  const payload = decoded as Partial<AdminCursorPayload>;
  if (
    payload.v !== adminCursorVersion ||
    payload.s !== scope ||
    !Array.isArray(payload.k) ||
    typeof payload.i !== "string" ||
    !idPattern.test(payload.i)
  ) {
    throw new KeysetPaginationCursorError();
  }
  return payload as AdminCursorPayload;
}

function isTimestamp(value: unknown): value is string {
  return isCanonicalCursorTimestamp(value);
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
