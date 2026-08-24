import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createBunnyStreamUploadAdapter } from "../src/modules/content/media-upload-adapter";

describe("Bunny private image storage adapter", () => {
  it("limits MCP TUS handoffs to Bunny's one-hour minimum without exposing the API key", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-23T10:00:00.000Z"));
    const adapter = createBunnyStreamUploadAdapter(
      {
        BUNNY_STREAM_API_KEY: "stream-library-key",
        BUNNY_STREAM_LIBRARY_ID: "12345"
      },
      async () => new Response(JSON.stringify({ guid: "video-guid" }), {
        status: 201,
        headers: { "content-type": "application/json" }
      })
    );

    const session = await adapter.createUploadSession({
      contentId: "00000000-0000-4000-8000-000000000040",
      title: "private MCP handoff",
      mimeType: "video/mp4",
      ttlSeconds: 60 * 60
    });
    expect(session.expiresAt.toISOString()).toBe("2026-08-23T11:00:00.000Z");
    expect(session.headers).toMatchObject({
      AuthorizationExpire: String(Math.floor(session.expiresAt.getTime() / 1000)),
      LibraryId: "12345",
      VideoId: "video-guid"
    });
    expect(session.headers.AuthorizationSignature).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.values(session.headers)).not.toContain("stream-library-key");
    vi.useRealTimers();
  });

  it("uses an opaque path, raw bytes, the zone key, and Bunny checksum verification", async () => {
    const body = Buffer.from("sanitized-image");
    const checksumSha256 = createHash("sha256").update(body).digest("hex");
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        new Response(null, { status: 201 })
    );
    const adapter = createBunnyStreamUploadAdapter(
      {
        BUNNY_STORAGE_IMAGE_UPLOAD_ENABLED: true,
        BUNNY_STORAGE_ACCESS_KEY: "storage-zone-password",
        BUNNY_STORAGE_ZONE_NAME: "private-zone",
        BUNNY_STORAGE_API_ENDPOINT: "https://uk.storage.bunnycdn.com",
        BUNNY_STORAGE_PULL_ZONE_URL: "https://private-media.example.test",
        BUNNY_STORAGE_PULL_ZONE_TOKEN_KEY: "pull-zone-token"
      },
      fetchMock as typeof fetch
    );
    const providerAssetId = adapter.createImageObjectReference?.({
      contentId: "00000000-0000-4000-8000-000000000040",
      mediaAssetId: "00000000-0000-4000-8000-000000000041",
      extension: "webp"
    });

    expect(adapter.isImageUploadConfigured?.()).toBe(true);
    expect(providerAssetId).toBe(
      "images/00000000-0000-4000-8000-000000000040/00000000-0000-4000-8000-000000000041.webp"
    );
    await adapter.uploadImageObject?.({
      providerAssetId: providerAssetId!,
      body,
      mimeType: "image/webp",
      checksumSha256
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(
      "https://uk.storage.bunnycdn.com/private-zone/images/00000000-0000-4000-8000-000000000040/00000000-0000-4000-8000-000000000041.webp"
    );
    expect(init).toMatchObject({
      method: "PUT",
      headers: {
        AccessKey: "storage-zone-password",
        Checksum: checksumSha256.toUpperCase(),
        "Content-Type": "image/webp"
      }
    });
    expect(Buffer.from(init!.body as ArrayBuffer)).toEqual(body);
  });

  it("stays disabled until the explicit flag and complete private-delivery config exist", () => {
    const adapter = createBunnyStreamUploadAdapter({
      BUNNY_STORAGE_ACCESS_KEY: "storage-zone-password",
      BUNNY_STORAGE_ZONE_NAME: "private-zone",
      BUNNY_STORAGE_API_ENDPOINT: "https://storage.bunnycdn.com"
    });

    expect(adapter.isImageUploadConfigured?.()).toBe(false);
  });

  it("deletes retired image and video objects through their documented provider APIs", async () => {
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        new Response(null, { status: 200 })
    );
    const adapter = createBunnyStreamUploadAdapter(
      {
        BUNNY_STREAM_API_KEY: "stream-library-key",
        BUNNY_STREAM_LIBRARY_ID: "12345",
        BUNNY_STORAGE_IMAGE_UPLOAD_ENABLED: true,
        BUNNY_STORAGE_ACCESS_KEY: "storage-zone-password",
        BUNNY_STORAGE_ZONE_NAME: "private-zone",
        BUNNY_STORAGE_API_ENDPOINT: "https://de.storage.bunnycdn.com"
      },
      fetchMock as typeof fetch
    );

    await adapter.deleteProviderAsset?.({
      assetKind: "image",
      providerAssetId: "images/content-id/asset-id.webp"
    });
    await adapter.deleteProviderAsset?.({ assetKind: "video", providerAssetId: "video-guid" });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ href: "https://de.storage.bunnycdn.com/private-zone/images/content-id/asset-id.webp" }),
      { method: "DELETE", headers: { AccessKey: "storage-zone-password" } }
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://video.bunnycdn.com/library/12345/videos/video-guid",
      { method: "DELETE", headers: { AccessKey: "stream-library-key" } }
    );
  });

  it("treats an already-absent retired object as an idempotent cleanup success", async () => {
    const adapter = createBunnyStreamUploadAdapter(
      {
        BUNNY_STORAGE_IMAGE_UPLOAD_ENABLED: true,
        BUNNY_STORAGE_ACCESS_KEY: "storage-zone-password",
        BUNNY_STORAGE_ZONE_NAME: "private-zone",
        BUNNY_STORAGE_API_ENDPOINT: "https://storage.bunnycdn.com"
      },
      async () => new Response(null, { status: 404 })
    );

    await expect(adapter.deleteProviderAsset?.({
      assetKind: "image",
      providerAssetId: "images/content-id/already-gone.webp"
    })).resolves.toBeUndefined();
  });
});
