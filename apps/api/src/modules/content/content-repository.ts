import { randomUUID } from "node:crypto";
import postgres from "postgres";
import type { ContentItem, ContentRepository, Entitlement } from "./types.js";

export class ContentRepositoryConfigurationError extends Error {
  constructor() {
    super("DATABASE_URL_NOT_CONFIGURED");
    this.name = "ContentRepositoryConfigurationError";
  }
}

interface FeedRow {
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
  provider_state: string | null;
  provider_playable: boolean | null;
  access_type: string | null;
  product_type: string | null;
  entitlement_id: string | null;
  entitlement_state: Entitlement["state"] | null;
  entitlement_granted_at: Date | null;
  entitlement_ends_at: Date | null;
  liked: boolean;
  saved: boolean;
  like_count: string | number;
  comment_count: string | number;
  share_count: string | number;
}

interface ContentRow {
  id: string;
  media_type: ContentItem["mediaType"];
  caption: string | null;
  nsfw_label: NonNullable<ContentItem["nsfwLabel"]>;
  creator_id: string;
  handle: string | null;
  display_name: string | null;
  avatar_url: string | null;
  liked?: boolean;
  saved?: boolean;
  like_count?: string | number;
  comment_count?: string | number;
  share_count?: string | number;
}

interface ContentDetailRow extends ContentRow {
  poster_url: string | null;
  playback_url: string | null;
  provider: "bunny" | null;
  provider_state: string | null;
  provider_playable: boolean | null;
  access_type: string | null;
  product_type: string | null;
  entitlement_id: string | null;
  entitlement_state: Entitlement["state"] | null;
  entitlement_granted_at: Date | null;
  entitlement_ends_at: Date | null;
}

interface ContentUnlockOfferRow {
  content_id: string;
  price_minor: number;
  currency: "SOL";
  entitlement_id: string | null;
  entitlement_state: Entitlement["state"] | null;
  entitlement_granted_at: Date | null;
  entitlement_ends_at: Date | null;
  is_creator: boolean;
}

