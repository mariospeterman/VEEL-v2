const preciseTimestamp = Symbol("databaseTimestamp");
const canonicalCursorTimestampPattern =
  /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\.(\d{6})Z$/;

export type DatabaseDate = Date & { readonly [preciseTimestamp]?: string };

/**
 * Parse a PostgreSQL date/timestamp value without discarding its fractional
 * microseconds. The returned object remains a normal Date for every caller
 * that does not need the exact database ordering value.
 */
export function parseDatabaseDate(raw: string): Date {
  const value = new Date(raw);
  if (Number.isNaN(value.getTime())) return value;

  const fraction = raw.match(/\.(\d{1,6})(?=[Zz]|[+-]\d{2}(?::?\d{2})?$|$)/)?.[1];
  if (!fraction) return value;

  const exactTimestamp = `${value.toISOString().slice(0, -1)}${fraction
    .padEnd(6, "0")
    .slice(3)}Z`;
  Object.defineProperty(value, preciseTimestamp, {
    configurable: false,
    enumerable: false,
    value: exactTimestamp,
    writable: false
  });
  return value;
}

/** Return the exact UTC microsecond representation used in new cursors. */
export function cursorTimestamp(value: Date | string): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new RangeError("Invalid timestamp");
    return (value as DatabaseDate)[preciseTimestamp] ??
      `${value.toISOString().slice(0, -1)}000Z`;
  }

  const parsed = parseDatabaseDate(value);
  if (Number.isNaN(parsed.getTime())) throw new RangeError("Invalid timestamp");
  return (parsed as DatabaseDate)[preciseTimestamp] ??
    `${parsed.toISOString().slice(0, -1)}000Z`;
}

export function isCanonicalCursorTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = canonicalCursorTimestampPattern.exec(value);
  if (!match) return false;

  const millisecondsTimestamp = `${match[1]}.${match[2]!.slice(0, 3)}Z`;
  const parsed = new Date(millisecondsTimestamp);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === millisecondsTimestamp;
}
