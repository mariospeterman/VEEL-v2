import { describe, expect, it } from "vitest";
import { readServerPublicWebEnv, serializePublicWebEnvScript } from "./public-env";

describe("runtime public web environment", () => {
  it("reads environment values dynamically instead of freezing build-time values", () => {
    const env = readServerPublicWebEnv({
      NODE_ENV: "production",
      NEXT_PUBLIC_APP_URL: "https://staging.wevid.example",
      NEXT_PUBLIC_API_BASE_URL: "https://api.staging.wevid.example",
      NEXT_PUBLIC_SOLANA_CHAIN: "solana:devnet",
      NEXT_PUBLIC_ENABLE_E2E_AUTH: "false",
      NEXT_PUBLIC_EMBEDDED_WALLET_RUNTIME_ENABLED: "false"
    });

    expect(env.NEXT_PUBLIC_APP_URL).toBe("https://staging.wevid.example");
    expect(env.NEXT_PUBLIC_API_BASE_URL).toBe("https://api.staging.wevid.example");
    expect(env.NEXT_PUBLIC_ENABLE_E2E_AUTH).toBe(false);
  });

  it("serializes parsed public values and escapes script-breaking input", () => {
    const env = readServerPublicWebEnv({
      NODE_ENV: "production",
      NEXT_PUBLIC_PRIVY_APP_ID: "</script><script>alert(1)</script>"
    });
    const script = serializePublicWebEnvScript(env);

    expect(script).toContain("globalThis.__WEVID_PUBLIC_ENV__=");
    expect(script).not.toContain("</script>");
    expect(script).toContain("\\u003c/script>");
    expect(script).not.toContain("DATABASE_URL");
  });
});