export function createPostgresContentRepository(databaseUrl?: string): ContentRepository {
  if (!databaseUrl) {
    return {
      async createDraft() {
        throw new ContentRepositoryConfigurationError();
      },
      async createMediaAsset() {
        throw new ContentRepositoryConfigurationError();
      },
      async findContentDetail() {
        throw new ContentRepositoryConfigurationError();
      },
      async findContentUnlockOffer() {
        throw new ContentRepositoryConfigurationError();
      },
      async findOwnedMediaAssetForSync() {
        throw new ContentRepositoryConfigurationError();
      },
      async findOwnedContentForUpload() {
        throw new ContentRepositoryConfigurationError();
      },
      async listHomeFeed() {
        throw new ContentRepositoryConfigurationError();
      },
      async updateMediaAssetPlayback() {
        throw new ContentRepositoryConfigurationError();
      }
    };
  }

  const sql = postgres(databaseUrl, {
    max: 5,
    idle_timeout: 20,
    prepare: false
  });

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
    },
    async createMediaAsset(input) {
      await sql`
        insert into media_assets (
          id,
          content_item_id,
          provider,
          provider_asset_id,
          provider_state
        )
        values (
          ${randomUUID()},
          ${input.contentId},
          ${input.provider},
          ${input.providerAssetId},
          ${input.providerState}
        )
        on conflict (provider, provider_asset_id) do nothing
      `;
    },
    async findContentDetail(input) {
      const rows = await sql<ContentDetailRow[]>`
        select
          ci.id,
          ci.media_type,
          ci.caption,
          ci.nsfw_label,
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
        where ci.id = ${input.contentId}
          and (
            (
              ci.state = 'ready'
              and ci.visibility = 'public'
              and ci.moderation_state = 'approved'
            )
            or u.supabase_user_id = ${input.supabaseUserId}
          )
        limit 1
      `;

      const row = rows[0];

      return row ? toContentItem(row, row.poster_url, accessStateForRule(row)) : null;
    },
    async findContentUnlockOffer(input) {
      const rows = await sql<ContentUnlockOfferRow[]>`
        select
          ci.id as content_id,
          car.price_minor,
          car.currency,
          eg.id as entitlement_id,
          eg.state as entitlement_state,
          eg.granted_at as entitlement_granted_at,
          eg.ends_at as entitlement_ends_at,
          creator.supabase_user_id = ${input.supabaseUserId} as is_creator
        from content_items ci
        join users creator on creator.id = ci.creator_user_id
        join users viewer on viewer.supabase_user_id = ${input.supabaseUserId}
        join lateral (
          select price_minor, currency
          from content_access_rules
          where content_item_id = ci.id
            and state = 'active'
            and product_type = 'content_unlock'
            and access_type in ('locked', 'paid')
            and price_minor is not null
            and currency = 'SOL'
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
        where ci.id = ${input.contentId}
          and ci.state = 'ready'
          and ci.visibility = 'public'
          and ci.moderation_state = 'approved'
          and not exists (
            select 1
            from blocks b
            where (b.blocker_user_id = viewer.id and b.blocked_user_id = ci.creator_user_id)
               or (b.blocker_user_id = ci.creator_user_id and b.blocked_user_id = viewer.id)
          )
        limit 1
      `;

      const row = rows[0];

      if (!row) {
        return null;
      }

      const entitlement = toEntitlement(row);

      return {
        contentId: row.content_id,
        alreadyUnlocked: row.is_creator || Boolean(row.entitlement_id),
        priceMinor: Number(row.price_minor),
        currency: row.currency,
        ...(entitlement ? { entitlement } : {})
      };
    },
    async findOwnedContentForUpload(input) {
      const rows = await sql<{ id: string; media_type: ContentItem["mediaType"]; caption: string | null }[]>`
        select
          ci.id,
          ci.media_type,
          ci.caption
        from content_items ci
        join users u on u.id = ci.creator_user_id
        where ci.id = ${input.contentId}
          and u.supabase_user_id = ${input.supabaseUserId}
          and ci.state in ('draft', 'processing')
        limit 1
      `;

      const row = rows[0];

      return row
        ? {
            id: row.id,
            mediaType: row.media_type,
            caption: row.caption
          }
        : null;
    },
    async findOwnedMediaAssetForSync(input) {
      const rows = await sql<
        { id: string; content_item_id: string; provider: "bunny"; provider_asset_id: string }[]
      >`
        select
          ma.id,
          ma.content_item_id,
          ma.provider,
          ma.provider_asset_id
        from media_assets ma
        join content_items ci on ci.id = ma.content_item_id
        join users u on u.id = ci.creator_user_id
        where ma.id = ${input.mediaAssetId}
          and ma.provider = 'bunny'
          and u.supabase_user_id = ${input.supabaseUserId}
        limit 1
      `;
      const row = rows[0];

      return row
        ? {
            id: row.id,
            contentId: row.content_item_id,
            provider: row.provider,
            providerAssetId: row.provider_asset_id
          }
        : null;
    },
    async updateMediaAssetPlayback(input) {
      await sql.begin(async (transaction) => {
        await transaction`
          update media_assets
          set
            provider_state = ${input.providerState},
            provider_playable = ${input.providerPlayable},
            playback_url = ${input.playbackUrl ?? null},
            poster_url = coalesce(${input.posterUrl ?? null}, poster_url),
            duration_ms = coalesce(${input.durationMs ?? null}, duration_ms),
            ready_at = case when ${input.providerPlayable} then coalesce(ready_at, now()) else ready_at end,
            provider_checked_at = now()
          where id = ${input.mediaAssetId}
        `;
        await transaction`
          update content_items ci
          set
            state = case when ${input.providerPlayable} then 'ready' else state end,
            moderation_state = case when ${input.providerPlayable} then 'approved' else moderation_state end,
            updated_at = now()
          from media_assets ma
          where ma.content_item_id = ci.id
            and ma.id = ${input.mediaAssetId}
        `;
      });
    },
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
    },
    async close() {
      await sql.end({ timeout: 5 });
    }
  };
}

