import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type postgres from "postgres";
import { describe, expect, it, vi } from "vitest";
import {
  contentExportOutcomeAfterCancellationFence,
  createPostgresContentExportRepository,
  processContentExports,
  restoreContentExportTar,
  type ContentExportItemOutcome,
  type ContentExportJobOutcome,
  type ContentExportProvider,
  type ContentExportRepository,
  type ContentExportSnapshot,
  type QueuedContentExportJob
} from "../src/content-exports.js";

const job: QueuedContentExportJob = {
  jobId: "00000000-0000-4000-8000-000000000010",
  dataRequestId: "00000000-0000-4000-8000-000000000011",
  requesterUserId: "00000000-0000-4000-8000-000000000012",
  archiveAttemptId: "00000000-0000-4000-8000-000000000014",
  archiveAttemptSequence: "1",
  archiveObjectKey: "exports/00000000-0000-4000-8000-000000000012/00000000-0000-4000-8000-000000000010.tar",
  snapshotCreatedAt: new Date("2026-11-06T00:00:00.000Z"),
  sourceHoldUntil: new Date("2026-11-07T00:00:00.000Z"),
  leaseToken: "00000000-0000-4000-8000-000000000013",
  attemptCount: 1,
  totalItems: 2
};

const bytes = Buffer.from("creator-owned-sanitized-image", "utf8");
const snapshot: ContentExportSnapshot = {
  contents: [{
    contentItemId: "00000000-0000-4000-8000-000000000020",
    compositionRevision: 3,
    mediaType: "image",
    contentState: "ready",
    publishState: "published",
    visibility: "public",
    nsfwLabel: "adult",
    moderationState: "approved",
    caption: "Mine",
    bodyText: null,
    createdAt: new Date("2026-10-01T00:00:00.000Z"),
    updatedAt: new Date("2026-10-02T00:00:00.000Z")
  }],
  items: [{
    contentItemId: "00000000-0000-4000-8000-000000000020",
    mediaAssetId: "00000000-0000-4000-8000-000000000021",
    compositionRevision: 3,
    assetKind: "image",
    position: 0,
    mimeType: "image/webp",
    widthPixels: 100,
    heightPixels: 100,
    durationMs: null,
    sourceChecksumSha256: createHash("sha256").update(bytes).digest("hex"),
    retiredAt: null,
    sourceProvider: "bunny",
    sourceObjectReference: "secret/provider/object.webp",
    sourceRetentionClass: "sanitized_retained_source",
    initialUnavailableReason: null
  }, {
    contentItemId: "00000000-0000-4000-8000-000000000020",
    mediaAssetId: "00000000-0000-4000-8000-000000000022",
    compositionRevision: 3,
    assetKind: "video",
    position: 1,
    mimeType: "video/mp4",
    widthPixels: 100,
    heightPixels: 100,
    durationMs: 1000,
    sourceChecksumSha256: null,
    retiredAt: new Date("2026-11-01T00:00:00.000Z"),
    sourceProvider: "livepeer",
    sourceObjectReference: "secret-livepeer-id",
    sourceRetentionClass: "provider_original",
    initialUnavailableReason: "provider_original_export_not_supported"
  }]
};

