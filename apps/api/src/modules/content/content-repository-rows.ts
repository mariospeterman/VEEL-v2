import type { ContentItem, Entitlement } from "./types.js";

export interface FeedRow {
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
  provider: "bunny" | "livepeer" | null;
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

export interface ContentRow {
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

export interface ContentDetailRow extends ContentRow {
  poster_url: string | null;
  playback_url: string | null;
  provider: "bunny" | "livepeer" | null;
  provider_state: string | null;
  provider_playable: boolean | null;
  access_type: string | null;
  product_type: string | null;
  entitlement_id: string | null;
  entitlement_state: Entitlement["state"] | null;
  entitlement_granted_at: Date | null;
  entitlement_ends_at: Date | null;
}

export interface ContentUnlockOfferRow {
  content_id: string;
  price_minor: number;
  currency: "SOL";
  entitlement_id: string | null;
  entitlement_state: Entitlement["state"] | null;
  entitlement_granted_at: Date | null;
  entitlement_ends_at: Date | null;
  is_creator: boolean;
}

export interface PlaybackProjectionRow {
  playback_url: string | null;
  provider: "bunny" | "livepeer" | null;
  provider_state: string | null;
  provider_playable: boolean | null;
}
