import { describe, expect, it } from "vitest";
import { serverEnvSchema } from "./index.js";

describe("content export environment", () => {
  it("is disabled by default and rejects ambiguous booleans", () => {
    expect(serverEnvSchema.parse({}).CONTENT_EXPORTS_ENABLED).toBe(false);
    expect(serverEnvSchema.safeParse({ CONTENT_EXPORTS_ENABLED: "yes" }).success).toBe(false);
  });

  it("parses only server-side Bunny export settings", () => {
    const parsed = serverEnvSchema.parse({
      CONTENT_EXPORTS_ENABLED: "true",
      BUNNY_STREAM_ORIGINAL_PULL_ZONE_URL: "https://originals.example",
      BUNNY_STREAM_CDN_TOKEN_KEY: "server-secret"
    });
    expect(parsed.CONTENT_EXPORTS_ENABLED).toBe(true);
    expect(parsed.BUNNY_STREAM_ORIGINAL_PULL_ZONE_URL).toBe("https://originals.example");
    expect(parsed.BUNNY_STREAM_CDN_TOKEN_KEY).toBe("server-secret");
  });
});
