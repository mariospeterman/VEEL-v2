import type { ContentItem, Event, Hashtag, LiveRoom } from "./types.js";

export interface ContentRow {
  id: string;
  media_type: ContentItem["mediaType"];
  distribution_mode: ContentItem["distributionMode"];
  expires_at: Date | null;
  scheduled_for: Date | null;
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

export interface HashtagRow {
  slug: string;
  display_name: string;
  state: Hashtag["state"];
}

export interface CreatorRow {
  id: string;
  handle: string | null;
  display_name: string | null;
  avatar_url: string | null;
}

export interface EventRow {
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
  access_pass_types: unknown;
}

export interface LiveRoomRow {
  id: string;
  title: string;
  state: LiveRoom["state"];
  creator_id: string;
  handle: string | null;
  display_name: string | null;
  avatar_url: string | null;
  playback_url: string | null;
  access_rule: LiveRoom["accessMode"];
  preview_seconds: number;
  event_price_minor: string | number | null;
  currency: "SOL";
  members_only_chat: boolean;
  members_included_in_paid_event: boolean;
  replay_window_hours: number;
  replay_content_item_id: string | null;
  has_active_pass: boolean;
  has_active_membership: boolean;
  is_creator: boolean;
}
