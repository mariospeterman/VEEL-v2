import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { buildApi } from "../src/app.js";
import { verifiedContentExportArchiveBody } from "../src/modules/content-export/content-export-routes.js";
import type { ContentExportProvider } from "../src/content-export-provider.js";
import type {
  ContentExportRepository,
  ContentExportResource
} from "../src/modules/content-export/types.js";

const exportId = "00000000-0000-4000-8000-000000000101";
const grantId = "00000000-0000-4000-8000-000000000102";
const resource: ContentExportResource = {
  id: exportId,
  dataRequestId: "00000000-0000-4000-8000-000000000103",
  state: "processing",
  progress: { totalItems: 4, completedItems: 2, availableItems: 1, unavailableItems: 1 },
  attemptCount: 1,
  lastErrorCode: null,
  snapshotCreatedAt: "2026-11-06T00:00:00.000Z",
  archiveReadyAt: null,
  downloadableUntil: null,
  canCancel: true,
  canRetry: false,
  canDownload: false
};

describe("content export routes", () => {
  it("protects an idempotent cancellation with the current app owner", async () => {
    const cancel = vi.fn(async () => resource);
    const app = await buildApi({
      authVerifier: authVerifier(),
      contentExportRepository: repository({ cancel }),
      contentExportProvider: provider()
    });
    const response = await app.inject({
      method: "POST",
      url: `/v1/privacy/content-exports/${exportId}/cancel`,
      headers: { authorization: "Bearer valid", "idempotency-key": "cancel-export-1" }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(resource);
    expect(cancel).toHaveBeenCalledWith({
      userId: "00000000-0000-4000-8000-000000000001",
      jobId: exportId,
      idempotencyKey: "cancel-export-1"
    });
    await app.close();
  });

  it("streams archive bytes only after an owner grant is authorized", async () => {
    const body = Buffer.from("bounded tar bytes");
    const authorizeDownload = vi.fn(async () => ({
      archiveObjectKey: `exports/00000000-0000-4000-8000-000000000001/${exportId}.tar`,
      archiveByteSize: body.byteLength,
      archiveSha256: createHash("sha256").update(body).digest("hex"),
      filename: `wevid-content-export-${exportId}.tar`
    }));
    const openArchive = vi.fn(async () => ({
      byteLength: body.byteLength,
      body: (async function* () { yield body; })()
    }));
    const app = await buildApi({
      authVerifier: authVerifier(),
      contentExportRepository: repository({ authorizeDownload }),
      contentExportProvider: provider({ openArchive })
    });
    const response = await app.inject({
      method: "GET",
      url: `/v1/privacy/content-exports/${exportId}/downloads/${grantId}`,
      headers: { authorization: "Bearer valid" }
    });
    expect(response.statusCode).toBe(200);
    expect(response.rawPayload).toEqual(body);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.headers["content-disposition"]).toContain(exportId);
    expect(response.headers["content-digest"]).toMatch(/^sha-256=:[A-Za-z0-9+/=]+:$/);
    expect(authorizeDownload).toHaveBeenCalledWith({
      userId: "00000000-0000-4000-8000-000000000001",
      jobId: exportId,
      grantId,
      now: expect.any(Date)
    });
    expect(openArchive).toHaveBeenCalledOnce();
    await app.close();
  });

  it("does not call the provider for a missing or foreign grant", async () => {
    const openArchive = vi.fn();
    const app = await buildApi({
      authVerifier: authVerifier(),
      contentExportRepository: repository({ async authorizeDownload() { return null; } }),
      contentExportProvider: provider({ openArchive })
    });
    const response = await app.inject({
      method: "GET",
      url: `/v1/privacy/content-exports/${exportId}/downloads/${grantId}`,
      headers: { authorization: "Bearer valid" }
    });
    expect(response.statusCode).toBe(404);
    expect(openArchive).not.toHaveBeenCalled();
    await app.close();
  });

  it("rate-limits repeated archive download authorization attempts", async () => {
    const app = await buildApi({
      authVerifier: authVerifier(),
      contentExportRepository: repository({ async authorizeDownload() { return null; } }),
      contentExportProvider: provider()
    });
    const request = {
      method: "GET" as const,
      url: `/v1/privacy/content-exports/${exportId}/downloads/${grantId}`,
      headers: { authorization: "Bearer valid" }
    };
    for (let attempt = 0; attempt < 20; attempt += 1) {
      expect((await app.inject(request)).statusCode).toBe(404);
    }
    expect((await app.inject(request)).statusCode).toBe(429);
    await app.close();
  });

  it("rejects archive bytes that do not match the durable size and digest", async () => {
    const actual = Buffer.from("tampered archive bytes");
    const consume = async () => {
      for await (const _chunk of verifiedContentExportArchiveBody({
        body: (async function* () { yield actual; })(),
        expectedByteSize: actual.byteLength,
        expectedSha256: "a".repeat(64)
      })) {
        // Verification completes only after the full stream is consumed.
      }
    };

    await expect(consume()).rejects.toThrow("CONTENT_EXPORT_ARCHIVE_HASH_MISMATCH");
  });
});

function authVerifier() {
  return {
    async verifyToken() {
      return {
        userId: "00000000-0000-4000-8000-000000000001",
        supabaseUserId: "00000000-0000-4000-8000-000000000099",
        sessionId: "00000000-0000-4000-8000-000000000002",
        authenticatedAt: new Date(),
        authenticationMethod: "wallet" as const
      };
    }
  };
}

function repository(
  overrides: Partial<ContentExportRepository> = {}
): ContentExportRepository {
  return {
    async cancel() { return null; },
    async retry() { return null; },
    async createDownloadGrant() { return null; },
    async authorizeDownload() { return null; },
    ...overrides
  };
}

function provider(overrides: Partial<ContentExportProvider> = {}): ContentExportProvider {
  return {
    async openSource() { return { state: "unavailable", reason: "source_not_retained" }; },
    async uploadArchive() {},
    async openArchive() { throw new Error("not configured"); },
    async deleteArchiveObject() {},
    ...overrides
  };
}
