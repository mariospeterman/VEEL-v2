import type postgres from "postgres";
import type { ContentItem } from "./types.js";
import type { ContentRow } from "./discover-repository-rows.js";
import { normalizeSearch, toContentItem } from "./discover-repository-mappers.js";

export interface DiscoverListInput {
  supabaseUserId: string;
  query?: string | undefined;
  slug?: string | undefined;
  cursor?: string | undefined;
  limit: number;
}

export async function listContent(
  sql: postgres.Sql,
  input: DiscoverListInput
): Promise<{ items: ContentItem[]; nextCursor: string | null }> {
  const search = normalizeSearch(input.query);
  const rows = await sql<ContentRow[]>`
    with viewer as (
      select id
      from users
      where supabase_user_id = ${input.supabaseUserId}
      limit 1
    )
    select
      ci.id,
      ci.media_type,
      ci.distribution_mode,
      ci.expires_at,
      ci.scheduled_for,
      ci.caption,
      ci.nsfw_label,
      ci.created_at,
      creator.id as creator_id,
      p.handle,
      p.display_name,
      p.avatar_url,
      ma.poster_url,
      ma.playback_url,
      ma.provider,
      ma.provider_playable,
      car.access_type,
      car.product_type,
      eg.id as entitlement_id,
      exists (
        select 1
        from content_reactions cr
        where cr.content_item_id = ci.id
          and cr.user_id = (select id from viewer)
          and cr.reaction_key = 'like'
          and cr.state = 'active'
      ) as liked,
      exists (
        select 1
        from content_saves cs
        where cs.content_item_id = ci.id
          and cs.user_id = (select id from viewer)
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
    join viewer on true
    join private.eligible_content(viewer.id, null) eligible
      on eligible.content_item_id = ci.id
    join users creator on creator.id = ci.creator_user_id
    join profiles p on p.user_id = creator.id
    left join lateral (
      select poster_url, playback_url, provider, provider_playable
      from media_assets
      where id = ci.release_media_asset_id
        and content_item_id = ci.id
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
      select id
      from entitlements
      where user_id = (select id from viewer)
        and target_type = 'content'
        and target_id = ci.id
        and product_type = 'content_unlock'
        and state = 'active'
        and starts_at <= now()
        and (ends_at is null or ends_at > now())
      limit 1
    ) eg on true
    where (${input.cursor ?? null}::timestamptz is null or ci.created_at < ${input.cursor ?? null}::timestamptz)
      and (
        ${search}::text is null
        or ci.caption ilike '%' || ${search} || '%'
        or p.handle ilike '%' || ${search} || '%'
        or exists (
          select 1
          from content_hashtags ch
          join hashtags h on h.id = ch.hashtag_id
          where ch.content_item_id = ci.id
            and h.state in ('active', 'restricted')
            and h.slug ilike '%' || ${search} || '%'
        )
      )
      and (
        ${input.slug ?? null}::text is null
        or exists (
          select 1
          from content_hashtags ch
          join hashtags h on h.id = ch.hashtag_id
          where ch.content_item_id = ci.id
            and h.slug = ${input.slug ?? null}
            and h.state in ('active', 'restricted')
        )
      )
    order by ci.created_at desc
    limit ${input.limit + 1}
  `;

  const pageRows = rows.slice(0, input.limit);
  const nextRow = rows[input.limit];

  return {
    items: pageRows.map(toContentItem),
    nextCursor: nextRow ? nextRow.created_at.toISOString() : null
  };
}
