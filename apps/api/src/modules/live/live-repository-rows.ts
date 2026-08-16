import type { StoredLiveRoom } from "./types.js";

export interface LiveRoomRow {
  id: string;
  title: string;
  state: StoredLiveRoom["state"];
  access_rule: string;
  creator_user_id: string;
  creator_handle: string;
  creator_display_name: string;
  creator_avatar_url: string | null;
  provider_stream_id: string | null;
  provider_playback_id: string | null;
  host_ingest_url: string | null;
  host_stream_key: string | null;
  playback_url: string | null;
  preview_seconds: number;
  event_price_minor: number | null;
  currency: "SOL";
  members_only_chat: boolean;
  members_included_in_paid_event: boolean;
  replay_window_hours: number;
  replay_content_item_id: string | null;
  live_safety_state: string | null;
  live_provider_release_allowed: boolean | null;
  replay_release_allowed: boolean;
  replay_playback_url: string | null;
  replay_provider_playback_id: string | null;
  request_hash?: string;
  has_active_pass: boolean;
  has_active_membership: boolean;
  is_creator: boolean;
}

export interface LiveChatMessageRow {
  id: string;
  room_id: string;
  body: string;
  created_at: Date;
  author_id: string;
  author_handle: string;
  author_display_name: string;
  author_avatar_url: string | null;
  request_hash?: string | null;
}
