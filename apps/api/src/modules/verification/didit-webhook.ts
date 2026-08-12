import { createHmac, timingSafeEqual } from "node:crypto";

const DIDIT_WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

export function verifyDiditV3Webhook(input: {
  body: unknown;
  headers: Record<string, string | string[] | undefined>;
  secret: string;
  now?: Date;
}): string | null {
  const signature = headerValue(input.headers["x-signature-v2"]);
  const timestamp = headerValue(input.headers["x-timestamp"]);
  if (!signature || !timestamp) return null;

  const timestampSeconds = Number.parseInt(timestamp, 10);
  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000);
  if (!Number.isFinite(timestampSeconds) || Math.abs(nowSeconds - timestampSeconds) > DIDIT_WEBHOOK_TOLERANCE_SECONDS) {
    return null;
  }

  const expected = createHmac("sha256", input.secret)
    .update(canonicalDiditJson(input.body), "utf8")
    .digest("hex");

  return secureEqualHex(expected, signature) ? signature : null;
}

export function canonicalDiditJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalDiditJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalDiditJson(record[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

function headerValue(value: string | string[] | undefined): string | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function secureEqualHex(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
