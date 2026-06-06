import postgres from "postgres";
import type {
  ContentItem,
  DiscoverRepository,
  Event,
  EventPage,
  Hashtag,
  HashtagPage,
  LiveRoom,
  LiveRoomPage,
  User
} from "./types.js";

export class DiscoverRepositoryConfigurationError extends Error {
  constructor() {
    super("DATABASE_URL_NOT_CONFIGURED");
    this.name = "DiscoverRepositoryConfigurationError";
  }
}

interface ContentRow {
  id: string;
  media_type: ContentItem["mediaType"];
  caption: string | null;
  nsfw_label: NonNullable<ContentItem["nsfwLabel"]>;
  created_at: Date;
  creator_id: string;
  handle: string | null;
  display_name: string | null;
  avatar_url: string | null;
  poster_url: string | null;
  playback_url: string | null;
  provider: "bunny" | null;
  provider_playable: boolean | null;
  access_type: string | null;
  product_type: string | null;
  entitlement_id: string | null;
  liked: boolean;
  saved: boolean;
  like_count: string | number;
  comment_count: string | number;
  share_count: string | number;
}

interface HashtagRow {
  slug: string;
  display_name: string;
  state: Hashtag["state"];
}

interface CreatorRow {
  id: string;
  handle: string | null;
  display_name: string | null;
  avatar_url: string | null;
}

interface EventRow {
  id: string;
  title: string;
  description: string | null;
  starts_at: Date;
  ends_at: Date | null;
  access_rule: Event["accessRule"];
  location_type: NonNullable<Event["location"]>["type"];
  location_label: string | null;
  location_lat: string | number | null;
  location_lng: string | number | null;
  state: Event["state"];
  ticket_types: unknown;
}

interface LiveRoomRow {
  id: string;
  title: string;
  state: LiveRoom["state"];
  creator_id: string;
  handle: string | null;
  display_name: string | null;
  avatar_url: string | null;
  playback_url: string | null;
  teaser_seconds: number;
  pass_price_minor: string | number;
  currency: "SOL";
  pass_durations_minutes: number[];
  replay_content_item_id: string | null;
  has_active_pass: boolean;
}

export function createPostgresDiscoverRepository(databaseUrl?: string): DiscoverRepository {
  if (!databaseUrl) {
    return {
      async search() {
        throw new DiscoverRepositoryConfigurationError();
      },
      async listHashtags() {
        throw new DiscoverRepositoryConfigurationError();
      },
      async getHashtag() {
        throw new DiscoverRepositoryConfigurationError();
      },
      async listCreators() {
        throw new DiscoverRepositoryConfigurationError();
      },
      async listEvents() {
        throw new DiscoverRepositoryConfigurationError();
      },
      async listLive() {
        throw new DiscoverRepositoryConfigurationError();
      }
    };
  }

  const sql = postgres(databaseUrl, {
    max: 5,
    idle_timeout: 20,
    prepare: false
  });

  return {
    async search(input) {
      const [content, creators, hashtags, events, liveRooms] = await Promise.all([
        listContent(sql, input),
        listCreators(sql, input),
        listHashtags(sql, input),
        listEvents(sql, input),
        listLive(sql, input)
      ]);

      return {
        content: content.items,
        creators: creators.items,
        hashtags: hashtags.items,
        events: events.items,
        liveRooms: liveRooms.items,
        nextCursor: content.nextCursor
      };
    },
    async listHashtags(input) {
      return listHashtags(sql, input);
    },
    async getHashtag(input) {
      const hashtagContent = await listContent(sql, input);
      const hashtags = await listHashtags(sql, { ...input, query: input.slug });

      return {
        content: hashtagContent.items,
        creators: [],
        hashtags: hashtags.items.filter((hashtag) => hashtag.slug === input.slug),
        events: [],
        liveRooms: [],
        nextCursor: hashtagContent.nextCursor
      };
    },
    async listCreators(input) {
      return listCreators(sql, input);
    },
    async listEvents(input) {
      return listEvents(sql, input);
    },
    async listLive(input) {
      return listLive(sql, input);
    },
    async close() {
      await sql.end({ timeout: 5 });
    }
  };
}

