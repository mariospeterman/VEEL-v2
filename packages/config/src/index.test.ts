import { createECDH } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  isPublicInternetAddress,
  normalizeWebPushSubscription,
  serverEnvSchema,
  validateWebPushSubscription,
  WebPushSubscriptionValidationError,
  type WebPushDnsResolver
} from "./index.js";

const booleanKeys = [
  "SUBSCRIPTIONS_ENABLED",
  "SUBSCRIPTIONS_REQUIRE_ONCHAIN_VERIFICATION",
  "LIVEPEER_ADULT_LIVE_ENABLED",
  "AGE_VERIFICATION_ALLOW_MOCK_PROVIDER",
  "MCP_ENABLED",
  "MCP_REQUIRE_OAUTH",
  "MCP_ALLOW_STATIC_TOKENS_DEV",
  "MCP_OAUTH_PUBLIC_CLIENT"
] as const;

describe("server boolean environment parsing", () => {
  it.each(booleanKeys)("parses explicit true and false strings for %s", (key) => {
    expect(serverEnvSchema.parse({ [key]: "true" })[key]).toBe(true);
    expect(serverEnvSchema.parse({ [key]: "false" })[key]).toBe(false);
  });

  it.each(booleanKeys)("rejects ambiguous values for %s", (key) => {
    expect(serverEnvSchema.safeParse({ [key]: "1" }).success).toBe(false);
    expect(serverEnvSchema.safeParse({ [key]: "yes" }).success).toBe(false);
  });

  it("keeps secure defaults when values are absent or empty", () => {
    const parsed = serverEnvSchema.parse({
      SUBSCRIPTIONS_ENABLED: "",
      LIVEPEER_ADULT_LIVE_ENABLED: "",
      AGE_VERIFICATION_ALLOW_MOCK_PROVIDER: "",
      MCP_ENABLED: ""
    });

    expect(parsed.SUBSCRIPTIONS_ENABLED).toBe(false);
    expect(parsed.LIVEPEER_ADULT_LIVE_ENABLED).toBe(false);
    expect(parsed.AGE_VERIFICATION_ALLOW_MOCK_PROVIDER).toBe(false);
    expect(parsed.MCP_ENABLED).toBe(false);
  });
});

describe("Solana environment authority", () => {
  it("derives compatibility aliases from the canonical cluster", () => {
    const parsed = serverEnvSchema.parse({
      SOLANA_CLUSTER: "mainnet-beta",
      SOLANA_RPC_URL: "https://mainnet-rpc.example"
    });

    expect(parsed.SOLANA_NETWORK).toBe("solana:mainnet");
    expect(parsed.HELIUS_CLUSTER).toBe("mainnet-beta");
    expect(parsed.SUBSCRIPTIONS_SOLANA_NETWORK).toBe("mainnet-beta");
  });

  it.each([
    { SOLANA_CLUSTER: "devnet", SOLANA_NETWORK: "solana:mainnet" },
    { SOLANA_CLUSTER: "devnet", NEXT_PUBLIC_SOLANA_CHAIN: "solana:mainnet" },
    { SOLANA_CLUSTER: "mainnet-beta", HELIUS_CLUSTER: "devnet" },
    { SOLANA_CLUSTER: "mainnet-beta", HELIUS_WEBHOOK_CLUSTER: "devnet" },
    { SOLANA_CLUSTER: "mainnet-beta", SUBSCRIPTIONS_SOLANA_NETWORK: "devnet" }
  ])("rejects contradictory aliases: %o", (environment) => {
    const result = serverEnvSchema.safeParse(environment);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain("Contradictory Solana environment");
    }
  });

  it("does not infer a private RPC network from its hostname", () => {
    const parsed = serverEnvSchema.parse({
      SOLANA_CLUSTER: "mainnet-beta",
      SOLANA_RPC_URL: "https://private-rpc.internal.example"
    });

    expect(parsed.SOLANA_CLUSTER).toBe("mainnet-beta");
    expect(parsed.SOLANA_RPC_URL).toBe("https://private-rpc.internal.example");
  });

  it("fails closed when mainnet would inherit the devnet RPC default", () => {
    expect(() => serverEnvSchema.parse({ SOLANA_CLUSTER: "mainnet-beta" }))
      .toThrow(/SOLANA_RPC_URL must explicitly select an approved mainnet RPC/);
  });
});

describe("web push subscription validation", () => {
  const p256dh = createECDH("prime256v1").generateKeys().toString("base64url");
  const auth = Buffer.alloc(16, 7).toString("base64url");
  const publicResolver: WebPushDnsResolver = async () => [
    { address: "8.8.8.8", family: 4 },
    { address: "2606:4700:4700::1111", family: 6 }
  ];

  it.each([
    "https://fcm.googleapis.com/fcm/send/browser-token",
    "https://updates.push.services.mozilla.com/wpush/v2/browser-token",
    "https://web.push.apple.com/QH5/browser-token"
  ])("accepts a canonical supported push service endpoint: %s", async (endpoint) => {
    await expect(
      validateWebPushSubscription(
        { endpoint, p256dh, auth },
        { resolver: publicResolver }
      )
    ).resolves.toMatchObject({ endpoint, p256dh, auth });
  });

  it.each([
    "http://fcm.googleapis.com/fcm/send/token",
    "https://user@fcm.googleapis.com/fcm/send/token",
    "https://fcm.googleapis.com:8443/fcm/send/token",
    "https://fcm.googleapis.com/fcm/send/token#fragment",
    "https://attacker.example/push/token",
    "https://push.apple.com/token"
  ])("rejects a noncanonical or unsupported endpoint: %s", (endpoint) => {
    expect(() => normalizeWebPushSubscription({ endpoint, p256dh, auth })).toThrow(
      WebPushSubscriptionValidationError
    );
  });

  it("rejects mixed public and private DNS answers", async () => {
    await expect(
      validateWebPushSubscription(
        {
          endpoint: "https://fcm.googleapis.com/fcm/send/browser-token",
          p256dh,
          auth
        },
        {
          resolver: async () => [
            { address: "8.8.8.8", family: 4 },
            { address: "169.254.169.254", family: 4 }
          ]
        }
      )
    ).rejects.toMatchObject({ code: "unsafe_push_service_address" });
  });

  it("requires canonical RFC 8291 key material", () => {
    expect(() =>
      normalizeWebPushSubscription({
        endpoint: "https://fcm.googleapis.com/fcm/send/browser-token",
        p256dh: Buffer.alloc(65, 4).toString("base64url"),
        auth
      })
    ).toThrow(WebPushSubscriptionValidationError);
    expect(() =>
      normalizeWebPushSubscription({
        endpoint: "https://fcm.googleapis.com/fcm/send/browser-token",
        p256dh,
        auth: Buffer.alloc(15, 7).toString("base64url")
      })
    ).toThrow(WebPushSubscriptionValidationError);
  });

  it.each([
    ["127.0.0.1", 4],
    ["10.0.0.1", 4],
    ["100.64.0.1", 4],
    ["::1", 6],
    ["::ffff:127.0.0.1", 6],
    ["fc00::1", 6],
    ["fe80::1", 6]
  ] as const)("classifies %s as non-public", (address, family) => {
    expect(isPublicInternetAddress(address, family)).toBe(false);
  });
});
