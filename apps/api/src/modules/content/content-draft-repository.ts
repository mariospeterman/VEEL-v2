import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import { ContentRepositoryConfigurationError } from "./content-errors.js";
import { extractHashtagSlugs, toContentItem } from "./content-repository-mappers.js";
import type { ContentRow } from "./content-repository-rows.js";
import type { ContentRepository } from "./types.js";

export function createContentDraftRepositoryMethods(
  sql: postgres.Sql
): Pick<ContentRepository, "createDraft"> {
  return {
    async createDraft(input) {
      const rows = await sql<ContentRow[]>`
        with target_user as (
          select id
          from users
          where supabase_user_id = ${input.supabaseUserId}
          limit 1
        ),
        inserted_content as (
          insert into content_items (
            id,
            creator_user_id,
            media_type,
            caption,
            visibility,
            nsfw_label
          )
          select
            ${randomUUID()},
            id,
            ${input.mediaType},
            ${input.caption ?? null},
            ${input.visibility},
            ${input.nsfwLabel}
          from target_user
          returning id, creator_user_id, media_type, caption, nsfw_label
        )
        select
          ci.id,
          ci.media_type,
          ci.caption,
          ci.nsfw_label,
          u.id as creator_id,
          p.handle,
          p.display_name,
          p.avatar_url
        from inserted_content ci
        join users u on u.id = ci.creator_user_id
        left join profiles p on p.user_id = u.id
        limit 1
      `;

      const row = rows[0];

      if (!row) {
        throw new ContentRepositoryConfigurationError();
      }

      const hashtags = extractHashtagSlugs(input.caption);
      if (hashtags.length > 0) {
        await sql.begin(async (transaction) => {
          for (const slug of hashtags) {
            const displayName = `#${slug}`;
            await transaction`
              insert into hashtags (id, slug, display_name)
              values (${randomUUID()}, ${slug}, ${displayName})
              on conflict (slug) do nothing
            `;
            await transaction`
              insert into content_hashtags (content_item_id, hashtag_id, source)
              select ${row.id}, id, 'caption'
              from hashtags
              where slug = ${slug}
              on conflict (content_item_id, hashtag_id) do nothing
            `;
          }
        });
      }

      return toContentItem(row, null);
    }
  };
}
