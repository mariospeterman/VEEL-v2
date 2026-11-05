import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { PostgresTransaction } from "../src/shared/postgres";
import { createPostgresClient } from "../src/shared/postgres";
import { guardedIntegrationDatabaseUrl } from "./integration-database.js";

const enabled = ["1", "true"].includes(
  process.env.VEEL_ENABLE_REAL_API_INTEGRATION_TESTS ?? ""
);
const describeIntegration = enabled ? describe : describe.skip;

const permissionScopedFinanceTables = [
  "refunds_and_disputes",
  "refund_remediation_evidence",
  "organization_settlement_wallets",
  "managed_creator_relationships",
  "managed_creator_agreements",
  "managed_creator_allocation_records"
] as const;

const serverOwnedTables = [
  "identity_verifications",
  "tax_profiles",
  "tax_profile_versions",
  "seller_of_record_determinations",
  "jurisdiction_tax_rules",
  "product_tax_matrix",
  "buyer_location_evidence",
  "vat_determinations",
  "receipts",
  "receipt_lines",
  "platform_fee_statements",
  "vat_invoices",
  "vat_invoice_lines",
  "tax_adjustments",
  "compliance_ledger_entries",
  "dac7_reports",
  "dac7_report_lines",
  "carf_reports",
  "carf_report_lines",
  "compliance_review_queue",
  "compliance_exports",
  "referral_programs",
  "partner_campaigns",
  "partner_contracts",
  "referral_abuse_flags",
  "tier_waivers",
  "organizations",
  ...permissionScopedFinanceTables,
  "user_social_counts",
  "content_engagement_counters",
  "comments",
  "content_items",
  "media_assets",
  "content_access_rules",
  "content_hashtags",
  "media_safety_cases",
  "comment_reactions",
  "comment_mentions"
] as const;

describeIntegration("server-owned Data API authority", () => {
  it("removes effective browser-role privileges and leaves backend reads available", async () => {
    const sql = createPostgresClient(guardedIntegrationDatabaseUrl());
    const staffUserId = randomUUID();
    const staffMembershipId = randomUUID();

    try {
      const privileges = await sql<
        Array<{
          anon_select: boolean;
          authenticated_select: boolean;
          backend_select: boolean;
          table_name: string;
        }>
      >`
        select
          table_name,
          has_table_privilege('anon', format('public.%I', table_name), 'select') as anon_select,
          has_table_privilege(
            'authenticated', format('public.%I', table_name), 'select'
          ) as authenticated_select,
          has_table_privilege(
            current_user, format('public.%I', table_name), 'select'
          ) as backend_select
        from unnest(${serverOwnedTables}::text[]) as table_name
        order by table_name
      `;
      expect(privileges).toHaveLength(serverOwnedTables.length);
      expect(privileges.every((row) => !row.anon_select && !row.authenticated_select)).toBe(true);
      expect(privileges.every((row) => row.backend_select)).toBe(true);

      const backendProbe = await sql<{ count: number }[]>`
        select count(*)::integer as count from content_items
      `;
      expect(backendProbe[0]?.count).toBeGreaterThanOrEqual(0);

      await sql`
        insert into users (id, supabase_user_id, state)
        values (${staffUserId}, ${staffUserId}, 'active')
      `;
      await sql`
        insert into staff_memberships (id, user_id, role, state, granted_by_user_id)
        values (${staffMembershipId}, ${staffUserId}, 'ai_ops', 'active', ${staffUserId})
      `;

      for (const table of permissionScopedFinanceTables) {
        await expect(
          sql.begin(async (transaction) => {
            await assumeBrowserRole(transaction, "authenticated", staffUserId);
            await transaction.unsafe(`select 1 from public.${table} limit 1`);
          })
        ).rejects.toMatchObject({ code: "42501" });
      }
      await expect(
        sql.begin(async (transaction) => {
          await assumeBrowserRole(transaction, "authenticated", staffUserId);
          await transaction`select id from identity_verifications limit 1`;
        })
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        sql.begin(async (transaction) => {
          await assumeBrowserRole(transaction, "anon");
          await transaction`select content_item_id from content_engagement_counters limit 1`;
        })
      ).rejects.toMatchObject({ code: "42501" });
    } finally {
      await sql`delete from staff_memberships where id = ${staffMembershipId}`;
      await sql`delete from users where id = ${staffUserId}`;
      await sql.end({ timeout: 5 });
    }
  });
});

async function assumeBrowserRole(
  transaction: PostgresTransaction,
  role: "anon" | "authenticated",
  subject?: string
): Promise<void> {
  await transaction.unsafe(`set local role ${role}`);
  if (subject) {
    await transaction`select set_config('request.jwt.claim.sub', ${subject}, true)`;
  }
}
