import { describe, expect, it } from "vitest";
import {
  cursorTimestamp,
  isCanonicalCursorTimestamp,
  parseDatabaseDate
} from "../src/shared/database-timestamp.js";

describe("database timestamp precision", () => {
  it("keeps PostgreSQL microseconds without changing Date or JSON behavior", () => {
    const value = parseDatabaseDate("2026-11-04 12:30:00.123456+00");

    expect(value).toBeInstanceOf(Date);
    expect(value.getTime()).toBe(new Date("2026-11-04T12:30:00.123Z").getTime());
    expect(value.valueOf()).toBe(new Date("2026-11-04T12:30:00.123Z").valueOf());
    expect(value.toISOString()).toBe("2026-11-04T12:30:00.123Z");
    expect(JSON.stringify({ value })).toBe('{"value":"2026-11-04T12:30:00.123Z"}');
    expect(cursorTimestamp(value)).toBe("2026-11-04T12:30:00.123456Z");
  });

  it("normalizes offsets to UTC while retaining the exact fraction", () => {
    const value = parseDatabaseDate("2026-11-04 14:30:00.654321+02");

    expect(value.toISOString()).toBe("2026-11-04T12:30:00.654Z");
    expect(cursorTimestamp(value)).toBe("2026-11-04T12:30:00.654321Z");
  });

  it("retains precision from PostgreSQL timestamps without a timezone suffix", () => {
    const value = parseDatabaseDate("2026-11-04 12:30:00.123456");

    expect(cursorTimestamp(value).slice(-7)).toBe("123456Z");
  });

  it("pads ordinary Date and millisecond strings without changing their instant", () => {
    const date = new Date("2026-11-04T12:30:00.123Z");

    expect(cursorTimestamp(date)).toBe("2026-11-04T12:30:00.123000Z");
    expect(cursorTimestamp("2026-11-04T12:30:00.123Z"))
      .toBe("2026-11-04T12:30:00.123000Z");
  });

  it("accepts only real six-digit UTC values as canonical cursor timestamps", () => {
    expect(isCanonicalCursorTimestamp("2026-11-04T12:30:00.123456Z")).toBe(true);
    expect(isCanonicalCursorTimestamp("2026-11-04T12:30:00.123Z")).toBe(false);
    expect(isCanonicalCursorTimestamp("2026-02-30T12:30:00.123456Z")).toBe(false);
    expect(isCanonicalCursorTimestamp("2026-11-04T14:30:00.123456+02:00")).toBe(false);
  });
});
