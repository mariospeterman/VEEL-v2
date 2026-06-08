import type postgres from "postgres";
import { accessStateForRule, toContentItem } from "./content-repository-mappers.js";
import type { FeedRow } from "./content-repository-rows.js";
import type { ContentRepository } from "./types.js";

export function createContentFeedRepositoryMethods(
  sql: postgres.Sql
): Pick<ContentRepository, "listHomeFeed"> {
  return {
    async listHomeFeed(input) {
      const rows = await sql<FeedRow[]>`
        select
          ci.id,
          ci.media_type,
          ci.caption,
          ci.nsfw_label,
          ci.created_at,
          u.id as creator_id,
          p.handle,
          p.display_name,
          p.avatar_url,
          ma.poster_url,
          ma.playback_url,
          ma.provider,
          ma.provider_state,
          ma.provider_playable,
          car.access_type,
          car.product_type,
          eg.id as entitlement_id,
          eg.state as entitlement_state,
          eg.granted_at as entitlement_granted_at,
          eg.ends_at as entitlement_ends_at,
          exists (
            select 1
            from content_reactions cr
            where cr.content_item_id = ci.id
              and cr.user_id = viewer.id
              and cr.reaction_key = 'like'
              and cr.state = 'active'
          ) as liked,
          exists (
            select 1
            from content_saves cs
            where cs.content_item_id = ci.id
              and cs.user_id = viewer.id
              and cs.state = 'active'
          ) as saved,
          (
            select count(*)
            from content_reactions cr
            where cr.content_item_id = ci.id
              and cr.reaction_key = 'like'
              and cr.state = 'active'
          ) as like_count,
          (
            select count(*)
            from comments c
            where c.content_item_id = ci.id
              and c.moderation_state = 'visible'
          ) as comment_count,
          (
            select count(*)
            from share_records sr
            where sr.target_type = 'content'
              and sr.target_id = ci.id
              and sr.state = 'created'
          ) as share_count
        from content_items ci
        join users u on u.id = ci.creator_user_id
        join profiles p on p.user_id = u.id
        join users viewer on viewer.supabase_user_id = ${input.supabaseUserId}
        left join lateral (
          select poster_url, playback_url, provider, provider_state, provider_playable
          from media_assets
          where content_item_id = ci.id
          order by created_at asc
          limit 1
        ) ma on true
        left join lateral (
          select access_type, product_type
          from content_access_rules
          where content_item_id = ci.id
            and state = 'active'
            and (starts_at is null or starts_at <= now())
            and (ends_at is null or ends_at > now())
          order by created_at desc
          limit 1
        ) car on true
        left join lateral (
          select id, state, granted_at, ends_at
          from entitlements
          where user_id = viewer.id
            and target_type = 'content'
            and target_id = ci.id
            and product_type = 'content_unlock'
            and state = 'active'
            and starts_at <= now()
            and (ends_at is null or ends_at > now())
          order by granted_at desc
          limit 1
        ) eg on true
        where ci.state = 'ready'
          and ci.publish_state = 'published'
          and ci.visibility = 'public'
          and ci.moderation_state = 'approved'
          and (${input.mode} != 'sfw' or ci.nsfw_label = 'none')
          and (${input.mode} != 'nsfw' or ci.nsfw_label in ('adult', 'explicit'))
          and (${input.cursor ?? null}::timestamptz is null or ci.created_at < ${input.cursor ?? null}::timestamptz)
          and not exists (
            select 1
            from viewer_hidden_creators vhc
            where vhc.user_id = viewer.id
              and vhc.creator_user_id = ci.creator_user_id
          )
          and not exists (
            select 1
            from blocks b
            where (b.blocker_user_id = viewer.id and b.blocked_user_id = ci.creator_user_id)
               or (b.blocker_user_id = ci.creator_user_id and b.blocked_user_id = viewer.id)
          )
        order by ci.created_at desc
        limit ${input.limit + 1}
      `;

      const pageRows = rows.slice(0, input.limit);
      const nextRow = rows[input.limit];

      return {
        items: pageRows.map((row) => toContentItem(row, row.poster_url, accessStateForRule(row))),
        nextCursor: nextRow ? nextRow.created_at.toISOString() : null
      };
    }
  };
}
