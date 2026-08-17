import { generateKeyPairSync } from "node:crypto";
import { parseServerEnv } from "@veel/config";
import { describe, expect, it, vi } from "vitest";
import {
  createLivepeerProviderAdapter,
  LiveProviderRequestError
} from "../src/modules/live/livepeer-adapter";

describe("Livepeer provider adapter", () => {
  it("uses the configured API base URL and preserves provider stream facts", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
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
      fetchMock as typeof fetch
    );

    const room = await adapter.createRoom({ roomId: "room-1", title: "Launch room" });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://livepeer.example.test/custom-api/stream",
      expect.objectContaining({
        method: "POST",
        signal: expect.any(AbortSignal)
      })
    );
    const createInit = fetchMock.mock.calls[0]?.[1];
    expect(JSON.parse(String(createInit?.body))).toMatchObject({
      multistream: { targets: [{ id: "moderation-target", profile: "source" }] },
      playbackPolicy: { type: "jwt" },
      record: true,
      userTags: { veelRoomId: "room-1" }
    });
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

  it("reconciles stream state with the secondary playback projection", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      return url.endsWith("/stream/stream-1")
        ? new Response(JSON.stringify({
            id: "stream-1",
            playbackId: "playback-1",
            isActive: true
          }), { status: 200, headers: { "content-type": "application/json" } })
        : new Response(JSON.stringify({
            type: "live",
            meta: {
              source: [{
                type: "html5/application/vnd.apple.mpegurl",
                url: "https://playback.example/live.m3u8"
              }]
            }
          }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const adapter = createLivepeerProviderAdapter(livepeerEnv(), fetchMock as typeof fetch);

    await expect(adapter.getRoomStatus({
      providerStreamId: "stream-1",
      providerPlaybackId: "playback-1"
    })).resolves.toEqual({
      providerStreamId: "stream-1",
      providerPlaybackId: "playback-1",
      providerState: "active",
      state: "live",
      playbackUrl: "https://playback.example/live.m3u8"
    });
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
      appUserId: "user-1"
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

  it("fails production configuration closed until live moderation is launch approved", () => {
    const configured = {
      LIVEPEER_ACCESS_CONTROL_PRIVATE_KEY: "private",
      LIVEPEER_ACCESS_CONTROL_PUBLIC_KEY: "public",
      LIVEPEER_MODERATION_MULTISTREAM_TARGET_ID: "moderation-target",
      LIVEPEER_WEBHOOK_ID: "webhook-id",
      LIVEPEER_WEBHOOK_SECRET: "webhook-secret"
    };

    expect(createLivepeerProviderAdapter(livepeerEnv({ ...configured, NODE_ENV: "production" })).isConfigured()).toBe(false);
    expect(createLivepeerProviderAdapter(livepeerEnv({ ...configured, MEDIA_MODERATION_MODE: "launch_approved", NODE_ENV: "production" })).isConfigured()).toBe(true);
  });

  it("uses the official suspend and terminate operations", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    const adapter = createLivepeerProviderAdapter(livepeerEnv(), fetchMock);

    await adapter.setRoomSuspended({ providerStreamId: "stream-1", suspended: true });
    await adapter.terminateRoom({ providerStreamId: "stream-1" });

    expect(fetchMock).toHaveBeenNthCalledWith(1, "https://livepeer.studio/api/stream/stream-1", expect.objectContaining({ method: "PATCH" }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, "https://livepeer.studio/api/stream/stream-1/terminate", expect.objectContaining({ method: "DELETE" }));
  });
});

function livepeerEnv(overrides: Record<string, string> = {}) {
  return parseServerEnv({
    NODE_ENV: "test",
    API_URL: "http://localhost:4000",
    WEB_URL: "http://localhost:3000",
    LIVEPEER_API_KEY: "livepeer-api-key",
    LIVEPEER_ACCESS_CONTROL_PRIVATE_KEY: "private",
    LIVEPEER_ACCESS_CONTROL_PUBLIC_KEY: "public",
    LIVEPEER_MODERATION_MULTISTREAM_TARGET_ID: "moderation-target",
    LIVEPEER_WEBHOOK_ID: "webhook-id",
    LIVEPEER_WEBHOOK_SECRET: "webhook-secret",
    ...overrides
  });
}
