import type { components } from "@veel/contracts";

export type ContentItem = components["schemas"]["ContentItem"];
export type DiscoverPage = components["schemas"]["DiscoverPage"];
export type Event = components["schemas"]["Event"];
export type Hashtag = components["schemas"]["Hashtag"];
export type LiveRoom = components["schemas"]["LiveRoom"];
export type User = components["schemas"]["User"];

export interface DiscoverQueryInput {
  supabaseUserId: string;
  query?: string | undefined;
  slug?: string | undefined;
  cursor?: string | undefined;
  limit: number;
}

export interface HashtagPage {
  items: Hashtag[];
  nextCursor: string | null;
}

export interface CreatorPage {
  items: User[];
  nextCursor: string | null;
}

export interface EventPage {
  items: Event[];
  nextCursor: string | null;
}

export interface LiveRoomPage {
  items: LiveRoom[];
  nextCursor: string | null;
}

export interface DiscoverRepository {
  search(input: DiscoverQueryInput): Promise<DiscoverPage>;
  listHashtags(input: DiscoverQueryInput): Promise<HashtagPage>;
  getHashtag(input: DiscoverQueryInput & { slug: string }): Promise<DiscoverPage>;
  listCreators(input: DiscoverQueryInput): Promise<CreatorPage>;
  listEvents(input: DiscoverQueryInput): Promise<EventPage>;
  listLive(input: DiscoverQueryInput): Promise<LiveRoomPage>;
  close?(): Promise<void>;
}
