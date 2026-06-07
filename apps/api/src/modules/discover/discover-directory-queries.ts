import type postgres from "postgres";
import type { EventPage, HashtagPage, LiveRoomPage, User } from "./types.js";
import type {
  CreatorRow,
  EventRow,
  HashtagRow,
  LiveRoomRow
} from "./discover-repository-rows.js";
import { normalizeSearch, toEvent, toLiveRoom, toUser } from "./discover-repository-mappers.js";

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
