import type postgres from "postgres";
import type { ContentItem, EventPage, HashtagPage, LiveRoomPage, User } from "./types.js";
import type {
  ContentRow,
  CreatorRow,
  EventRow,
  HashtagRow,
  LiveRoomRow
} from "./discover-repository-rows.js";
import {
  normalizeSearch,
  toContentItem,
  toEvent,
  toLiveRoom,
  toUser
} from "./discover-repository-mappers.js";

interface DiscoverListInput {
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
    join users creator on creator.id = ci.creator_user_id
    join profiles p on p.user_id = creator.id
    left join lateral (
      select poster_url, playback_url, provider, provider_playable
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
    where ci.state = 'ready'
      and ci.visibility = 'public'
      and ci.moderation_state = 'approved'
      and (${input.cursor ?? null}::timestamptz is null or ci.created_at < ${input.cursor ?? null}::timestamptz)
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
      and not exists (
        select 1
        from viewer_hidden_creators vhc
        where vhc.user_id = (select id from viewer)
          and vhc.creator_user_id = ci.creator_user_id
      )
      and not exists (
        select 1
        from blocks b
        where (b.blocker_user_id = (select id from viewer) and b.blocked_user_id = ci.creator_user_id)
           or (b.blocker_user_id = ci.creator_user_id and b.blocked_user_id = (select id from viewer))
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

export async function listHashtags(
  sql: postgres.Sql,
  input: { query?: string | undefined; cursor?: string | undefined; limit: number }
): Promise<HashtagPage> {
  const search = normalizeSearch(input.query);
  const rows = await sql<HashtagRow[]>`
    select slug, display_name, state
    from hashtags
    where state in ('active', 'restricted')
      and (${search}::text is null or slug ilike '%' || ${search} || '%' or display_name ilike '%' || ${search} || '%')
      and (${input.cursor ?? null}::text is null or slug > ${input.cursor ?? null}::text)
    order by slug asc
    limit ${input.limit + 1}
  `;

  const pageRows = rows.slice(0, input.limit);
  const nextRow = rows[input.limit];

  return {
    items: pageRows.map((row) => ({
      slug: row.slug,
      displayName: row.display_name,
      state: row.state
    })),
    nextCursor: nextRow ? nextRow.slug : null
  };
}

export async function listCreators(
  sql: postgres.Sql,
  input: { query?: string | undefined; cursor?: string | undefined; limit: number }
): Promise<{ items: User[]; nextCursor: string | null }> {
  const search = normalizeSearch(input.query);
  const rows = await sql<CreatorRow[]>`
    select u.id, p.handle, p.display_name, p.avatar_url
    from profiles p
    join users u on u.id = p.user_id
    where u.state = 'active'
      and p.handle is not null
      and p.display_name is not null
      and (${search}::text is null or p.handle ilike '%' || ${search} || '%' or p.display_name ilike '%' || ${search} || '%')
      and (${input.cursor ?? null}::text is null or p.handle > ${input.cursor ?? null}::text)
    order by p.handle asc
    limit ${input.limit + 1}
  `;
  const pageRows = rows.slice(0, input.limit);
  const nextRow = rows[input.limit];

  return {
    items: pageRows.map(toUser),
    nextCursor: nextRow?.handle ?? null
  };
}

export async function listEvents(
  sql: postgres.Sql,
  input: { query?: string | undefined; cursor?: string | undefined; limit: number }
): Promise<EventPage> {
  const search = normalizeSearch(input.query);
  const rows = await sql<EventRow[]>`
    select
      e.id,
      e.title,
      e.description,
      e.starts_at,
      e.ends_at,
      e.access_rule,
      e.location_type,
      e.location_label,
      e.location_lat,
      e.location_lng,
      e.state,
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', tt.id,
            'label', tt.label,
            'priceMinor', tt.price_minor,
            'currency', tt.currency,
            'capacity', tt.capacity,
            'issuedCount', (
              select count(*)
              from event_access_passes te
              where te.access_pass_type_id = tt.id
                and te.state in ('active', 'checked_in')
            ),
            'state', tt.state
          )
        ) filter (where tt.id is not null),
        '[]'::jsonb
      ) as access_pass_types
    from events e
    left join event_access_pass_types tt on tt.event_id = e.id and tt.state = 'active'
    where e.state = 'published'
      and (${search}::text is null or e.title ilike '%' || ${search} || '%' or e.description ilike '%' || ${search} || '%')
      and (${input.cursor ?? null}::timestamptz is null or e.starts_at > ${input.cursor ?? null}::timestamptz)
    group by e.id
    order by e.starts_at asc
    limit ${input.limit + 1}
  `;
  const pageRows = rows.slice(0, input.limit);
  const nextRow = rows[input.limit];

  return {
    items: pageRows.map(toEvent),
    nextCursor: nextRow ? nextRow.starts_at.toISOString() : null
  };
}

export async function listLive(
  sql: postgres.Sql,
  input: { supabaseUserId: string; cursor?: string | undefined; limit: number }
): Promise<LiveRoomPage> {
  const rows = await sql<LiveRoomRow[]>`
    with viewer as (
      select id
      from users
      where supabase_user_id = ${input.supabaseUserId}
      limit 1
    )
    select
      lr.id,
      lr.title,
      lr.state,
      creator.id as creator_id,
      p.handle,
      p.display_name,
      p.avatar_url,
      lr.playback_url,
      lr.teaser_seconds,
      lr.pass_price_minor,
      lr.currency,
      lr.pass_durations_minutes,
      lr.replay_content_item_id,
      exists (
        select 1
        from live_passes lp
        where lp.room_id = lr.id
          and lp.user_id = (select id from viewer)
          and lp.state = 'active'
          and lp.expires_at > now()
      ) as has_active_pass
    from live_rooms lr
    join users creator on creator.id = lr.creator_user_id
    join profiles p on p.user_id = creator.id
    where lr.state in ('waiting', 'live', 'replay_ready')
      and (${input.cursor ?? null}::uuid is null or lr.id > ${input.cursor ?? null}::uuid)
    order by case lr.state when 'live' then 0 when 'waiting' then 1 else 2 end, lr.created_at desc
    limit ${input.limit + 1}
  `;
  const pageRows = rows.slice(0, input.limit);
  const nextRow = rows[input.limit];

  return {
    items: pageRows.map(toLiveRoom),
    nextCursor: nextRow?.id ?? null
  };
}
