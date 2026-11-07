import { describe, expect, it } from "vitest";
import {
  AdminPaginationCursorError,
  decodePriorityTimestampIdCursor,
  decodeTimestampIdCursor,
  decodeTimestampKeyCursor,
  decodeTwoTimestampIdCursor,
  encodePriorityTimestampIdCursor,
  encodeTimestampIdCursor,
  encodeTimestampKeyCursor,
  encodeTwoTimestampIdCursor,
  page,
  pageSize
} from "./admin-repository-mapper-utils.js";
import { cursorTimestamp } from "../../shared/database-timestamp.js";

const timestampScope = "GET /v1/admin/users";
const priorityScope = "GET /v1/admin/reports";

describe("admin repository pagination", () => {
  it("uses the last returned row, not the hidden lookahead row, as the next boundary", () => {
    const rows = Array.from({ length: pageSize + 1 }, (_, index) => ({
      id: uuidFor(index + 1),
      created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, pageSize + 1 - index))
    }));

    const result = page(
      rows,
      (row) => row.id,
      (row) => encodeTimestampIdCursor(timestampScope, row.created_at, row.id)
    );

    expect(result.items).toHaveLength(pageSize);
    expect(decodeTimestampIdCursor(timestampScope, result.nextCursor ?? undefined)).toEqual({
      timestamp: cursorTimestamp(rows[pageSize - 1]!.created_at),
      id: rows[pageSize - 1]!.id
    });
  });

  it("walks more than two timestamp pages without gaps or duplicates when timestamps tie", () => {
    const orderedRows = Array.from({ length: 121 }, (_, index) => ({
      id: uuidFor(index + 1),
      created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, 20 - Math.floor(index / 8)))
    })).sort(compareTimestampRows);
    const collected: string[] = [];
    let cursorValue: string | undefined;
    let pageCount = 0;

    do {
      const cursor = decodeTimestampIdCursor(timestampScope, cursorValue);
      const eligible = orderedRows.filter((row) => isAfterTimestampCursor(row, cursor));
      const result = page(
        eligible.slice(0, pageSize + 1),
        (row) => row.id,
        (row) => encodeTimestampIdCursor(timestampScope, row.created_at, row.id)
      );
      collected.push(...result.items);
      cursorValue = result.nextCursor ?? undefined;
      pageCount += 1;
    } while (cursorValue);

    expect(pageCount).toBe(3);
    expect(collected).toEqual(orderedRows.map((row) => row.id));
    expect(new Set(collected)).toHaveLength(orderedRows.length);
  });

  it("keeps the complete priority, timestamp, and id boundary across a queue transition", () => {
    const orderedRows = Array.from({ length: 121 }, (_, index) => ({
      id: uuidFor(index + 1000),
      priority: index < 55 ? 0 : 1,
      created_at: new Date(Date.UTC(2026, 1, 1, 0, 0, 15 - Math.floor(index / 6)))
    })).sort(comparePriorityRows);
    const collected: Array<{ id: string; priority: number }> = [];
    const pages: Array<Array<{ id: string; priority: number }>> = [];
    let cursorValue: string | undefined;

    do {
      const cursor = decodePriorityTimestampIdCursor(priorityScope, cursorValue);
      const eligible = orderedRows.filter((row) => isAfterPriorityCursor(row, cursor));
      const result = page(
        eligible.slice(0, pageSize + 1),
        (row) => ({ id: row.id, priority: row.priority }),
        (row) => encodePriorityTimestampIdCursor(
          priorityScope,
          row.priority,
          row.created_at,
          row.id
        )
      );
      pages.push(result.items);
      collected.push(...result.items);
      cursorValue = result.nextCursor ?? undefined;
    } while (cursorValue);

    expect(pages).toHaveLength(3);
    expect(pages[0]!.every((row) => row.priority === 0)).toBe(true);
    expect(pages[1]!.filter((row) => row.priority === 0)).toHaveLength(5);
    expect(pages[1]!.filter((row) => row.priority === 1)).toHaveLength(45);
    expect(collected.map((row) => row.id)).toEqual(orderedRows.map((row) => row.id));
    expect(new Set(collected.map((row) => row.id))).toHaveLength(orderedRows.length);
  });

  it("lets updated-at collections emit the updated timestamp even when created-at differs", () => {
    const rows = Array.from({ length: pageSize + 1 }, (_, index) => ({
      id: uuidFor(index + 2000),
      created_at: new Date(Date.UTC(2025, 0, 1, 0, 0, index)),
      updated_at: new Date(Date.UTC(2026, 0, 1, 0, 0, pageSize + 1 - index))
    }));

    const result = page(
      rows,
      (row) => row.id,
      (row) => encodeTimestampIdCursor(
        "GET /v1/admin/support/policies",
        row.updated_at,
        row.id
      )
    );
    const cursor = decodeTimestampIdCursor(
      "GET /v1/admin/support/policies",
      result.nextCursor ?? undefined
    );

    expect(cursor.timestamp).toBe(cursorTimestamp(rows[pageSize - 1]!.updated_at));
    expect(cursor.timestamp).not.toBe(cursorTimestamp(rows[pageSize - 1]!.created_at));
  });

  it("round-trips versioned, endpoint-scoped compound cursors", () => {
    const firstTimestamp = new Date("2026-11-04T12:30:00.000Z");
    const secondTimestamp = new Date("2026-11-03T10:15:00.000Z");
    const id = uuidFor(3000);

    const timestampCursor = encodeTimestampIdCursor(timestampScope, firstTimestamp, id);
    expect(decodeTimestampIdCursor(timestampScope, timestampCursor)).toEqual({
      timestamp: cursorTimestamp(firstTimestamp),
      id
    });
    expect(() => decodeTimestampIdCursor("GET /v1/admin/content", timestampCursor))
      .toThrow(AdminPaginationCursorError);

    const twoTimestampCursor = encodeTwoTimestampIdCursor(
      "GET /v1/admin/organizations/example/members",
      firstTimestamp,
      secondTimestamp,
      id
    );
    expect(decodeTwoTimestampIdCursor(
      "GET /v1/admin/organizations/example/members",
      twoTimestampCursor
    )).toEqual({
      firstTimestamp: cursorTimestamp(firstTimestamp),
      secondTimestamp: cursorTimestamp(secondTimestamp),
      id
    });
  });

  it("round-trips endpoint-scoped feature-flag key cursors", () => {
    const scope = "GET /v1/admin/feature-flags";
    const timestamp = new Date("2026-11-04T12:30:00.000Z");
    const key = "compliance.carf_exports";
    const cursor = encodeTimestampKeyCursor(scope, timestamp, key);

    expect(decodeTimestampKeyCursor(scope, cursor)).toEqual({
      timestamp: cursorTimestamp(timestamp),
      key
    });
    expect(() => decodeTimestampKeyCursor("GET /v1/admin/users", cursor))
      .toThrow(AdminPaginationCursorError);
  });

  it("rejects ambiguous legacy timestamps so callers restart from page one", () => {
    expect(() => decodeTimestampIdCursor(timestampScope, "2026-11-04T12:30:00.000Z"))
      .toThrow(AdminPaginationCursorError);
    expect(() => decodePriorityTimestampIdCursor(
      priorityScope,
      "2026-11-04T12:30:00.000Z"
    )).toThrow(AdminPaginationCursorError);
  });
});

