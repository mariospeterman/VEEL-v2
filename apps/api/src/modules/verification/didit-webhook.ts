import { createHmac, timingSafeEqual } from "node:crypto";

const DIDIT_WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

export function verifyDiditV3Webhook(input: {
  body: unknown;
  headers: Record<string, string | string[] | undefined>;
  secret: string;
  now?: Date;
}): string | null {
  const signatures = [
    headerValue(input.headers["x-signature-v2"]),
    headerValue(input.headers["x-signature-v2-previous"])
  ].filter((signature): signature is string => signature !== null);
  const timestampHeader = headerValue(input.headers["x-timestamp"]);
  if (signatures.length === 0 || !timestampHeader) return null;

  const expected = createHmac("sha256", input.secret)
    .update(canonicalDiditJson(input.body), "utf8")
    .digest("hex");

  const signature = signatures.find((candidate) => secureEqualHex(expected, candidate));
  if (!signature) return null;

  // Didit V3's documented envelope includes a Unix dispatch timestamp and
  // X-Signature-V2 authenticates the complete canonical body. Never derive
  // freshness from the independently replaceable X-Timestamp header alone.
  const signedTimestamp = signedBodyTimestamp(input.body);
  const headerTimestamp = strictUnixSeconds(timestampHeader);
  if (signedTimestamp === null || headerTimestamp === null || signedTimestamp !== headerTimestamp) {
    return null;
  }

  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000);
  if (Math.abs(nowSeconds - signedTimestamp) > DIDIT_WEBHOOK_TOLERANCE_SECONDS) {
    return null;
  }

  return signature;
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

function signedBodyTimestamp(body: unknown): number | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const timestamp = (body as Record<string, unknown>).timestamp;
  return typeof timestamp === "number" && Number.isSafeInteger(timestamp) && timestamp >= 0
    ? timestamp
    : null;
}

function strictUnixSeconds(value: string): number | null {
  if (!/^[0-9]{1,16}$/.test(value)) return null;
  const timestamp = Number(value);
  return Number.isSafeInteger(timestamp) ? timestamp : null;
}

function secureEqualHex(left: string, right: string): boolean {
  if (!/^[a-f0-9]{64}$/i.test(left) || !/^[a-f0-9]{64}$/i.test(right)) return false;
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
