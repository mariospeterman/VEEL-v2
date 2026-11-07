import { describe, expect, it } from "vitest";
import type postgres from "postgres";
import { createPrivacyRepository } from "../src/modules/admin/admin-repository-privacy.js";
import { AdminRepositoryStateConflictError } from "../src/modules/admin/admin-repository.js";
import {
  type DataRequestRow,
  toDataRequest
} from "../src/modules/admin/admin-repository-support-mappers.js";

const exportRow: DataRequestRow = {
  id: "00000000-0000-4000-8000-000000000170",
  requester_user_id: "00000000-0000-4000-8000-000000000011",
  type: "export",
  state: "completed",
  privacy_boundary: "sanitized_identity_minimized_no_raw_exports",
  content_export_job_id: "00000000-0000-4000-8000-000000000171",
  content_export_job_state: "ready",
  content_export_cleanup_state: "retained_private",
  content_export_archive_upload_started_at: new Date("2026-06-06T12:05:00.000Z"),
  content_export_cleanup_required_attempt_count: "2",
  content_export_oldest_cleanup_required_attempt_at: new Date("2026-06-06T12:06:00.000Z"),
  created_at: new Date("2026-06-06T12:00:00.000Z"),
  updated_at: new Date("2026-06-06T12:30:00.000Z"),
  completed_at: new Date("2026-06-06T12:30:00.000Z")
};

describe("admin content export operations visibility", () => {
  it("keeps older cleanup-required attempts visible after a later archive wins", async () => {
    const queries: string[] = [];
    const sql = ((first: TemplateStringsArray | string, ...values: unknown[]) => {
      if (typeof first === "string") return { fragment: first };
      const query = first.reduce(
        (text, part, index) => text + part + (index < values.length ? "?" : ""),
        ""
      );
      queries.push(query);
      return Promise.resolve([exportRow]);
    }) as unknown as postgres.Sql;

    const result = await createPrivacyRepository(sql).listDataRequests({});

    expect(result.items).toEqual([
      {
        id: exportRow.id,
        requesterUserId: exportRow.requester_user_id,
        type: "export",
        state: "completed",
        privacyBoundary: "sanitized_identity_minimized_no_raw_exports",
        contentExportJobId: exportRow.content_export_job_id,
        contentExportJobState: "ready",
        contentExportCleanupState: "retained_private",
        contentExportArchiveUploadStartedAt: "2026-06-06T12:05:00.000Z",
        contentExportCleanupRequiredAttemptCount: 2,
        contentExportOldestCleanupRequiredAttemptAt: "2026-06-06T12:06:00.000Z",
        createdAt: "2026-06-06T12:00:00.000Z",
        updatedAt: "2026-06-06T12:30:00.000Z",
        completedAt: "2026-06-06T12:30:00.000Z"
      }
    ]);
    expect(queries[0]).toContain("left join content_export_jobs export_job");
    expect(queries[0]).toContain("request.type = 'export'");
    expect(queries[0]).toContain("export_job.archive_upload_started_at");
    expect(queries[0]).toContain("from content_export_archive_attempts attempt");
    expect(queries[0]).toContain("attempt.state = 'cleanup_required'");
    expect(queries[0]).toContain("min(attempt.created_at)");
    expect(queries[0]).not.toMatch(/archive_object_key|archive_sha256|source_object_reference/);
  });

  it("forces every export-only field to null for delete requests", () => {
    expect(toDataRequest({ ...exportRow, type: "delete" })).toMatchObject({
      type: "delete",
      contentExportJobId: null,
      contentExportJobState: null,
      contentExportCleanupState: null,
      contentExportArchiveUploadStartedAt: null,
      contentExportCleanupRequiredAttemptCount: null,
      contentExportOldestCleanupRequiredAttemptAt: null
    });
  });

  it("keeps export lifecycle read-only through the generic admin mutation", async () => {
    const queries: string[] = [];
    const transaction = (async (first: TemplateStringsArray, ...values: unknown[]) => {
      const query = first.reduce(
        (text, part, index) => text + part + (index < values.length ? "?" : ""),
        ""
      );
      queries.push(query);
      if (query.includes("from users")) {
        return [{ id: "00000000-0000-4000-8000-000000000001" }];
      }
      if (query.includes("select type") && query.includes("from data_requests")) {
        return [{ type: "export" }];
      }
      return [];
    }) as unknown as postgres.TransactionSql;
    (transaction as unknown as { json(value: unknown): unknown }).json = (value) => value;
    const sql = (() => Promise.resolve([])) as unknown as postgres.Sql;
    (sql as unknown as {
      begin<T>(work: (tx: postgres.TransactionSql) => Promise<T>): Promise<T>;
    }).begin = (work) => work(transaction);
    const repository = createPrivacyRepository(sql);

    await expect(repository.updateDataRequest({
      supabaseUserId: "00000000-0000-4000-8000-000000000002",
      dataRequestId: exportRow.id,
      body: { state: "rejected", reason: "Compliance review rejected the request" },
      idempotencyKey: "reject-export"
    })).rejects.toEqual(new AdminRepositoryStateConflictError(
      "Content export lifecycle is managed by the content export job"
    ));

    expect(queries.some((query) => query.includes("update data_requests"))).toBe(false);
    expect(queries.some((query) => query.includes("insert into audit_events"))).toBe(false);
    expect(queries.some((query) => query.includes("insert into mutation_command_receipts"))).toBe(false);
  });
});
