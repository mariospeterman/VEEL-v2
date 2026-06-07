import postgres from "postgres";
import type { DiscoverRepository } from "./types.js";
import {
  listContent,
  listCreators,
  listEvents,
  listHashtags,
  listLive
} from "./discover-repository-queries.js";

export class DiscoverRepositoryConfigurationError extends Error {
  constructor() {
    super("DATABASE_URL_NOT_CONFIGURED");
    this.name = "DiscoverRepositoryConfigurationError";
  }
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