function toContentItem(
  row: ContentRow,
  posterUrl: string | null,
  accessState: ContentItem["accessState"] = "free"
): ContentItem {
  return {
    id: row.id,
    creator: {
      id: row.creator_id,
      handle: row.handle ?? "",
      displayName: row.display_name ?? "",
      avatarUrl: row.avatar_url,
      badges: []
    },
    mediaType: row.media_type,
    caption: row.caption,
    posterUrl,
    playback: playbackForRow(row as Partial<PlaybackProjectionRow>, accessState),
    accessState,
    nsfwLabel: row.nsfw_label,
    engagement: {
      liked: Boolean(row.liked),
      saved: Boolean(row.saved),
      likeCount: Number(row.like_count ?? 0),
      commentCount: Number(row.comment_count ?? 0),
      shareCount: Number(row.share_count ?? 0)
    }
  };
}

function playbackForRow(
  row: Partial<PlaybackProjectionRow>,
  accessState: ContentItem["accessState"]
): NonNullable<ContentItem["playback"]> {
  if (!row.provider || !row.provider_playable || !row.playback_url) {
    return {
      state: "not_ready",
      url: null,
      provider: "none"
    };
  }

  if (!["free", "unlocked", "subscribed"].includes(accessState)) {
    return {
      state: accessState === "teaser" ? "teaser" : "blocked",
      url: null,
      provider: row.provider
    };
  }

  return {
    state: "full",
    url: row.playback_url,
    provider: row.provider
  };
}

interface PlaybackProjectionRow {
  playback_url: string | null;
  provider: "bunny" | null;
  provider_state: string | null;
  provider_playable: boolean | null;
}

function accessStateForRule(row: {
  access_type: string | null;
  product_type: string | null;
  entitlement_id?: string | null;
}): ContentItem["accessState"] {
  if (row.entitlement_id) {
    return "unlocked";
  }

  if (!row.access_type || row.access_type === "free") {
    return "free";
  }

  if (row.access_type === "teaser") {
    return "teaser";
  }

  if (row.product_type === "live_pass" || row.access_type === "live_pass") {
    return "pass_required";
  }

  if (
    row.product_type === "content_unlock" ||
    row.product_type === "subscriber_only" ||
    row.access_type === "locked" ||
    row.access_type === "paid"
  ) {
    return "locked";
  }

  return "locked";
}

function extractHashtagSlugs(caption: string | null | undefined): string[] {
  if (!caption) {
    return [];
  }

  const slugs = new Set<string>();
  const matches = caption.matchAll(/(^|[\s([{"'])#([A-Za-z0-9_]{1,64})/g);

  for (const match of matches) {
    const slug = match[2]?.toLowerCase();
    if (slug && /^[a-z0-9][a-z0-9_]{0,63}$/.test(slug)) {
      slugs.add(slug);
    }
  }

  return [...slugs].slice(0, 20);
}

function toEntitlement(row: {
  content_id: string;
  entitlement_id: string | null;
  entitlement_state: Entitlement["state"] | null;
  entitlement_granted_at: Date | null;
  entitlement_ends_at: Date | null;
}): Entitlement | undefined {
  if (!row.entitlement_id || !row.entitlement_state || !row.entitlement_granted_at) {
    return undefined;
  }

  return {
    id: row.entitlement_id,
    targetType: "content",
    targetId: row.content_id,
    productType: "content_unlock",
    state: row.entitlement_state,
    grantedAt: row.entitlement_granted_at.toISOString(),
    expiresAt: row.entitlement_ends_at ? row.entitlement_ends_at.toISOString() : null
  };
}
