import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createBunnyStreamUploadAdapter } from "../src/modules/content/media-upload-adapter";

describe("Bunny private image storage adapter", () => {
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
});
