import type postgres from "postgres";
import type { AdminRepository } from "./types.js";
import {
  ReferralProgramRow,
  PartnerCampaignRow,
  TierWaiverRow,
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
      const rows = await sql<ReferralProgramRow[]>`
        select id, name, state, priority, commission_source, created_at
        from referral_programs
        where (${input.cursor ?? null}::timestamptz is null or created_at < ${input.cursor ?? null}::timestamptz)
        order by created_at desc
        limit ${pageSize + 1}
      `;

      return page(rows, toReferralProgram);
    },
    async listPartnerCampaigns(input) {
      const rows = await sql<PartnerCampaignRow[]>`
        select id, name, partner_name, state, contract_id, created_at
        from partner_campaigns
        where (${input.cursor ?? null}::timestamptz is null or created_at < ${input.cursor ?? null}::timestamptz)
        order by created_at desc
        limit ${pageSize + 1}
      `;

      return page(rows, toPartnerCampaign);
    },
    async listTierWaivers(input) {
      const rows = await sql<TierWaiverRow[]>`
        select id, subject_type, subject_id, tier_key, state, starts_at, ends_at
        from tier_waivers
        where (${input.cursor ?? null}::timestamptz is null or starts_at < ${input.cursor ?? null}::timestamptz)
        order by starts_at desc
        limit ${pageSize + 1}
      `;

      return page(rows, toTierWaiver);
    },
  };
}