function uuidFor(value: number): string {
  return `00000000-0000-4000-8000-${value.toString(16).padStart(12, "0")}`;
}

function compareTimestampRows(
  left: { id: string; created_at: Date },
  right: { id: string; created_at: Date }
): number {
  return right.created_at.getTime() - left.created_at.getTime() || right.id.localeCompare(left.id);
}

function comparePriorityRows(
  left: { id: string; priority: number; created_at: Date },
  right: { id: string; priority: number; created_at: Date }
): number {
  return left.priority - right.priority || compareTimestampRows(left, right);
}

function isAfterTimestampCursor(
  row: { id: string; created_at: Date },
  cursor: { timestamp: string | null; id: string | null }
): boolean {
  if (!cursor.timestamp) return true;
  const timestamp = cursorTimestamp(row.created_at);
  return timestamp < cursor.timestamp || (
    timestamp === cursor.timestamp && (!cursor.id || row.id < cursor.id)
  );
}

function isAfterPriorityCursor(
  row: { id: string; priority: number; created_at: Date },
  cursor: { priority: number | null; timestamp: string | null; id: string | null }
): boolean {
  if (cursor.priority === null || !cursor.timestamp || !cursor.id) return true;
  const timestamp = cursorTimestamp(row.created_at);
  return row.priority > cursor.priority || (
    row.priority === cursor.priority && (
      timestamp < cursor.timestamp || (timestamp === cursor.timestamp && row.id < cursor.id)
    )
  );
}
