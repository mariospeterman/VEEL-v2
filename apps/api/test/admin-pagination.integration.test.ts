import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createModerationRepository } from "../src/modules/admin/admin-repository-moderation.js";
import { createSupportRepository } from "../src/modules/admin/admin-repository-support.js";
import { createPostgresClient } from "../src/shared/postgres.js";
import { guardedIntegrationDatabaseUrl } from "./integration-database.js";

const enabled = ["1", "true"].includes(process.env.VEEL_ENABLE_REAL_API_INTEGRATION_TESTS ?? "");
const describeIntegration = enabled ? describe : describe.skip;

describeIntegration("admin compound pagination against migrated Postgres", () => {
  it("walks priority transitions, timestamp ties, and updated-at policy pages exactly once", async () => {
    const sql = createPostgresClient(guardedIntegrationDatabaseUrl());
    const moderationRepository = createModerationRepository(sql);
    const supportRepository = createSupportRepository(sql);
    const reporterUserId = randomUUID();
    const suffix = reporterUserId.replaceAll("-", "").slice(0, 12);
    const reportRows = Array.from({ length: 121 }, (_, index) => ({
      id: randomUUID(),
      reporter_user_id: reporterUserId,
      subject_type: "content",
      subject_id: randomUUID(),
      reason: `Pagination regression ${index}`,
      queue: "content",
      state: index < 55 ? "submitted" : "resolved",
      idempotency_key: `admin-pagination-${suffix}-${index}`,
      created_at: new Date(Date.UTC(2026, 9, 1, 12, 0, 20 - Math.floor(index / 7)))
    }));
    const organizations = Array.from({ length: 61 }, (_, index) => ({
      id: randomUUID(),
      name: `Pagination organization ${suffix} ${index}`
    }));
    const policyRows = organizations.map((organization, index) => ({
      id: randomUUID(),
      organization_id: organization.id,
      support_state: "standard",
      sla_tier: "standard",
      state: "active",
      policy_reason: `Pagination policy ${index}`,
      created_at: new Date(Date.UTC(2024, 0, 1, 0, 0, index)),
      updated_at: new Date(Date.UTC(2026, 10, 1, 9, 0, 15 - Math.floor(index / 5)))
    }));

    try {
      await sql`
        insert into users (id, supabase_user_id, state)
        values (${reporterUserId}::uuid, ${reporterUserId}::uuid, 'active')
      `;
      await sql`
        insert into reports ${sql(
          reportRows,
          "id",
          "reporter_user_id",
          "subject_type",
          "subject_id",
          "reason",
          "queue",
          "state",
          "idempotency_key",
          "created_at"
        )}
      `;
      await sql`insert into organizations ${sql(organizations, "id", "name")}`;
      await sql`
        insert into organization_support_policies ${sql(
          policyRows,
          "id",
          "organization_id",
          "support_state",
          "sla_tier",
          "state",
          "policy_reason",
          "created_at",
          "updated_at"
        )}
      `;

      const reportPages: Array<Array<{ id: string; state: string }>> = [];
      let reportCursor: string | undefined;
      do {
        const result = await moderationRepository.listReports(
          reportCursor ? { cursor: reportCursor } : {}
        );
        reportPages.push(result.items.map((item) => ({ id: item.id, state: item.state })));
        reportCursor = result.nextCursor ?? undefined;
      } while (reportCursor);

      const expectedReportIds = [...reportRows]
        .sort((left, right) =>
          reportPriority(left.state) - reportPriority(right.state) ||
          right.created_at.getTime() - left.created_at.getTime() ||
          right.id.localeCompare(left.id)
        )
        .map((row) => row.id);
      const actualReportIds = reportPages.flat().map((row) => row.id);

      expect(reportPages.map((items) => items.length)).toEqual([50, 50, 21]);
      expect(reportPages[0]!.every((row) => row.state === "submitted")).toBe(true);
      expect(reportPages[1]!.filter((row) => row.state === "submitted")).toHaveLength(5);
      expect(reportPages[1]!.filter((row) => row.state === "resolved")).toHaveLength(45);
      expect(actualReportIds).toEqual(expectedReportIds);
      expect(new Set(actualReportIds)).toHaveLength(reportRows.length);

      const policyPages: Array<Array<{ id: string; createdAt: string; updatedAt: string }>> = [];
      let policyCursor: string | undefined;
      do {
        const result = await supportRepository.listSupportPolicies(
          policyCursor ? { cursor: policyCursor } : {}
        );
        policyPages.push(result.items.map((item) => ({
          id: item.id,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt
        })));
        policyCursor = result.nextCursor ?? undefined;
      } while (policyCursor);

      const expectedPolicyIds = [...policyRows]
        .sort((left, right) =>
          right.updated_at.getTime() - left.updated_at.getTime() ||
          right.id.localeCompare(left.id)
        )
        .map((row) => row.id);
      const actualPolicies = policyPages.flat();

      expect(policyPages.map((items) => items.length)).toEqual([50, 11]);
      expect(actualPolicies.map((row) => row.id)).toEqual(expectedPolicyIds);
      expect(new Set(actualPolicies.map((row) => row.id))).toHaveLength(policyRows.length);
      expect(actualPolicies.every((row) => row.createdAt !== row.updatedAt)).toBe(true);
    } finally {
      await sql`
        delete from organization_support_policies
        where organization_id in ${sql(organizations.map((organization) => organization.id))}
      `;
      await sql`
        delete from organizations
        where id in ${sql(organizations.map((organization) => organization.id))}
      `;
      await sql`delete from reports where reporter_user_id = ${reporterUserId}::uuid`;
      await sql`delete from users where id = ${reporterUserId}::uuid`;
      await sql.end({ timeout: 5 });
    }
  });
});

function reportPriority(state: string): number {
  return ["submitted", "queued", "reviewing", "escalated"].includes(state) ? 0 : 1;
}
