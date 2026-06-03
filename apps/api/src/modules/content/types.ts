import type { components } from "@veel/contracts";

export type ContentItem = components["schemas"]["ContentItem"];
export type FeedPage = components["schemas"]["FeedPage"];
export type FeedMode = "recommended" | "following" | "nsfw" | "sfw" | "live" | "premium";

export interface ListHomeFeedInput {
  mode: FeedMode;
  cursor?: string;
  limit: number;
}

export interface ContentRepository {
  listHomeFeed(input: ListHomeFeedInput): Promise<FeedPage>;
  close?(): Promise<void>;
}
