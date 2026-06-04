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
  access_type: string | null;
  product_type: string | null;
  entitlement_id: string | null;
  entitlement_state: Entitlement["state"] | null;
  entitlement_granted_at: Date | null;
  entitlement_ends_at: Date | null;
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
}

interface ContentDetailRow extends ContentRow {
  poster_url: string | null;
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
      async findOwnedContentForUpload() {
        throw new ContentRepositoryConfigurationError();
      },
      async listHomeFeed() {
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
          car.access_type,
          car.product_type,
          eg.id as entitlement_id,
          eg.state as entitlement_state,
          eg.granted_at as entitlement_granted_at,
          eg.ends_at as entitlement_ends_at
        from content_items ci
        join users u on u.id = ci.creator_user_id
        join profiles p on p.user_id = u.id
        join users viewer on viewer.supabase_user_id = ${input.supabaseUserId}
        left join lateral (
          select poster_url
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
          car.access_type,
          car.product_type,
          eg.id as entitlement_id,
          eg.state as entitlement_state,
          eg.granted_at as entitlement_granted_at,
          eg.ends_at as entitlement_ends_at
        from content_items ci
        join users u on u.id = ci.creator_user_id
        join profiles p on p.user_id = u.id
        join users viewer on viewer.supabase_user_id = ${input.supabaseUserId}
        left join lateral (
          select poster_url
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
    playback: {
      state: "not_ready",
      url: null,
      provider: "none"
    },
    accessState,
    nsfwLabel: row.nsfw_label,
    engagement: {
      liked: false,
      saved: false,
      likeCount: 0,
      commentCount: 0,
      shareCount: 0
    }
  };
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
