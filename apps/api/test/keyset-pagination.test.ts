import { describe, expect, it } from "vitest";
import {
  bindCursorScope,
  decodeTimestampIdCursor,
  decodeTimestampKindIdCursor,
  encodeTimestampIdCursor,
  encodeTimestampKindIdCursor,
  KeysetPaginationCursorError,
  keysetPage
} from "../src/shared/keyset-pagination.js";
import { cursorTimestamp } from "../src/shared/database-timestamp.js";

const timestampScope = "GET /v1/refunds/requests";
const kindScope = "GET /v1/activity";
const kinds = ["payment_intent", "wallet_transaction"] as const;

describe("compound keyset pagination", () => {
  it("uses the last visible row and walks timestamp ties exactly once", () => {
    const orderedRows = Array.from({ length: 17 }, (_, index) => ({
      id: uuidFor(index + 1),
      createdAt: new Date("2026-11-04T12:30:00.000Z")
    })).sort(compareTimestampRows);
    const seen: string[] = [];
    let cursorValue: string | undefined;

    do {
      const cursor = decodeTimestampIdCursor(timestampScope, cursorValue);
      const eligible = orderedRows.filter((row) => afterTimestampCursor(row, cursor));
      const page = keysetPage(
        eligible.slice(0, 4),
        3,
        (row) => row.id,
        (row) => encodeTimestampIdCursor(timestampScope, row.createdAt, row.id)
      );
      seen.push(...page.items);
      cursorValue = page.nextCursor ?? undefined;
    } while (cursorValue);

    expect(seen).toEqual(orderedRows.map((row) => row.id));
    expect(new Set(seen)).toHaveLength(orderedRows.length);
  });

  it("walks a mixed activity tuple across a kind boundary without gaps", () => {
    const orderedRows = Array.from({ length: 19 }, (_, index) => ({
      id: uuidFor(index + 100),
      kind: kinds[index % kinds.length]!,
      createdAt: new Date("2026-11-04T12:30:00.000Z")
    })).sort(compareKindRows);
    const seen: string[] = [];
    let cursorValue: string | undefined;

    do {
      const cursor = decodeTimestampKindIdCursor(kindScope, cursorValue, kinds);
      const eligible = orderedRows.filter((row) => afterKindCursor(row, cursor));
      const page = keysetPage(
        eligible.slice(0, 5),
        4,
        (row) => `${row.kind}:${row.id}`,
        (row) => encodeTimestampKindIdCursor(
          kindScope,
          row.createdAt,
          row.kind,
          row.id
        )
      );
      seen.push(...page.items);
      cursorValue = page.nextCursor ?? undefined;
    } while (cursorValue);

    expect(seen).toEqual(orderedRows.map((row) => `${row.kind}:${row.id}`));
    expect(new Set(seen)).toHaveLength(orderedRows.length);
  });

  it("rejects ambiguous legacy precision and scopes new cursors", () => {
    const cursor = encodeTimestampIdCursor(
      timestampScope,
      "2026-11-04T12:30:00.000Z",
      uuidFor(999)
    );
    expect(decodeTimestampIdCursor(timestampScope, cursor)).toEqual({
      timestamp: "2026-11-04T12:30:00.000000Z",
      id: uuidFor(999)
    });
    expect(() => decodeTimestampIdCursor(timestampScope, "2026-11-04T12:30:00.000Z"))
      .toThrow(KeysetPaginationCursorError);
    const oldVersion = Buffer.from(JSON.stringify({
      v: 1,
      s: timestampScope,
      t: "2026-11-04T12:30:00.000Z",
      i: uuidFor(999)
    })).toString("base64url");
    expect(() => decodeTimestampIdCursor(timestampScope, oldVersion))
      .toThrow(KeysetPaginationCursorError);
    expect(() => decodeTimestampIdCursor("GET /v1/activity/payments", cursor))
      .toThrow(KeysetPaginationCursorError);
    expect(() => decodeTimestampIdCursor(timestampScope, Buffer.from("{}").toString("base64url")))
      .toThrow(KeysetPaginationCursorError);
  });

  it("binds cursors to hashed actor, filter, and sort context", () => {
    const scope = bindCursorScope(timestampScope, {
      actor: "private-actor-id",
      filter: "creator memberships",
      sort: "created_at:desc,id:desc"
    });
    const cursor = encodeTimestampIdCursor(
      scope,
      "2026-11-04T12:30:00.123456Z",
      uuidFor(1001)
    );
    const decodedPayload = Buffer.from(cursor, "base64url").toString("utf8");

    expect(decodedPayload).not.toContain("private-actor-id");
    expect(decodedPayload).not.toContain("creator memberships");
    expect(decodeTimestampIdCursor(scope, cursor).timestamp)
      .toBe("2026-11-04T12:30:00.123456Z");

    const changedActorScope = bindCursorScope(timestampScope, {
      actor: "other-actor-id",
      filter: "creator memberships",
      sort: "created_at:desc,id:desc"
    });
    const changedFilterScope = bindCursorScope(timestampScope, {
      actor: "private-actor-id",
      filter: "platform subscriptions",
      sort: "created_at:desc,id:desc"
    });
    expect(() => decodeTimestampIdCursor(changedActorScope, cursor))
      .toThrow(KeysetPaginationCursorError);
    expect(() => decodeTimestampIdCursor(changedFilterScope, cursor))
      .toThrow(KeysetPaginationCursorError);
  });
});

function uuidFor(value: number): string {
  return `00000000-0000-4000-8000-${value.toString(16).padStart(12, "0")}`;
}

function compareTimestampRows(
  left: { id: string; createdAt: Date },
  right: { id: string; createdAt: Date }
): number {
  return right.createdAt.getTime() - left.createdAt.getTime() || right.id.localeCompare(left.id);
}

function compareKindRows(
  left: { id: string; kind: string; createdAt: Date },
  right: { id: string; kind: string; createdAt: Date }
): number {
  return right.createdAt.getTime() - left.createdAt.getTime() ||
    right.kind.localeCompare(left.kind) ||
    right.id.localeCompare(left.id);
}

function afterTimestampCursor(
  row: { id: string; createdAt: Date },
  cursor: { timestamp: string | null; id: string | null }
): boolean {
  if (!cursor.timestamp) return true;
  const timestamp = cursorTimestamp(row.createdAt);
  return timestamp < cursor.timestamp || (
    timestamp === cursor.timestamp && (!cursor.id || row.id < cursor.id)
  );
}

function afterKindCursor(
  row: { id: string; kind: string; createdAt: Date },
  cursor: { timestamp: string | null; kind: string | null; id: string | null }
): boolean {
  if (!cursor.timestamp) return true;
  const timestamp = cursorTimestamp(row.createdAt);
  if (!cursor.kind || !cursor.id) return timestamp <= cursor.timestamp;
  return timestamp < cursor.timestamp || (
    timestamp === cursor.timestamp && (
      row.kind < cursor.kind || (row.kind === cursor.kind && row.id < cursor.id)
    )
  );
}
