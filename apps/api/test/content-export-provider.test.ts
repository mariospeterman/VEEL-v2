import { describe, expect, it, vi } from "vitest";
import {
  createBunnyContentExportProvider,
  signBunnyCdnUrl
} from "../src/content-export-provider.js";

describe("content export Bunny provider", () => {
  it("uses Bunny's HS256 path-and-expiry CDN signature shape", () => {
    const signed = signBunnyCdnUrl({
      url: new URL("https://media.example/video-id/original"),
      tokenKey: "secret",
      expiresAt: 1_700_000_000
    });

    expect(signed.toString()).toBe(
      "https://media.example/video-id/original?token=HS256-MXvtHTlsLKFwddXub6tqEo2gpE0dCiUY3V-Iokhgox0&expires=1700000000"
    );
  });

  it("reads retained image bytes and streams a private tar upload with AccessKey", async () => {
    const uploaded: Uint8Array[] = [];
    const fetchImpl = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = input.toString();
      if (init?.method === "GET") {
        expect(url).toBe("https://storage.example/export-zone/source%20images/asset.webp");
        expect(new Headers(init.headers).get("AccessKey")).toBe("storage-secret");
        expect(init.redirect).toBe("error");
        return new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { "content-length": "3" }
        });
      }
      expect(init?.method).toBe("PUT");
      expect(url).toMatch(/^https:\/\/storage\.example\/export-zone\/exports\//);
      expect(new Headers(init?.headers).get("AccessKey")).toBe("storage-secret");
      expect(init?.redirect).toBe("error");
      const reader = (init?.body as ReadableStream<Uint8Array>).getReader();
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        uploaded.push(next.value);
      }
      return new Response(null, { status: 201 });
    });
    const provider = createBunnyContentExportProvider({
      enabled: true,
      storageAccessKey: "storage-secret",
      storageZoneName: "export-zone",
      storageApiEndpoint: "https://storage.example"
    }, fetchImpl as typeof fetch);

    const source = await provider.openSource({
      provider: "bunny",
      providerObjectReference: "source images/asset.webp",
      assetKind: "image"
    });
    expect(source.state).toBe("available");
    if (source.state !== "available") throw new Error("expected available source");
    const sourceChunks: number[] = [];
    for await (const chunk of source.body) sourceChunks.push(...chunk);
    expect(sourceChunks).toEqual([1, 2, 3]);

    await provider.uploadArchive({
      archiveObjectKey: "exports/00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000002.tar",
      body: (async function* () { yield new Uint8Array([4, 5, 6]); })()
    });
    expect(Array.from(Buffer.concat(uploaded.map((chunk) => Buffer.from(chunk))))).toEqual([4, 5, 6]);
  });

  it("reports a historical Stream original as honestly unavailable on 404", async () => {
    const provider = createBunnyContentExportProvider({
      enabled: true,
      streamOriginalPullZoneUrl: "https://stream.example",
      streamCdnTokenKey: "cdn-secret"
    }, vi.fn(async () => new Response(null, { status: 404 })) as typeof fetch);

    await expect(provider.openSource({
      provider: "bunny",
      providerObjectReference: "00000000-0000-4000-8000-000000000003",
      assetKind: "video"
    })).resolves.toEqual({ state: "unavailable", reason: "source_not_retained" });
  });

  it("refuses a source that cannot be represented by the portable ustar writer", async () => {
    const provider = createBunnyContentExportProvider({
      enabled: true,
      storageAccessKey: "storage-secret",
      storageZoneName: "export-zone",
      storageApiEndpoint: "https://storage.example",
      maximumSourceBytes: 20 * 1024 * 1024 * 1024
    }, vi.fn(async () => new Response(new Uint8Array([1]), {
      status: 200,
      headers: { "content-length": "8589934592" }
    })) as typeof fetch);

    await expect(provider.openSource({
      provider: "bunny",
      providerObjectReference: "source/oversized.webp",
      assetKind: "image"
    })).resolves.toEqual({ state: "unavailable", reason: "source_too_large" });
  });
});
