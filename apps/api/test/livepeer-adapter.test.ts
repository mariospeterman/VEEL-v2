import { generateKeyPairSync } from "node:crypto";
import { parseServerEnv } from "@veel/config";
import { describe, expect, it, vi } from "vitest";
import {
  createLivepeerProviderAdapter,
  LiveProviderRequestError
} from "../src/modules/live/livepeer-adapter";

describe("Livepeer provider adapter", () => {
  it("uses the configured API base URL and preserves provider stream facts", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          id: "stream-1",
          streamKey: "secret-stream-key",
          playbackId: "playback-1",
          isActive: false
        }),
        { status: 201, headers: { "content-type": "application/json" } }
      )
    );
    const adapter = createLivepeerProviderAdapter(
      livepeerEnv({ LIVEPEER_API_BASE_URL: "https://livepeer.example.test/custom-api" }),
      fetchMock
    );

    const room = await adapter.createRoom({ roomId: "room-1", title: "Launch room" });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://livepeer.example.test/custom-api/stream",
      expect.objectContaining({
        method: "POST",
        signal: expect.any(AbortSignal)
      })
    );
    expect(room).toMatchObject({
      provider: "livepeer",
      providerStreamId: "stream-1",
      providerPlaybackId: "playback-1",
      hostStreamKey: "secret-stream-key"
    });
  });

  it("classifies provider authentication failures without treating them as configuration", async () => {
    const adapter = createLivepeerProviderAdapter(
      livepeerEnv(),
      vi.fn(async () => new Response(null, { status: 401 }))
    );

    await expect(adapter.createRoom({ roomId: "room-1", title: "Launch room" })).rejects.toMatchObject({
      name: "LiveProviderRequestError",
      kind: "authentication",
      statusCode: 401,
      retryable: false
    } satisfies Partial<LiveProviderRequestError>);
  });

  it("signs playback access with Livepeer's official JWT helper", async () => {
    const keyPair = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const privateKey = Buffer.from(
      keyPair.privateKey.export({ type: "pkcs8", format: "pem" }).toString()
    ).toString("base64");
    const adapter = createLivepeerProviderAdapter(
      livepeerEnv({
        LIVEPEER_ACCESS_CONTROL_PRIVATE_KEY: privateKey,
        LIVEPEER_ACCESS_CONTROL_PUBLIC_KEY: "livepeer-public-key"
      })
    );

    const token = await adapter.createPlaybackJwt({
      playbackId: "playback-1",
      supabaseUserId: "user-1"
    });
    const payload = JSON.parse(
      Buffer.from(token?.split(".")[1] ?? "", "base64url").toString("utf8")
    ) as Record<string, unknown>;

    expect(payload).toMatchObject({
      action: "pull",
      iss: "http://localhost:4000",
      pub: "livepeer-public-key",
      sub: "playback-1",
      video: "none",
      custom: { userId: "user-1" }
    });
  });
});

function livepeerEnv(overrides: Record<string, string> = {}) {
  return parseServerEnv({
    NODE_ENV: "test",
    API_URL: "http://localhost:4000",
    WEB_URL: "http://localhost:3000",
    LIVEPEER_API_KEY: "livepeer-api-key",
    ...overrides
  });
}
