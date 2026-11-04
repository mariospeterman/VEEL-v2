import { KeysetPaginationCursorError } from "../../shared/keyset-pagination.js";

const cursorVersion = 1;
const planCursorScope = "GET /v1/subscriptions/plans";
const planIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export function encodeSubscriptionPlanCursor(planId: string): string {
  if (!planIdPattern.test(planId)) throw new KeysetPaginationCursorError();
  return Buffer.from(JSON.stringify({
    v: cursorVersion,
    s: planCursorScope,
    i: planId
  }), "utf8").toString("base64url");
}

export function decodeSubscriptionPlanCursor(cursor: string | undefined): string | null {
  if (!cursor) return null;
  if (cursor.length > 512 || !/^[A-Za-z0-9_-]+$/.test(cursor)) {
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
    !("i" in decoded)
  ) {
    throw new KeysetPaginationCursorError();
  }

  const payload = decoded as { v?: unknown; s?: unknown; i?: unknown };
  if (
    payload.v !== cursorVersion ||
    payload.s !== planCursorScope ||
    typeof payload.i !== "string" ||
    !planIdPattern.test(payload.i)
  ) {
    throw new KeysetPaginationCursorError();
  }

  return payload.i;
}
