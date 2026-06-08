import type postgres from "postgres";
import type { ContentRepository } from "./types.js";

type ContentQuotaRepositoryMethods = Pick<
  ContentRepository,
  "countContentDraftsCreatedSince" | "countMediaAssetsCreatedSince"
>;

export function createContentQuotaRepositoryMethods(
  sql: postgres.Sql
): ContentQuotaRepositoryMethods {
  return {
    async countContentDraftsCreatedSince(input) {
      const rows = await sql<{ count: number }[]>`
        select count(*)::int as count
        from content_items ci
        join users u on u.id = ci.creator_user_id
        where u.supabase_user_id = ${input.supabaseUserId}
          and ci.created_at >= ${input.since}
      `;

      return rows[0]?.count ?? 0;
    },
    async countMediaAssetsCreatedSince(input) {
      const rows = await sql<{ count: number }[]>`
        select count(*)::int as count
        from media_assets ma
        join content_items ci on ci.id = ma.content_item_id
        join users u on u.id = ci.creator_user_id
        where u.supabase_user_id = ${input.supabaseUserId}
          and ma.created_at >= ${input.since}
      `;

      return rows[0]?.count ?? 0;
    }
  };
}