describe("content export worker", () => {
  it("streams a bounded tar, records progress, and independently restores hashes", async () => {
    const itemOutcomes: ContentExportItemOutcome[] = [];
    const jobOutcomes: ContentExportJobOutcome[] = [];
    let archive = Buffer.alloc(0);
    const repository = memoryRepository({ itemOutcomes, jobOutcomes });
    const provider: ContentExportProvider = {
      async openSource(input) {
        expect(input.providerObjectReference).toBe("secret/provider/object.webp");
        return {
          state: "available",
          byteLength: bytes.byteLength,
          body: (async function* () { yield bytes; })()
        };
      },
      async uploadArchive(input) {
        const chunks: Buffer[] = [];
        for await (const chunk of input.body) chunks.push(Buffer.from(chunk));
        archive = Buffer.concat(chunks);
      }
    };

    const result = await processContentExports({
      repository,
      provider,
      now: new Date("2026-11-06T01:00:00.000Z")
    });
    expect(result).toMatchObject({ leased: 1, ready: 1, retrying: 0, deadLettered: 0 });
    expect(itemOutcomes.map((outcome) => outcome.state)).toEqual(["exported", "unavailable"]);
    expect(jobOutcomes).toHaveLength(1);
    expect(jobOutcomes[0]).toMatchObject({ state: "ready", availableItems: 1, unavailableItems: 1 });

    const restoredBytes = new Map<string, Buffer>();
    let currentPath = "";
    let currentChunks: Buffer[] = [];
    const restored = await restoreContentExportTar({
      archive: (async function* () {
        for (let offset = 0; offset < archive.byteLength; offset += 777) {
          yield archive.subarray(offset, offset + 777);
        }
      })(),
      sink: {
        beginFile(input) { currentPath = input.path; currentChunks = []; },
        write(chunk) { currentChunks.push(Buffer.from(chunk)); },
        endFile() { restoredBytes.set(currentPath, Buffer.concat(currentChunks)); }
      },
      expectedArchiveSha256: createHash("sha256").update(archive).digest("hex")
    });
    expect(restored.manifest.assets).toHaveLength(2);
    expect(restored.manifest.assets[0]).toMatchObject({
      sourceLabel: "sanitized_retained_source",
      availability: "exported"
    });
    expect(restored.manifest.assets[1]).toMatchObject({
      availability: "unavailable",
      unavailableReason: "provider_original_export_not_supported"
    });
    expect(restoredBytes.get("content/00000000-0000-4000-8000-000000000020/assets/00000000-0000-4000-8000-000000000021.webp")).toEqual(bytes);
    expect(archive.toString("utf8")).not.toContain("secret/provider/object.webp");
    expect(archive.toString("utf8")).not.toContain("secret-livepeer-id");

    const systemRestoreDirectory = mkdtempSync(join(tmpdir(), "wevid-content-export-tar-"));
    try {
      const archivePath = join(systemRestoreDirectory, "export.tar");
      const outputDirectory = join(systemRestoreDirectory, "restored");
      writeFileSync(archivePath, archive);
      mkdirSync(outputDirectory);
      const extracted = spawnSync("tar", ["-xf", archivePath, "-C", outputDirectory], { encoding: "utf8" });
      expect(extracted.status, extracted.stderr).toBe(0);
      const systemBytes = readFileSync(join(
        outputDirectory,
        "content/00000000-0000-4000-8000-000000000020/assets/00000000-0000-4000-8000-000000000021.webp"
      ));
      expect(systemBytes).toEqual(bytes);
      expect(createHash("sha256").update(systemBytes).digest("hex"))
        .toBe(createHash("sha256").update(bytes).digest("hex"));
      expect(JSON.parse(readFileSync(join(outputDirectory, "manifest.json"), "utf8")))
        .toMatchObject({ schemaVersion: 1, archiveFormat: "ustar" });
    } finally {
      rmSync(systemRestoreDirectory, { recursive: true, force: true });
    }

    const archiveWithTrailingData = Buffer.concat([archive, Buffer.from([1])]);
    await expect(restoreContentExportTar({
      archive: (async function* () { yield archiveWithTrailingData; })(),
      sink: { beginFile() {}, write() {}, endFile() {} },
      expectedArchiveSha256: createHash("sha256").update(archiveWithTrailingData).digest("hex")
    })).rejects.toThrow("CONTENT_EXPORT_RESTORE_TRAILING_DATA");
  });

  it("rechecks current safety authority before reading a snapshotted source", async () => {
    const itemOutcomes: ContentExportItemOutcome[] = [];
    const jobOutcomes: ContentExportJobOutcome[] = [];
    const singleItemSnapshot = { ...snapshot, items: [snapshot.items[0]!] };
    const repository = memoryRepository({
      itemOutcomes,
      jobOutcomes,
      jobOverride: { ...job, totalItems: 1 },
      snapshotOverride: singleItemSnapshot,
      currentUnavailableReason: "content_restricted_by_safety_or_takedown"
    });
    const provider: ContentExportProvider = {
      openSource: vi.fn(),
      async uploadArchive(input) {
        for await (const _chunk of input.body) {
          // Consume the bounded manifest-only archive.
        }
      }
    };

    const result = await processContentExports({ repository, provider });

    expect(result.ready).toBe(1);
    expect(provider.openSource).not.toHaveBeenCalled();
    expect(itemOutcomes).toEqual([{
      state: "unavailable",
      reason: "content_restricted_by_safety_or_takedown"
    }]);
    expect(jobOutcomes[0]).toMatchObject({ state: "ready", availableItems: 0, unavailableItems: 1 });
  });

  it("records an over-ustar source as unavailable instead of dead-lettering the export", async () => {
    const itemOutcomes: ContentExportItemOutcome[] = [];
    const jobOutcomes: ContentExportJobOutcome[] = [];
    const singleItemSnapshot = { ...snapshot, items: [snapshot.items[0]!] };
    const repository = memoryRepository({
      itemOutcomes,
      jobOutcomes,
      jobOverride: { ...job, totalItems: 1 },
      snapshotOverride: singleItemSnapshot
    });
    const provider: ContentExportProvider = {
      async openSource() {
        return {
          state: "available",
          byteLength: 8_589_934_592,
          body: (async function* () {
            yield Promise.reject(new Error("oversized body must not be read"));
          })()
        };
      },
      async uploadArchive(input) {
        for await (const _chunk of input.body) {
          // Consume the bounded manifest-only archive.
        }
      }
    };

    const result = await processContentExports({ repository, provider });

    expect(result).toMatchObject({ ready: 1, deadLettered: 0 });
    expect(itemOutcomes).toEqual([{ state: "unavailable", reason: "source_too_large_for_ustar" }]);
    expect(jobOutcomes[0]).toMatchObject({ state: "ready", availableItems: 0, unavailableItems: 1 });
  });

  it("honors cancellation before any provider read or download linkage", async () => {
    const jobOutcomes: ContentExportJobOutcome[] = [];
    const repository = memoryRepository({ itemOutcomes: [], jobOutcomes, cancelled: true });
    const provider: ContentExportProvider = {
      openSource: vi.fn(),
      uploadArchive: vi.fn()
    };
    const result = await processContentExports({ repository, provider });
    expect(result.cancelled).toBe(1);
    expect(jobOutcomes).toEqual([{ state: "cancelled" }]);
    expect(provider.openSource).not.toHaveBeenCalled();
    expect(provider.uploadArchive).not.toHaveBeenCalled();
  });

  it("gives a locked cancellation fence precedence over a wrapped upload failure", async () => {
    expect(contentExportOutcomeAfterCancellationFence(
      { state: "retry", errorCode: "export_provider_unavailable" },
      true
    )).toEqual({ state: "cancelled" });

    let cancelled = false;
    const jobOutcomes: ContentExportJobOutcome[] = [];
    const repository = memoryRepository({ itemOutcomes: [], jobOutcomes });
    repository.isCancellationRequested = async () => cancelled;
    repository.recordJobOutcome = async (record) => {
      const accepted = contentExportOutcomeAfterCancellationFence(record.outcome, cancelled);
      jobOutcomes.push(accepted);
      return accepted;
    };
    const provider: ContentExportProvider = {
      async openSource() {
        return {
          state: "available",
          byteLength: bytes.byteLength,
          body: (async function* () { yield bytes; })()
        };
      },
      async uploadArchive(input) {
        for await (const _chunk of input.body) {
          cancelled = true;
          throw new Error("wrapped request-body failure");
        }
      }
    };
    const result = await processContentExports({ repository, provider });
    expect(result).toMatchObject({ cancelled: 1, retrying: 0 });
    expect(jobOutcomes).toEqual([{ state: "cancelled" }]);
  });

  it("keeps a stale slow PUT isolated from the newer winning archive pointer", async () => {
    const firstJob = {
      ...job,
      totalItems: 1,
      archiveAttemptId: "00000000-0000-4000-8000-000000000071",
      archiveAttemptSequence: "1",
      archiveObjectKey: "exports/00000000-0000-4000-8000-000000000012/00000000-0000-4000-8000-000000000072.tar",
      leaseToken: "00000000-0000-4000-8000-000000000073",
      attemptCount: 1
    };
    const secondJob = {
      ...firstJob,
      archiveAttemptId: "00000000-0000-4000-8000-000000000074",
      archiveAttemptSequence: "2",
      archiveObjectKey: "exports/00000000-0000-4000-8000-000000000012/00000000-0000-4000-8000-000000000075.tar",
      leaseToken: "00000000-0000-4000-8000-000000000076",
      attemptCount: 2
    };
    const singleItemSnapshot = { ...snapshot, items: [snapshot.items[0]!] };
    const firstUploadStarted = deferred<void>();
    const releaseFirstUpload = deferred<void>();
    const objects = new Map<string, Buffer>();
    let publishedObjectKey: string | null = null;
    const provider: ContentExportProvider = {
      async openSource() {
        return {
          state: "available",
          byteLength: bytes.byteLength,
          body: (async function* () { yield bytes; })()
        };
      },
      async uploadArchive(input) {
        const chunks: Buffer[] = [];
        for await (const chunk of input.body) chunks.push(Buffer.from(chunk));
        if (input.archiveObjectKey === firstJob.archiveObjectKey) {
          firstUploadStarted.resolve(undefined);
          await releaseFirstUpload.promise;
        }
        objects.set(input.archiveObjectKey, Buffer.concat(chunks));
      }
    };
    const firstRepository = memoryRepository({
      itemOutcomes: [], jobOutcomes: [], jobOverride: firstJob, snapshotOverride: singleItemSnapshot
    });
    firstRepository.recordJobOutcome = async () => null;
    const secondRepository = memoryRepository({
      itemOutcomes: [], jobOutcomes: [], jobOverride: secondJob, snapshotOverride: singleItemSnapshot
    });
    secondRepository.recordJobOutcome = async (record) => {
      if (record.outcome.state === "ready") publishedObjectKey = secondJob.archiveObjectKey;
      return record.outcome;
    };

    const stale = processContentExports({ repository: firstRepository, provider });
    await firstUploadStarted.promise;
    const winner = await processContentExports({ repository: secondRepository, provider });
    expect(winner.ready).toBe(1);
    expect(publishedObjectKey).toBe(secondJob.archiveObjectKey);
    const winningBytes = Buffer.from(objects.get(secondJob.archiveObjectKey)!);

    releaseFirstUpload.resolve(undefined);
    await stale;
    expect(objects.get(secondJob.archiveObjectKey)).toEqual(winningBytes);
    expect(objects.has(firstJob.archiveObjectKey)).toBe(true);
    expect(publishedObjectKey).toBe(secondJob.archiveObjectKey);
  });

  it("restarts after a lost upload response with a new key and publishes only the retry", async () => {
    const firstJob = {
      ...job,
      totalItems: 1,
      archiveAttemptId: "00000000-0000-4000-8000-000000000091",
      archiveAttemptSequence: "1",
      archiveObjectKey: "exports/00000000-0000-4000-8000-000000000012/00000000-0000-4000-8000-000000000092.tar",
      leaseToken: "00000000-0000-4000-8000-000000000093",
      attemptCount: 1
    };
    const restartedJob = {
      ...firstJob,
      archiveAttemptId: "00000000-0000-4000-8000-000000000094",
      archiveAttemptSequence: "2",
      archiveObjectKey: "exports/00000000-0000-4000-8000-000000000012/00000000-0000-4000-8000-000000000095.tar",
      leaseToken: "00000000-0000-4000-8000-000000000096",
      attemptCount: 2
    };
    const singleItemSnapshot = { ...snapshot, items: [snapshot.items[0]!] };
    const objects = new Map<string, Buffer>();
    let uploadNumber = 0;
    let publishedObjectKey: string | null = null;
    const provider: ContentExportProvider = {
      async openSource() {
        return {
          state: "available",
          byteLength: bytes.byteLength,
          body: (async function* () { yield bytes; })()
        };
      },
      async uploadArchive(input) {
        const chunks: Buffer[] = [];
        for await (const chunk of input.body) chunks.push(Buffer.from(chunk));
        objects.set(input.archiveObjectKey, Buffer.concat(chunks));
        uploadNumber += 1;
        if (uploadNumber === 1) throw new Error("provider accepted bytes but response was lost");
      }
    };
    const firstOutcomes: ContentExportJobOutcome[] = [];
    const firstRepository = memoryRepository({
      itemOutcomes: [], jobOutcomes: firstOutcomes, jobOverride: firstJob, snapshotOverride: singleItemSnapshot
    });
    const restartedRepository = memoryRepository({
      itemOutcomes: [], jobOutcomes: [], jobOverride: restartedJob, snapshotOverride: singleItemSnapshot
    });
    restartedRepository.recordJobOutcome = async (record) => {
      if (record.outcome.state === "ready") publishedObjectKey = restartedJob.archiveObjectKey;
      return record.outcome;
    };

    await expect(processContentExports({ repository: firstRepository, provider }))
      .resolves.toMatchObject({ retrying: 1, ready: 0 });
    expect(firstOutcomes[0]).toMatchObject({ state: "retry" });
    await expect(processContentExports({ repository: restartedRepository, provider }))
      .resolves.toMatchObject({ ready: 1, retrying: 0 });

    expect([...objects.keys()]).toEqual([firstJob.archiveObjectKey, restartedJob.archiveObjectKey]);
    expect(publishedObjectKey).toBe(restartedJob.archiveObjectKey);
    expect(objects.get(firstJob.archiveObjectKey)).toEqual(objects.get(restartedJob.archiveObjectKey));
  });

  it("dead-letters a transient failure on attempt eight", async () => {
    const jobOutcomes: ContentExportJobOutcome[] = [];
    const repository = memoryRepository({
      itemOutcomes: [],
      jobOutcomes,
      jobOverride: { ...job, attemptCount: 8 }
    });
    const provider: ContentExportProvider = {
      async openSource() {
        return {
          state: "available",
          byteLength: bytes.byteLength,
          body: (async function* () { yield bytes; })()
        };
      },
      async uploadArchive() {
        throw new Error("transient provider failure");
      }
    };

    await expect(processContentExports({ repository, provider }))
      .resolves.toMatchObject({ deadLettered: 1, retrying: 0 });
    expect(jobOutcomes[0]).toMatchObject({ state: "dead_letter" });
  });

  it("does not relabel or count an outcome after the finite lease is lost", async () => {
    const jobOutcomes: ContentExportJobOutcome[] = [];
    const repository = memoryRepository({ itemOutcomes: [], jobOutcomes, cancelled: true });
    repository.recordJobOutcome = async () => null;
    const provider: ContentExportProvider = {
      openSource: vi.fn(),
      uploadArchive: vi.fn()
    };
    const result = await processContentExports({ repository, provider });
    expect(result).toMatchObject({
      leased: 1,
      ready: 0,
      retrying: 0,
      deadLettered: 0,
      cancelled: 0
    });
    expect(jobOutcomes).toEqual([]);
  });

  it("clears expired processing leases and lets pending cancellation win", async () => {
    const cancelledJobId = "00000000-0000-4000-8000-000000000031";
    const failedJobId = "00000000-0000-4000-8000-000000000032";
    const { queries, sql } = postgresFixture((query) => {
      if (query.includes("select id, data_request_id, requester_user_id, cancel_requested_at")) {
        return [{
          id: cancelledJobId,
          data_request_id: "00000000-0000-4000-8000-000000000041",
          requester_user_id: job.requesterUserId,
          cancel_requested_at: new Date("2026-11-06T00:59:00.000Z"),
          state: "processing",
          lease_token: "00000000-0000-4000-8000-000000000051",
          source_hold_until: new Date("2026-11-06T01:00:00.000Z")
        }, {
          id: failedJobId,
          data_request_id: "00000000-0000-4000-8000-000000000042",
          requester_user_id: job.requesterUserId,
          cancel_requested_at: null,
          state: "processing",
          lease_token: "00000000-0000-4000-8000-000000000052",
          source_hold_until: new Date("2026-11-06T01:00:00.000Z")
        }];
      }
      return [];
    });
    const repository = createPostgresContentExportRepository({ sql });

    await expect(repository.expireElapsedSourceHolds({
      now: new Date("2026-11-06T01:00:00.000Z"),
      limit: 5
    })).resolves.toBe(2);

    const jobUpdates = queries.filter(({ text }) => text.includes("update content_export_jobs"));
    expect(jobUpdates).toHaveLength(2);
    for (const update of jobUpdates) {
      expect(update.text).toContain("next_attempt_at = null");
      expect(update.text).toContain("lease_token = null");
      expect(update.text).toContain("leased_until = null");
      expect(update.text).toContain("source_hold_until <= ?");
    }
    expect(jobUpdates[0]?.values).toContain("cancelled");
    expect(jobUpdates[0]?.values).toContain(null);
    expect(jobUpdates[1]?.values).toContain("dead_letter");
    expect(jobUpdates[1]?.values).toContain("export_source_hold_expired");

    const attemptUpdates = queries.filter(({ text }) =>
      text.includes("update content_export_archive_attempts")
    );
    expect(attemptUpdates).toHaveLength(2);
    for (const update of attemptUpdates) {
      expect(update.text).toContain("when upload_started_at is null then 'abandoned'");
      expect(update.text).toContain("else 'cleanup_required'");
      expect(update.text).toContain("state in ('allocated', 'uploading', 'uploaded')");
      const jobUpdateIndex = queries.findIndex(({ text, values }) =>
        text.includes("update content_export_jobs") && values.includes(update.values[0])
      );
      expect(queries.indexOf(update)).toBeLessThan(jobUpdateIndex);
    }

    const requestUpdates = queries.filter(({ text }) => text.includes("update data_requests"));
    expect(requestUpdates[0]?.values).toEqual(expect.arrayContaining([
      "cancelled",
      "cancelled_by_requester"
    ]));
    expect(requestUpdates[1]?.values).toEqual(expect.arrayContaining([
      "failed",
      "export_source_hold_expired"
    ]));

    const auditInserts = queries.filter(({ text }) => text.includes("insert into audit_events"));
    expect(auditInserts[0]?.values).toEqual(expect.arrayContaining([
      "content_export_cancelled",
      `worker:content-export:${cancelledJobId}:source-hold:2026-11-06T01:00:00.000Z:source-hold-cancelled`
    ]));
    expect(auditInserts[1]?.values).toEqual(expect.arrayContaining([
      "content_export_source_hold_expired",
      `worker:content-export:${failedJobId}:source-hold:2026-11-06T01:00:00.000Z:source-hold-expired`
    ]));
  });

  it("terminalizes an expired eighth lease instead of creating a non-runnable retry", async () => {
    const exhaustedJobId = "00000000-0000-4000-8000-000000000081";
    const exhaustedRequestId = "00000000-0000-4000-8000-000000000082";
    const { queries, sql } = postgresFixture((query) => {
      if (query.includes("select id, data_request_id, requester_user_id, attempt_count")) {
        return [{
          id: exhaustedJobId,
          data_request_id: exhaustedRequestId,
          requester_user_id: job.requesterUserId,
          attempt_count: 8,
          archive_attempt_sequence: "8",
          cancel_requested_at: null,
          lease_token: "00000000-0000-4000-8000-000000000083"
        }];
      }
      if (query.includes("update content_export_archive_attempts") && query.includes("returning state")) {
        return [{ state: "abandoned" }];
      }
      return [];
    });
    const repository = createPostgresContentExportRepository({ sql });

    await expect(repository.leaseDueExports({
      now: new Date("2026-11-06T01:00:00.000Z"),
      limit: 5,
      leaseDurationMs: 60_000
    })).resolves.toEqual([]);

    const terminal = queries.find(({ text }) =>
      text.includes("update content_export_jobs") && text.includes("export_attempt_budget_exhausted")
    );
    expect(terminal?.text).toContain("export_attempt_budget_exhausted");
    expect(terminal?.values).toEqual(expect.arrayContaining([exhaustedJobId]));
    const request = queries.find(({ text }) =>
      text.includes("update data_requests") && text.includes("export_attempt_budget_exhausted")
    );
    expect(request?.values).toEqual(expect.arrayContaining([exhaustedRequestId]));
    const audit = queries.find(({ text, values }) =>
      text.includes("insert into audit_events") && values.includes("content_export_attempt_budget_exhausted")
    );
    expect(audit?.values).toEqual(expect.arrayContaining([
      "content_export_attempt_budget_exhausted",
      `worker:content-export:${exhaustedJobId}:archive-attempt:8:attempt-budget-exhausted`
    ]));
    expect(audit?.values).toEqual(expect.arrayContaining([
      expect.objectContaining({
        archiveAttemptState: "abandoned",
        cleanupRequiresConfirmation: false
      })
    ]));
    const reclaimSelection = queries.find(({ text }) =>
      text.includes("select id, data_request_id, requester_user_id, attempt_count")
    );
    expect(reclaimSelection?.text).toContain("for update skip locked");
    expect(queries.some(({ text }) =>
      text.includes("update content_export_archive_attempts attempt") && text.includes("from content_export_jobs")
    )).toBe(false);
    const retryRecovery = queries.find(({ text }) =>
      text.includes("set state = 'retry'") && text.includes("attempt_count <")
    );
    expect(retryRecovery).toBeUndefined();
  });

  it("requires cleanup confirmation for an exhausted lease only after upload started", async () => {
    const exhaustedJobId = "00000000-0000-4000-8000-000000000084";
    const { queries, sql } = postgresFixture((query) => {
      if (query.includes("select id, data_request_id, requester_user_id, attempt_count")) {
        return [{
          id: exhaustedJobId,
          data_request_id: "00000000-0000-4000-8000-000000000085",
          requester_user_id: job.requesterUserId,
          attempt_count: 8,
          archive_attempt_sequence: "8",
          cancel_requested_at: null,
          lease_token: "00000000-0000-4000-8000-000000000086"
        }];
      }
      if (query.includes("update content_export_archive_attempts") && query.includes("returning state")) {
        return [{ state: "cleanup_required" }];
      }
      return [];
    });
    const repository = createPostgresContentExportRepository({ sql });

    await expect(repository.leaseDueExports({
      now: new Date("2026-11-06T01:00:00.000Z"),
      limit: 1,
      leaseDurationMs: 60_000
    })).resolves.toEqual([]);

    const audit = queries.find(({ text, values }) =>
      text.includes("insert into audit_events") && values.includes("content_export_attempt_budget_exhausted")
    );
    expect(audit?.values).toEqual(expect.arrayContaining([
      expect.objectContaining({
        archiveAttemptState: "cleanup_required",
        cleanupRequiresConfirmation: true
      })
    ]));
  });

  it("allocates monotonic archive identities when a dead-letter retry resets its budget", async () => {
    let leaseNumber = 0;
    const { queries, sql } = postgresFixture((query) => {
      if (query.includes("snapshot_created_at, source_hold_until, attempt_count")) {
        return [{
          id: job.jobId,
          data_request_id: job.dataRequestId,
          requester_user_id: job.requesterUserId,
          snapshot_created_at: job.snapshotCreatedAt,
          source_hold_until: job.sourceHoldUntil,
          attempt_count: 0,
          progress_total_items: 0
        }];
      }
      if (query.includes("returning id, archive_attempt_sequence")) {
        leaseNumber += 1;
        return [{ id: job.jobId, archive_attempt_sequence: String(8 + leaseNumber) }];
      }
      return [];
    });
    const repository = createPostgresContentExportRepository({ sql });
    const leaseInput = {
      now: new Date("2026-11-06T01:00:00.000Z"),
      limit: 1,
      leaseDurationMs: 60_000
    };

    const firstCycle = await repository.leaseDueExports(leaseInput);
    const secondCycle = await repository.leaseDueExports(leaseInput);

    expect(firstCycle[0]).toMatchObject({ attemptCount: 1, archiveAttemptSequence: "9" });
    expect(secondCycle[0]).toMatchObject({ attemptCount: 1, archiveAttemptSequence: "10" });
    const attemptInserts = queries.filter(({ text }) =>
      text.includes("insert into content_export_archive_attempts")
    );
    expect(attemptInserts).toHaveLength(2);
    expect(attemptInserts[0]?.values.slice(2, 4)).toEqual(["9", 1]);
    expect(attemptInserts[1]?.values.slice(2, 4)).toEqual(["10", 1]);
    const startAudits = queries.filter(({ text, values }) =>
      text.includes("insert into audit_events") && values.includes("content_export_processing_started")
    );
    expect(startAudits).toHaveLength(2);
    expect(startAudits[0]?.values).toEqual(expect.arrayContaining([
      `worker:content-export:${job.jobId}:archive-attempt:9:started`
    ]));
    expect(startAudits[1]?.values).toEqual(expect.arrayContaining([
      `worker:content-export:${job.jobId}:archive-attempt:10:started`
    ]));
  });

  it("fails current source authorization and heartbeats after the hold deadline", async () => {
    const { queries, sql } = postgresFixture((query) => {
      if (query.includes("end as unavailable_reason")) {
        return [{ unavailable_reason: "export_source_hold_expired" }];
      }
      if (query.includes(") as cancelled")) return [{ cancelled: true }];
      return [];
    });
    const repository = createPostgresContentExportRepository({ sql });

    await expect(repository.findCurrentItemUnavailableReason({
      job,
      item: snapshot.items[0]!
    })).resolves.toBe("export_source_hold_expired");
    await expect(repository.heartbeat({
      job,
      now: new Date("2026-11-07T00:00:00.000Z"),
      leaseDurationMs: 60_000
    })).resolves.toBe(false);
    await expect(repository.isCancellationRequested(job)).resolves.toBe(true);

    const authorization = queries.find(({ text }) => text.includes("end as unavailable_reason"));
    expect(authorization?.text).toContain("job.source_hold_until <= clock_timestamp()");
    const heartbeat = queries.find(({ text }) =>
      text.includes("update content_export_jobs") && text.includes("set leased_until = least")
    );
    expect(heartbeat?.text).toContain("source_hold_until > clock_timestamp()");
    expect(heartbeat?.text).toContain("source_hold_until");
    const cancellationFence = queries.find(({ text }) => text.includes(") as cancelled"));
    expect(cancellationFence?.text).toContain("source_hold_until <= clock_timestamp()");
  });

  it("distinguishes an authorized NULL restriction from an absent or denied source row", async () => {
    const repositoryFor = (rows: Array<{ unavailable_reason: string | null }>) => {
      const { sql } = postgresFixture((query) => query.includes("end as unavailable_reason") ? rows : []);
      return createPostgresContentExportRepository({ sql });
    };

    await expect(repositoryFor([{ unavailable_reason: null }]).findCurrentItemUnavailableReason({
      job,
      item: snapshot.items[0]!
    })).resolves.toBeNull();
    await expect(repositoryFor([]).findCurrentItemUnavailableReason({
      job,
      item: snapshot.items[0]!
    })).resolves.toBe("export_source_not_authorized");
    await expect(repositoryFor([{ unavailable_reason: "provider_object_retired" }])
      .findCurrentItemUnavailableReason({ job, item: snapshot.items[0]! }))
      .resolves.toBe("provider_object_retired");
  });
});

