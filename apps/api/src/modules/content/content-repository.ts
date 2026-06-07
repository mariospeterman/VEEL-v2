import { randomUUID } from "node:crypto";
import postgres from "postgres";
import type { ContentRepository } from "./types.js";
import { createContentMediaRepositoryMethods } from "./content-media-repository.js";
import { accessStateForRule, extractHashtagSlugs, toContentItem, toEntitlement } from "./content-repository-mappers.js";
import type {
  ContentDetailRow,
  ContentRow,
  ContentUnlockOfferRow,
  FeedRow
} from "./content-repository-rows.js";

export class ContentRepositoryConfigurationError extends Error {
  constructor() {
    super("DATABASE_URL_NOT_CONFIGURED");
    this.name = "ContentRepositoryConfigurationError";
  }
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
      async recordMediaProviderWebhook() {
        throw new ContentRepositoryConfigurationError();
      },
      async updateMediaAssetFromWebhook() {
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
    ...createContentMediaRepositoryMethods(sql),
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
