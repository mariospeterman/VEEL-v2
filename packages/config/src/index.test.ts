import { describe, expect, it } from "vitest";
import { serverEnvSchema } from "./index.js";

const booleanKeys = [
  "SUBSCRIPTIONS_ENABLED",
  "SUBSCRIPTIONS_REQUIRE_ONCHAIN_VERIFICATION",
  "LIVEPEER_ADULT_LIVE_ENABLED",
  "AGE_VERIFICATION_ALLOW_MOCK_PROVIDER",
  "AGE_VERIFICATION_PROVIDER_SELECTION_ENABLED",
  "AGE_VERIFICATION_PREFER_REUSABLE_CREDENTIALS",
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
