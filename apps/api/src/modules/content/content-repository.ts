import postgres from "postgres";
import type { ContentItem, ContentRepository } from "./types.js";

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
}

export function createPostgresContentRepository(databaseUrl?: string): ContentRepository {
  if (!databaseUrl) {
    return {
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
          ma.poster_url
        from content_items ci
        join users u on u.id = ci.creator_user_id
        join profiles p on p.user_id = u.id
        left join lateral (
          select poster_url
          from media_assets
          where content_item_id = ci.id
          order by created_at asc
          limit 1
        ) ma on true
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
        items: pageRows.map(toContentItem),
        nextCursor: nextRow ? nextRow.created_at.toISOString() : null
      };
    },
    async close() {
      await sql.end({ timeout: 5 });
    }
  };
}

function toContentItem(row: FeedRow): ContentItem {
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
    posterUrl: row.poster_url,
    playback: {
      state: "not_ready",
      url: null,
      provider: "none"
    },
    accessState: "free",
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
