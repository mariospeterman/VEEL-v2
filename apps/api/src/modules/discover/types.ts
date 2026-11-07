import type { components } from "@veel/contracts";
import type { StoredLiveRoom } from "../live/types.js";

export type ContentItem = components["schemas"]["ContentItem"];
export type DiscoverPage = components["schemas"]["DiscoverPage"];
export type Event = components["schemas"]["Event"];
export type Hashtag = components["schemas"]["Hashtag"];
export type User = components["schemas"]["User"];
export type DiscoverCursorSet = components["schemas"]["DiscoverCursorSet"];

export interface DiscoverQueryInput {
  supabaseUserId: string;
  query?: string | undefined;
  slug?: string | undefined;
  cursor?: string | undefined;
  limit: number;
}

export interface DiscoverSearchInput extends Omit<DiscoverQueryInput, "cursor" | "slug"> {
  cursors?: Partial<Record<keyof DiscoverCursorSet, string>> | undefined;
}

export interface DiscoverRepositoryPage extends Omit<DiscoverPage, "liveRooms"> {
  liveRooms: StoredLiveRoom[];
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

export interface DiscoverLiveRoomPage {
  items: StoredLiveRoom[];
  nextCursor: string | null;
}

export interface DiscoverRepository {
  search(input: DiscoverSearchInput): Promise<DiscoverRepositoryPage>;
  listHashtags(input: DiscoverQueryInput): Promise<HashtagPage>;
  getHashtag(input: DiscoverQueryInput & { slug: string }): Promise<DiscoverRepositoryPage>;
  listCreators(input: DiscoverQueryInput): Promise<CreatorPage>;
  listEvents(input: DiscoverQueryInput): Promise<EventPage>;
  listLive(input: DiscoverQueryInput): Promise<DiscoverLiveRoomPage>;
  close?(): Promise<void>;
}
