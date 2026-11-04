import { ECDH } from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

const MAX_ENDPOINT_LENGTH = 2_048;
const DEFAULT_RESOLUTION_TIMEOUT_MS = 2_000;

export interface WebPushSubscriptionMaterial {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface WebPushResolvedAddress {
  address: string;
  family: 4 | 6;
}

export interface ValidatedWebPushSubscription extends WebPushSubscriptionMaterial {
  hostname: string;
  addresses: WebPushResolvedAddress[];
}

export type WebPushDnsResolver = (
  hostname: string
) => Promise<readonly WebPushResolvedAddress[]>;

export type WebPushValidationCode =
  | "invalid_endpoint"
  | "unsupported_push_service"
  | "invalid_subscription_key"
  | "resolution_failed"
  | "unsafe_push_service_address";

export class WebPushSubscriptionValidationError extends Error {
  readonly code: WebPushValidationCode;

  constructor(code: WebPushValidationCode) {
    super(code);
    this.name = "WebPushSubscriptionValidationError";
    this.code = code;
  }
}

export function normalizeWebPushSubscription(
  input: WebPushSubscriptionMaterial
): Omit<ValidatedWebPushSubscription, "addresses"> {
  const endpoint = normalizeWebPushEndpoint(input.endpoint);
  const p256dh = normalizeBase64UrlKey(input.p256dh, 65, true);
  const auth = normalizeBase64UrlKey(input.auth, 16, false);

  return {
    endpoint: endpoint.href,
    hostname: endpoint.hostname,
    p256dh,
    auth
  };
}

export async function validateWebPushSubscription(
  input: WebPushSubscriptionMaterial,
  options: {
    resolver?: WebPushDnsResolver;
    timeoutMs?: number;
  } = {}
): Promise<ValidatedWebPushSubscription> {
  const normalized = normalizeWebPushSubscription(input);
  const resolver = options.resolver ?? resolveWebPushHostname;
  const timeoutMs = options.timeoutMs ?? DEFAULT_RESOLUTION_TIMEOUT_MS;
  const addresses = await withResolutionDeadline(
    resolver(normalized.hostname),
    timeoutMs
  );

  if (addresses.length === 0) {
    throw new WebPushSubscriptionValidationError("resolution_failed");
  }

  const unique = new Map<string, WebPushResolvedAddress>();
  for (const resolved of addresses) {
    const family = isIP(resolved.address);
    if ((family !== 4 && family !== 6) || family !== resolved.family) {
      throw new WebPushSubscriptionValidationError("resolution_failed");
    }
    if (!isPublicInternetAddress(resolved.address, family)) {
      throw new WebPushSubscriptionValidationError("unsafe_push_service_address");
    }
    unique.set(`${family}:${resolved.address}`, {
      address: resolved.address,
      family
    });
  }

  return {
    ...normalized,
    addresses: [...unique.values()]
  };
}

export async function resolveWebPushHostname(
  hostname: string
): Promise<readonly WebPushResolvedAddress[]> {
  try {
    const addresses = await dnsLookup(hostname, { all: true, verbatim: true });
    return addresses.flatMap((entry) =>
      entry.family === 4 || entry.family === 6
        ? [{ address: entry.address, family: entry.family }]
        : []
    );
  } catch {
    throw new WebPushSubscriptionValidationError("resolution_failed");
  }
}

export function isPublicInternetAddress(address: string, family = isIP(address)): boolean {
  if (family !== 4 && family !== 6) return false;
  return !blockedWebPushAddresses.check(address, family === 4 ? "ipv4" : "ipv6");
}

function normalizeWebPushEndpoint(value: string): URL {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_ENDPOINT_LENGTH ||
    hasForbiddenEndpointCharacter(value)
  ) {
    throw new WebPushSubscriptionValidationError("invalid_endpoint");
  }

  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    throw new WebPushSubscriptionValidationError("invalid_endpoint");
  }

  if (
    endpoint.protocol !== "https:" ||
    endpoint.username !== "" ||
    endpoint.password !== "" ||
    endpoint.hash !== "" ||
    (endpoint.port !== "" && endpoint.port !== "443") ||
    endpoint.pathname === "/" ||
    endpoint.hostname.endsWith(".")
  ) {
    throw new WebPushSubscriptionValidationError("invalid_endpoint");
  }

  const hostname = endpoint.hostname.toLowerCase();
  const supported =
    hostname === "fcm.googleapis.com" ||
    hostname === "updates.push.services.mozilla.com" ||
    (hostname.endsWith(".push.apple.com") && hostname !== "push.apple.com");
  if (!supported) {
    throw new WebPushSubscriptionValidationError("unsupported_push_service");
  }

  return endpoint;
}

function hasForbiddenEndpointCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x20 || codePoint === 0x7f) return true;
  }
  return false;
}

function normalizeBase64UrlKey(value: string, expectedLength: number, p256: boolean): string {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9_-]+$/u.test(value) ||
    value.includes("=")
  ) {
    throw new WebPushSubscriptionValidationError("invalid_subscription_key");
  }

  const decoded = Buffer.from(value, "base64url");
  if (decoded.length !== expectedLength || decoded.toString("base64url") !== value) {
    throw new WebPushSubscriptionValidationError("invalid_subscription_key");
  }

  if (p256) {
    if (decoded[0] !== 0x04) {
      throw new WebPushSubscriptionValidationError("invalid_subscription_key");
    }
    try {
      const canonical = ECDH.convertKey(
        decoded,
        "prime256v1",
        undefined,
        undefined,
        "uncompressed"
      );
      if (!Buffer.isBuffer(canonical) || !canonical.equals(decoded)) {
        throw new Error("non-canonical P-256 point");
      }
    } catch {
      throw new WebPushSubscriptionValidationError("invalid_subscription_key");
    }
  }

  return value;
}

async function withResolutionDeadline<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new WebPushSubscriptionValidationError("resolution_failed");
  }

  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new WebPushSubscriptionValidationError("resolution_failed")),
          timeoutMs
        );
        timer.unref?.();
      })
    ]);
  } catch (error) {
    if (error instanceof WebPushSubscriptionValidationError) throw error;
    throw new WebPushSubscriptionValidationError("resolution_failed");
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function createBlockedWebPushAddressList(): BlockList {
  const blockList = new BlockList();
  const ipv4Ranges = [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.0.2.0", 24],
    ["192.88.99.0", 24],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15],
    ["198.51.100.0", 24],
    ["203.0.113.0", 24],
    ["224.0.0.0", 4],
    ["240.0.0.0", 4]
  ] as const;
  const ipv6Ranges = [
    ["::", 128],
    ["::1", 128],
    ["64:ff9b:1::", 48],
    ["100::", 64],
    ["2001:2::", 48],
    ["2001:10::", 28],
    ["2001:20::", 28],
    ["2001:db8::", 32],
    ["2002::", 16],
    ["fc00::", 7],
    ["fe80::", 10],
    ["ff00::", 8]
  ] as const;

  for (const [network, prefix] of ipv4Ranges) {
    blockList.addSubnet(network, prefix, "ipv4");
  }
  for (const [network, prefix] of ipv6Ranges) {
    blockList.addSubnet(network, prefix, "ipv6");
  }
  return blockList;
}

const blockedWebPushAddresses = createBlockedWebPushAddressList();
