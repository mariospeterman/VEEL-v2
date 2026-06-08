import type postgres from "postgres";
import { ContentPublishConflictError } from "./content-errors.js";
import { toContentItem } from "./content-repository-mappers.js";
import type { ContentRow } from "./content-repository-rows.js";
import type { ContentRepository } from "./types.js";

export function createContentPublishRepositoryMethods(
  sql: postgres.Sql
): Pick<ContentRepository, "publishOwnedContent"> {
  return {
    async publishOwnedContent(input) {
      const result = await sql.begin(async (transaction) => {
        const rows = await transaction<
          (ContentRow & {
            content_state: string;
            publish_state: string;
            moderation_state: string;
            provider_ready: boolean;
          })[]
        >`
          with actor as (
            select id
            from users
            where supabase_user_id = ${input.supabaseUserId}
            limit 1
          ),
          current_content as (
            select
              ci.id,
              ci.creator_user_id,
              ci.state,
              ci.publish_state,
              ci.moderation_state,
              exists (
                select 1
                from media_assets ma
                where ma.content_item_id = ci.id
                  and ma.provider_playable = true
                  and ma.ready_at is not null
              ) as provider_ready
            from content_items ci
            join actor on actor.id = ci.creator_user_id
            where ci.id = ${input.contentId}
            for update
          ),
          updated_content as (
            update content_items ci
            set
              publish_state = case
                when cc.moderation_state = 'approved' then 'published'
                else 'submitted_for_review'
              end,
              publish_requested_at = coalesce(ci.publish_requested_at, now()),
              published_at = case
                when cc.moderation_state = 'approved' then coalesce(ci.published_at, now())
                else ci.published_at
              end,
              updated_at = now()
            from current_content cc
            where ci.id = cc.id
              and cc.state = 'ready'
              and cc.provider_ready = true
              and cc.publish_state in ('draft', 'unpublished', 'submitted_for_review')
              and cc.moderation_state <> 'blocked'
            returning
              ci.id,
              ci.creator_user_id,
              ci.media_type,
              ci.caption,
              ci.nsfw_label,
              ci.state as content_state,
              ci.publish_state,
              ci.moderation_state,
              cc.provider_ready
          ),
          audit_insert as (
            insert into audit_events (
              id,
              actor_user_id,
              subject_type,
              subject_id,
              action,
              metadata
            )
            select
              gen_random_uuid(),
              actor.id,
              'content',
              updated_content.id,
              'content_publish_submitted',
              jsonb_build_object(
                'idempotencyKey', ${input.idempotencyKey},
                'publishState', updated_content.publish_state,
                'moderationState', updated_content.moderation_state
              )
            from updated_content
            cross join actor
            returning id
          )
          select
            updated_content.id,
            updated_content.media_type,
            updated_content.caption,
            updated_content.nsfw_label,
            updated_content.content_state,
            updated_content.publish_state,
            updated_content.moderation_state,
            updated_content.provider_ready,
            u.id as creator_id,
            p.handle,
            p.display_name,
            p.avatar_url
          from updated_content
          join users u on u.id = updated_content.creator_user_id
          left join profiles p on p.user_id = u.id
          where exists (select 1 from audit_insert)
          limit 1
        `;

        const row = rows[0];
        if (row) {
          return toContentItem(row, null);
        }

        const currentRows = await transaction<
          { state: string; publish_state: string; moderation_state: string; provider_ready: boolean }[]
        >`
          select
            ci.state,
            ci.publish_state,
            ci.moderation_state,
            exists (
              select 1
              from media_assets ma
              where ma.content_item_id = ci.id
                and ma.provider_playable = true
                and ma.ready_at is not null
            ) as provider_ready
          from content_items ci
          join users u on u.id = ci.creator_user_id
          where ci.id = ${input.contentId}
            and u.supabase_user_id = ${input.supabaseUserId}
          limit 1
        `;
        const current = currentRows[0];

        if (!current) {
          return null;
        }

        if (current.moderation_state === "blocked" || current.publish_state === "blocked") {
          throw new ContentPublishConflictError("blocked");
        }

        throw new ContentPublishConflictError("provider_not_ready");
      });

      return result;
    }
  };
}