async function listContent(
  sql: postgres.Sql,
  input: {
    supabaseUserId: string;
    query?: string | undefined;
    slug?: string | undefined;
    cursor?: string | undefined;
    limit: number;
  }
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

async function listHashtags(
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

async function listCreators(
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

async function listEvents(
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
              from ticket_entitlements te
              where te.ticket_type_id = tt.id
                and te.state in ('active', 'checked_in')
            ),
            'state', tt.state
          )
        ) filter (where tt.id is not null),
        '[]'::jsonb
      ) as ticket_types
    from events e
    left join ticket_types tt on tt.event_id = e.id and tt.state = 'active'
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

async function listLive(
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

function normalizeSearch(query: string | undefined): string | null {
  const normalized = query?.trim().replace(/^#/, "").toLowerCase();

  return normalized && normalized.length > 0 ? normalized.slice(0, 80) : null;
}

function toUser(row: CreatorRow | { creator_id: string; handle: string | null; display_name: string | null; avatar_url: string | null }): User {
  return {
    id: "id" in row ? row.id : row.creator_id,
    handle: row.handle ?? "",
    displayName: row.display_name ?? "",
    avatarUrl: row.avatar_url,
    badges: []
  };
}

function toContentItem(row: ContentRow): ContentItem {
  const accessState = row.entitlement_id
    ? "unlocked"
    : row.access_type === "locked" || row.access_type === "paid" || row.product_type === "content_unlock"
      ? "locked"
      : "free";
  const playback =
    row.provider && row.provider_playable && row.playback_url && ["free", "unlocked", "subscribed"].includes(accessState)
      ? { state: "full" as const, url: row.playback_url, provider: row.provider }
      : { state: "not_ready" as const, url: null, provider: "none" as const };

  return {
    id: row.id,
    creator: toUser(row),
    mediaType: row.media_type,
    caption: row.caption,
    posterUrl: row.poster_url,
    playback,
    accessState,
    nsfwLabel: row.nsfw_label,
    engagement: {
      liked: row.liked,
      saved: row.saved,
      likeCount: Number(row.like_count),
      commentCount: Number(row.comment_count),
      shareCount: Number(row.share_count)
    }
  };
}

function toEvent(row: EventRow): Event {
  const ticketTypes = Array.isArray(row.ticket_types) ? row.ticket_types : [];
  const location: Event["location"] = {
    type: row.location_type,
    ...(row.location_label ? { label: row.location_label } : {}),
    ...(row.location_lat === null ? {} : { latitude: Number(row.location_lat) }),
    ...(row.location_lng === null ? {} : { longitude: Number(row.location_lng) })
  };

  return {
    id: row.id,
    title: row.title,
    description: row.description,
    startsAt: row.starts_at.toISOString(),
    endsAt: row.ends_at?.toISOString() ?? null,
    accessRule: row.access_rule,
    location,
    state: row.state,
    ticketTypes: ticketTypes as Event["ticketTypes"]
  };
}

function toLiveRoom(row: LiveRoomRow): LiveRoom {
  const accessState = row.has_active_pass ? "pass_active" : "pass_required";
  const allowedDurations = new Set([30, 60, 180]);

  return {
    id: row.id,
    title: row.title,
    creator: toUser({
      creator_id: row.creator_id,
      handle: row.handle,
      display_name: row.display_name,
      avatar_url: row.avatar_url
    }),
    state: row.state,
    accessState,
    playback: row.playback_url && row.has_active_pass
      ? { state: "full", url: row.playback_url, provider: "livepeer" }
      : { state: "blocked", url: null, provider: "livepeer" },
    teaserSecondsRemaining: accessState === "pass_required" ? row.teaser_seconds : 0,
    passOptions: row.pass_durations_minutes
      .filter((durationMinutes): durationMinutes is 30 | 60 | 180 => allowedDurations.has(durationMinutes))
      .map((durationMinutes) => ({
        durationMinutes,
        amountMinor: Number(row.pass_price_minor),
        currency: row.currency
      })),
    chat: {
      enabled: true,
      accessState: accessState === "pass_active" ? "allowed" : "pass_required"
    },
    replayContentId: row.replay_content_item_id
  };
}
