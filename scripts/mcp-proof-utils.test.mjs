import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import {
  buildPkceSmokeInstructions
} from "./smoke-mcp-oauth-pkce.mjs";
import {
  profileConfig,
  validateMcpScopes,
  validateRedirectUris,
  validateSeedConfig
} from "./mcp-proof-utils.mjs";
import { runMcpRemoteSmoke } from "./smoke-mcp-remote.mjs";

describe("MCP proof helpers", () => {
  it("redacts bearer tokens in smoke output", async () => {
    const logs = [];
    await runMcpRemoteSmoke({
      baseUrl: "https://mcp.example.test",
      accessToken: "veel_oauth_at_super_sensitive_token",
      fetchImpl: fakeMcpFetch(),
      logger: { log: (line) => logs.push(String(line)) }
    });

    expect(logs.join("\n")).not.toContain("super_sensitive_token");
    expect(logs.join("\n")).toContain("[redacted]");
  });

  it("fails smoke when protected-resource metadata is missing", async () => {
    await expect(
      runMcpRemoteSmoke({
        baseUrl: "https://mcp.example.test",
        accessToken: "token",
        fetchImpl: async (url) =>
          jsonResponse(url.endsWith("/.well-known/oauth-protected-resource") ? {} : {}),
        logger: { log() {} }
      })
    ).rejects.toThrow("protected resource metadata resource");
  });

  it("fails smoke when the expected tool is missing", async () => {
    await expect(
      runMcpRemoteSmoke({
        baseUrl: "https://mcp.example.test",
        accessToken: "token",
        fetchImpl: fakeMcpFetch({ tools: [] }),
        logger: { log() {} }
      })
    ).rejects.toThrow("expected allowed tool");
  });

  it("fails smoke when the forbidden tool appears in tools/list", async () => {
    await expect(
      runMcpRemoteSmoke({
        baseUrl: "https://mcp.example.test",
        accessToken: "token",
        fetchImpl: fakeMcpFetch({
          tools: [{ name: "creator_get_profile" }, { name: "admin_list_payment_intents" }]
        }),
        logger: { log() {} }
      })
    ).rejects.toThrow("Forbidden tool was present");
  });

  it("validates seed redirect URIs and scopes", () => {
    expect(() => validateRedirectUris(["https://client.example/callback"])).not.toThrow();
    expect(() => validateRedirectUris(["http://127.0.0.1:8787/callback"])).not.toThrow();
    expect(() => validateRedirectUris(["https://*.example/callback"])).toThrow("Wildcard");
    expect(() => validateRedirectUris(["http://client.example/callback"])).toThrow("https or local");
    expect(() => validateMcpScopes(["creator.profile.read"])).not.toThrow();
    expect(() => validateMcpScopes(["admin.full_access"])).toThrow("Unknown MCP scope");
  });

  it("loads predefined seed profiles and requires explicit redirects where unknown", () => {
    const inspector = profileConfig("mcp-inspector-local", {});
    expect(inspector.redirectUris).toContain("http://127.0.0.1:6274/oauth/callback");

    const claude = profileConfig("claude-web-staging", {
      MCP_OAUTH_REDIRECT_URIS: "https://client.example/callback"
    });
    expect(claude.redirectUris).toEqual(["https://client.example/callback"]);
    expect(() => validateSeedConfig(profileConfig("claude-web-staging", {}))).toThrow("redirect URI");
  });

  it("builds PKCE authorization instructions", () => {
    const instructions = buildPkceSmokeInstructions({
      MCP_PUBLIC_BASE_URL: "https://mcp.example.test",
      MCP_OAUTH_CLIENT_ID: "client-id",
      MCP_OAUTH_REDIRECT_URI: "https://client.example/callback",
      MCP_OAUTH_SCOPE: "creator.profile.read"
    });

    expect(instructions.authorizationUrl).toContain("/oauth/authorize");
    expect(instructions.authorizationUrl).toContain("code_challenge_method=S256");
    expect(instructions.codeVerifier.length).toBeGreaterThanOrEqual(43);
    expect(instructions.curl).toContain("PASTE_CODE_FROM_CALLBACK");
  });

  it("rejects production MCP localhost and http public URLs", () => {
    const localhost = runDeployCheck({ MCP_PUBLIC_BASE_URL: "https://localhost:4000" });
    expect(localhost.status).not.toBe(0);
    expect(localhost.stderr).toContain("cannot be localhost");

    const http = runDeployCheck({ MCP_PUBLIC_BASE_URL: "http://mcp.example.test" });
    expect(http.status).not.toBe(0);
    expect(http.stderr).toContain("must use https");
  });

  it("accepts configured one-time USDC while preserving production safety gates", () => {
    const result = runDeployCheck({
      MCP_ENABLED: "false",
      PAYMENT_DEFAULT_ASSET: "USDC",
      PAYMENT_USDC_MINT: "usdc-mint"
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("no deployment");
  });

  it("blocks process-local rate limiting and adult live in production", () => {
    const localLimiter = runDeployCheck({
      MCP_ENABLED: "false",
      API_RATE_LIMIT_STORE_DRIVER: "process_memory"
    });
    expect(localLimiter.status).not.toBe(0);
    expect(localLimiter.stderr).toContain("implemented Redis adapter");

    const adultLive = runDeployCheck({
      MCP_ENABLED: "false",
      LIVEPEER_ADULT_LIVE_ENABLED: "true"
    });
    expect(adultLive.status).not.toBe(0);
    expect(adultLive.stderr).toContain("adult live is not launch-approved");
  });

  it("blocks production when staging evidence receipts are missing or unsafe", () => {
    const baseBundle = JSON.parse(productionDeployEnv().STAGING_EVIDENCE_BUNDLE_JSON);
    delete baseBundle.receipts.STAGING_PAYMENT_PROOF_ID;
    const missing = runDeployCheck({ STAGING_EVIDENCE_BUNDLE_JSON: JSON.stringify(baseBundle) });
    expect(missing.status).not.toBe(0);
    expect(missing.stderr).toContain("staging_payment_proof_id");

    baseBundle.receipts.STAGING_PAYMENT_PROOF_ID = "https://proof.example/?token=secret";
    const unsafe = runDeployCheck({ STAGING_EVIDENCE_BUNDLE_JSON: JSON.stringify(baseBundle) });
    expect(unsafe.status).not.toBe(0);
    expect(unsafe.stderr).toContain("opaque_redacted_reference");
    expect(unsafe.stderr).not.toContain("token=secret");
  });
});

function runDeployCheck(overrides) {
  const result = spawnSync(process.execPath, ["scripts/check-deploy-readiness.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env,
      ...productionDeployEnv(),
      ...overrides
    },
    encoding: "utf8"
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function productionDeployEnv() {
  return {
    NODE_ENV: "production",
    API_URL: "https://api.example.test",
    WEB_URL: "https://web.example.test",
    SUPABASE_URL: "https://supabase.example.test",
    SUPABASE_PROJECT_REF: "veel-prod",
    SUPABASE_PUBLISHABLE_KEY: "publishable",
    DATABASE_URL: "postgres://user:pass@db.example.test:5432/veel",
    SOLANA_RPC_URL: "https://api.devnet.solana.com",
    PAYMENT_PLATFORM_FEE_WALLET: "fee-wallet",
    HELIUS_WEBHOOK_SECRET: "helius",
    BUNNY_STREAM_API_KEY: "bunny",
    BUNNY_STREAM_LIBRARY_ID: "library",
    BUNNY_STREAM_EMBED_TOKEN_KEY: "embed",
    BUNNY_STREAM_WEBHOOK_READONLY_KEY: "webhook",
    LIVEPEER_API_KEY: "livepeer",
    LIVEPEER_WEBHOOK_SECRET: "livepeer-webhook",
    LIVEPEER_ACCESS_CONTROL_PRIVATE_KEY: "livepeer-private-key",
    LIVEPEER_ACCESS_CONTROL_PUBLIC_KEY: "livepeer-public-key",
    LIVEPEER_WEBHOOK_ID: "livepeer-webhook-id",
    LIVEPEER_MODERATION_MULTISTREAM_TARGET_ID: "livepeer-moderation-target",
    NOTIFICATION_DEVICE_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    AGE_VERIFICATION_DRIVER: "sumsub",
    TRANSACTIONAL_EMAIL_PROVIDER: "disabled",
    PAYMENT_DEFAULT_ASSET: "SOL",
    API_RATE_LIMIT_STORE_DRIVER: "redis",
    API_RATE_LIMIT_REDIS_URL: "rediss://redis.example.test:6380",
    LIVEPEER_ADULT_LIVE_ENABLED: "false",
    MEDIA_MODERATION_MODE: "launch_approved",
    RELEASE_MANIFEST_PATH: "release-manifest-test.json",
    EXPECTED_MANIFEST_DIGEST: `sha256:${"a".repeat(64)}`,
    STAGING_EVIDENCE_BUNDLE_JSON: JSON.stringify({
      schemaVersion: 1,
      manifestDigest: `sha256:${"a".repeat(64)}`,
      receipts: {
        BACKUP_RESTORE_PROOF_ID: "restore-proof-test",
        STAGING_IDENTITY_WALLET_PROOF_ID: "identity-wallet-proof",
        STAGING_VERIFICATION_PROOF_ID: "verification-proof",
        STAGING_PAYMENT_PROOF_ID: "payment-proof",
        STAGING_LIVEPEER_PROOF_ID: "livepeer-proof",
        STAGING_REALTIME_PUSH_PROOF_ID: "realtime-push-proof",
        STAGING_MODERATION_PROOF_ID: "moderation-proof",
        STAGING_STORAGE_BACKUP_PROOF_ID: "storage-backup-proof",
        STAGING_OBSERVABILITY_PROOF_ID: "observability-proof",
        STAGING_DEVICE_QA_PROOF_ID: "device-qa-proof",
        STAGING_ENTERPRISE_PROOF_ID: "enterprise-proof"
      }
    }),
    SUBSCRIPTIONS_ENABLED: "false",
    OTEL_EXPORTER_OTLP_ENDPOINT: "https://telemetry.example.test",
    LEGAL_DOCUMENTS_APPROVED: "true",
    LEGAL_TERMS_VERSION: "terms-test",
    LEGAL_PRIVACY_VERSION: "privacy-test",
    LEGAL_CONTACT_EMAIL: "legal@example.test",
    MCP_ENABLED: "true",
    MCP_AUTH_MODE: "oauth",
    MCP_REQUIRE_OAUTH: "true",
    MCP_ALLOW_STATIC_TOKENS_DEV: "false",
    MCP_OAUTH_AUTH_CODE_TTL_SECONDS: "600",
    MCP_OAUTH_ACCESS_TOKEN_TTL_SECONDS: "3600"
  };
}

function fakeMcpFetch({ tools = [{ name: "creator_get_profile" }] } = {}) {
  return async (url, init = {}) => {
    const textUrl = String(url);
    if (textUrl.endsWith("/.well-known/oauth-protected-resource")) {
      return jsonResponse({
        resource: "https://mcp.example.test/mcp",
        authorization_servers: ["https://mcp.example.test"]
      });
    }
    if (textUrl.endsWith("/.well-known/oauth-authorization-server")) {
      return jsonResponse({
        issuer: "https://mcp.example.test",
        grant_types_supported: ["authorization_code"]
      });
    }
    if (textUrl.endsWith("/mcp")) {
      const body = JSON.parse(init.body);
      if (body.method === "initialize") {
        return jsonResponse({ result: { serverInfo: { name: "veel-v2" } } });
      }
      if (body.method === "tools/list") {
        return jsonResponse({ result: { tools } });
      }
      if (body.params?.name === "admin_list_payment_intents") {
        return jsonResponse({ error: { message: "Connection is missing the required tool scope" } });
      }
      return jsonResponse({ result: { content: [{ type: "json", json: {} }] } });
    }
    return jsonResponse({}, 404);
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}
