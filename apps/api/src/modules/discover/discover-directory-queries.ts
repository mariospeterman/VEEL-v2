import type postgres from "postgres";
import { keysetPage } from "../../shared/keyset-pagination.js";
import { toLiveRoom } from "../live/live-repository-mappers.js";
import type { LiveRoomRow } from "../live/live-repository-rows.js";
import { liveRoomSelectSql } from "../live/live-repository-sql.js";
import {
  decodeCreatorCursor,
  decodeEventCursor,
  decodeHashtagCursor,
  decodeLiveCursor,
  encodeCreatorCursor,
  encodeEventCursor,
  encodeHashtagCursor,
  encodeLiveCursor
} from "./discover-cursor.js";
import type {
  CreatorRow,
  EventRow,
  HashtagRow
} from "./discover-repository-rows.js";
import { normalizeSearch, toEvent, toUser } from "./discover-repository-mappers.js";
import type {
  DiscoverLiveRoomPage,
  EventPage,
  HashtagPage,
  User
} from "./types.js";

export async function listHashtags(
  sql: postgres.Sql,
  input: { query?: string | undefined; cursor?: string | undefined; limit: number }
): Promise<HashtagPage> {
  const search = normalizeSearch(input.query);
  const cursor = decodeHashtagCursor(input.cursor);
  const rows = await sql<HashtagRow[]>`
    select slug, display_name, state
    from hashtags
    where state in ('active', 'restricted')
      and (${search}::text is null or slug ilike '%' || ${search} || '%' or display_name ilike '%' || ${search} || '%')
      and (${cursor?.slug ?? null}::text is null or slug > ${cursor?.slug ?? null}::text)
    order by slug asc
    limit ${input.limit + 1}
  `;

  return keysetPage(
    rows,
    input.limit,
    (row) => ({
      slug: row.slug,
      displayName: row.display_name,
      state: row.state
    }),
    (row) => encodeHashtagCursor(row.slug)
  );
}

export async function listCreators(
  sql: postgres.Sql,
  input: { query?: string | undefined; cursor?: string | undefined; limit: number }
): Promise<{ items: User[]; nextCursor: string | null }> {
  const search = normalizeSearch(input.query);
  const cursor = decodeCreatorCursor(input.cursor);
  const rows = await sql<CreatorRow[]>`
    select u.id, p.handle, p.display_name, p.avatar_url
    from profiles p
    join users u on u.id = p.user_id
    where u.state = 'active'
      and p.visibility = 'public'
      and p.handle is not null
      and p.display_name is not null
      and (${search}::text is null or p.handle ilike '%' || ${search} || '%' or p.display_name ilike '%' || ${search} || '%')
      and (
        ${cursor?.handle ?? null}::text is null
        or (p.handle, u.id) > (${cursor?.handle ?? null}::text, ${cursor?.id ?? null}::uuid)
      )
    order by p.handle asc, u.id asc
    limit ${input.limit + 1}
  `;
  return keysetPage(rows, input.limit, toUser, (row) =>
    encodeCreatorCursor(row.handle!, row.id)
  );
}

export async function listEvents(
  sql: postgres.Sql,
  input: { query?: string | undefined; cursor?: string | undefined; limit: number }
): Promise<EventPage> {
  const search = normalizeSearch(input.query);
  const cursor = decodeEventCursor(input.cursor);
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
      and (
        ${cursor?.startsAt ?? null}::timestamptz is null
        or (e.starts_at, e.id) > (
          ${cursor?.startsAt ?? null}::timestamptz,
          ${cursor?.id ?? null}::uuid
        )
      )
    group by e.id
    order by e.starts_at asc, e.id asc
    limit ${input.limit + 1}
  `;
  return keysetPage(rows, input.limit, toEvent, (row) =>
    encodeEventCursor(row.starts_at, row.id)
  );
}

type DiscoverLiveRoomRow = LiveRoomRow & {
  created_at: Date;
};

export async function listLive(
  sql: postgres.Sql,
  input: { supabaseUserId: string; cursor?: string | undefined; limit: number }
): Promise<DiscoverLiveRoomPage> {
  const cursor = decodeLiveCursor(input.cursor);
  const rows = await sql<DiscoverLiveRoomRow[]>`
    with target_user as (
      select id
      from users
      where supabase_user_id = ${input.supabaseUserId}
      limit 1
    ),
    canonical_rooms as (
      ${liveRoomSelectSql(sql)}
      where lr.state in ('waiting', 'live', 'replay_ready')
        and exists (
          select 1 from users active_creator
          where active_creator.id = lr.creator_user_id
            and active_creator.state = 'active'
        )
    )
    select *
    from canonical_rooms
    where canonical_rooms.live_safety_state = 'approved'
      and canonical_rooms.live_provider_release_allowed is true
      and (
        canonical_rooms.state in ('waiting', 'live')
        or (
          canonical_rooms.state = 'replay_ready'
          and canonical_rooms.replay_release_allowed is true
        )
      )
      and (
        ${cursor?.createdAt ?? null}::timestamptz is null
        or (canonical_rooms.created_at, canonical_rooms.id) < (
          ${cursor?.createdAt ?? null}::timestamptz,
          ${cursor?.id ?? null}::uuid
        )
      )
    order by canonical_rooms.created_at desc, canonical_rooms.id desc
    limit ${input.limit + 1}
  `;
  return keysetPage(rows, input.limit, toLiveRoom, (row) =>
    encodeLiveCursor(row.created_at, row.id)
  );
}