function memoryRepository(input: {
  itemOutcomes: ContentExportItemOutcome[];
  jobOutcomes: ContentExportJobOutcome[];
  cancelled?: boolean;
  currentUnavailableReason?: string | null;
  jobOverride?: QueuedContentExportJob;
  snapshotOverride?: ContentExportSnapshot;
}): ContentExportRepository {
  return {
    async leaseDueExports() { return [input.jobOverride ?? job]; },
    async loadSnapshot() { return input.snapshotOverride ?? snapshot; },
    async findCurrentItemUnavailableReason() { return input.currentUnavailableReason ?? null; },
    async recordItemOutcome(record) { input.itemOutcomes.push(record.outcome); },
    async heartbeat() { return true; },
    async isCancellationRequested() { return input.cancelled ?? false; },
    async markArchiveUploadStarted() { return !(input.cancelled ?? false); },
    async markArchiveUploadCompleted() { return !(input.cancelled ?? false); },
    async recordJobOutcome(record) {
      input.jobOutcomes.push(record.outcome);
      return record.outcome;
    },
    async quarantineExpiredArchives() { return 0; },
    async expireElapsedSourceHolds() { return 0; }
  };
}

interface RecordedPostgresQuery {
  text: string;
  values: unknown[];
}

function postgresFixture(
  rowsForQuery: (query: string) => unknown[]
): { queries: RecordedPostgresQuery[]; sql: postgres.Sql } {
  const queries: RecordedPostgresQuery[] = [];
  const execute = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    queries.push({ text, values });
    return Promise.resolve(rowsForQuery(text));
  };
  const transaction = vi.fn(execute) as unknown as postgres.TransactionSql;
  (transaction as unknown as { json(value: unknown): unknown }).json = (value) => value;
  const sql = vi.fn(execute) as unknown as postgres.Sql;
  (sql as unknown as {
    begin<T>(work: (tx: postgres.TransactionSql) => Promise<T>): Promise<T>;
  }).begin = (work) => work(transaction);
  return { queries, sql };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
