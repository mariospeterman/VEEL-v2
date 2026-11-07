import type postgres from "postgres";
import { bindCursorScope } from "../../shared/keyset-pagination.js";
import type { AdminRepository } from "./types.js";
import {
  ReferralProgramRow,
  PartnerCampaignRow,
  TierWaiverRow,
  decodeTimestampIdCursor,
  encodeTimestampIdCursor,
  pageSize,
  page,
  toReferralProgram,
  toPartnerCampaign,
  toTierWaiver
} from "./admin-repository-mappers.js";

export function createGrowthRepository(
  sql: postgres.Sql
): Pick<AdminRepository, "listReferralPrograms" | "listPartnerCampaigns" | "listTierWaivers"> {
  return {
    async listReferralPrograms(input) {
      const cursorScope = bindCursorScope("GET /v1/admin/referrals/programs", {
        sort: "created_at:desc,id:desc"
      });
      const cursor = decodeTimestampIdCursor(cursorScope, input.cursor);
      const rows = await sql<ReferralProgramRow[]>`
        select id, name, state, priority, commission_source, created_at
        from referral_programs
        where (
          ${cursor.timestamp}::timestamptz is null
          or created_at < ${cursor.timestamp}::timestamptz
          or (
            created_at = ${cursor.timestamp}::timestamptz
            and (${cursor.id}::uuid is null or id < ${cursor.id}::uuid)
          )
        )
        order by created_at desc, id desc
        limit ${pageSize + 1}
      `;

      return page(rows, toReferralProgram, (row) =>
        encodeTimestampIdCursor(cursorScope, row.created_at, row.id)
      );
    },
    async listPartnerCampaigns(input) {
      const cursorScope = bindCursorScope("GET /v1/admin/referrals/partner-campaigns", {
        sort: "created_at:desc,id:desc"
      });
      const cursor = decodeTimestampIdCursor(cursorScope, input.cursor);
      const rows = await sql<PartnerCampaignRow[]>`
        select id, name, partner_name, state, contract_id, created_at
        from partner_campaigns
        where (
          ${cursor.timestamp}::timestamptz is null
          or created_at < ${cursor.timestamp}::timestamptz
          or (
            created_at = ${cursor.timestamp}::timestamptz
            and (${cursor.id}::uuid is null or id < ${cursor.id}::uuid)
          )
        )
        order by created_at desc, id desc
        limit ${pageSize + 1}
      `;

      return page(rows, toPartnerCampaign, (row) =>
        encodeTimestampIdCursor(cursorScope, row.created_at, row.id)
      );
    },
    async listTierWaivers(input) {
      const cursorScope = bindCursorScope("GET /v1/admin/tier-waivers", {
        sort: "starts_at:desc,id:desc"
      });
      const cursor = decodeTimestampIdCursor(cursorScope, input.cursor);
      const rows = await sql<TierWaiverRow[]>`
        select id, subject_type, subject_id, tier_key, state, starts_at, ends_at
        from tier_waivers
        where (
          ${cursor.timestamp}::timestamptz is null
          or starts_at < ${cursor.timestamp}::timestamptz
          or (
            starts_at = ${cursor.timestamp}::timestamptz
            and (${cursor.id}::uuid is null or id < ${cursor.id}::uuid)
          )
        )
        order by starts_at desc, id desc
        limit ${pageSize + 1}
      `;

      return page(rows, toTierWaiver, (row) =>
        encodeTimestampIdCursor(cursorScope, row.starts_at, row.id)
      );
    },
  };
}
