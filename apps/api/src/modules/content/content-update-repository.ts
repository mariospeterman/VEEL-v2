import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import { extractHashtagSlugs, toContentItem } from "./content-repository-mappers.js";
import type { ContentRow } from "./content-repository-rows.js";
import type { ContentRepository } from "./types.js";

export function createContentUpdateRepositoryMethods(
  sql: postgres.Sql
): Pick<ContentRepository, "updateOwnedContent"> {
  return {
    async updateOwnedContent(input) {
      const result = await sql.begin(async (transaction) => {
        const rows = await transaction<ContentRow[]>`
          with actor as (
            select id
            from users
            where supabase_user_id = ${input.supabaseUserId}
            limit 1
          ),
          updated_content as (
            update content_items ci
            set
              caption = case when ${input.captionProvided} then ${input.caption ?? null} else ci.caption end,
              visibility = case when ${Boolean(input.visibility)} then ${input.visibility ?? ""} else ci.visibility end,
              nsfw_label = case when ${Boolean(input.nsfwLabel)} then ${input.nsfwLabel ?? ""} else ci.nsfw_label end,
              updated_at = now()
            from actor
            where ci.id = ${input.contentId}
              and ci.creator_user_id = actor.id
              and ci.state <> 'deleted'
            returning ci.id, ci.creator_user_id, ci.media_type, ci.caption, ci.nsfw_label
          ),
          updated_media as (
            update media_assets ma
            set
              teaser_start_ms = case
                when ${input.teaserStartMsProvided} then ${input.teaserStartMs ?? null}
                else ma.teaser_start_ms
              end,
              teaser_end_ms = case
                when ${input.teaserEndMsProvided} then ${input.teaserEndMs ?? null}
                else ma.teaser_end_ms
              end,
              thumbnail_frame_ms = case
                when ${input.thumbnailFrameMsProvided} then ${input.thumbnailFrameMs ?? null}
                else ma.thumbnail_frame_ms
              end
            where ma.content_item_id = (select id from updated_content)
            returning ma.id
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
          from updated_content ci
          join users u on u.id = ci.creator_user_id
          left join profiles p on p.user_id = u.id
          limit 1
        `;

        const row = rows[0];

        if (!row) {
          return null;
        }

        if (input.captionProvided) {
          await replaceCaptionHashtags(transaction, row.id, input.caption);
        }

        return toContentItem(row, null);
      });

      return result;
    }
  };
}

async function replaceCaptionHashtags(
  transaction: postgres.TransactionSql,
  contentId: string,
  caption: string | null | undefined
): Promise<void> {
  await transaction`
    delete from content_hashtags
    where content_item_id = ${contentId}
      and source = 'caption'
  `;

  const hashtags = extractHashtagSlugs(caption);
  for (const slug of hashtags) {
    const displayName = `#${slug}`;
    await transaction`
      insert into hashtags (id, slug, display_name)
      values (${randomUUID()}, ${slug}, ${displayName})
      on conflict (slug) do nothing
    `;
    await transaction`
      insert into content_hashtags (content_item_id, hashtag_id, source)
      select ${contentId}, id, 'caption'
      from hashtags
      where slug = ${slug}
      on conflict (content_item_id, hashtag_id) do nothing
    `;
  }
}
