import type { Mutual, MutualsFeedItem, MutualsProfile } from "./types.js";

export interface MutualsProfileRow {
  enabled: boolean;
  consent_version: string | null;
  active_match_limit: number;
  visible_on_media: boolean;
  safety_state: MutualsProfile["safetyState"];
  created_at: Date;
  updated_at: Date;
}

export interface MutualsFeedRow {
  content_id: string;
  creator_user_id: string;
  handle: string;
  display_name: string;
  avatar_url: string | null;
  title: string;
  media_kind: MutualsFeedItem["mediaKind"];
  poster_url: string | null;
  created_at: Date;
}

export interface MutualsInterestResultRow {
  swipe_id: string;
  swipe_action: "yes" | "not_interested";
  swipe_idempotency_key: string;
  request_hash: string;
  match_id: string | null;
  match_user_a_id: string | null;
  match_user_b_id: string | null;
  match_source_content_item_id: string | null;
  match_conversation_id: string | null;
  match_state: Mutual["state"] | null;
  match_stale_at: Date | null;
  match_expires_at: Date | null;
  match_created_at: Date | null;
}

export interface MutualRow {
  id: string;
  user_a_id: string;
  user_b_id: string;
  source_content_item_id: string | null;
  conversation_id: string | null;
  state: Mutual["state"];
  stale_at: Date | null;
  expires_at: Date | null;
  created_at: Date;
}
