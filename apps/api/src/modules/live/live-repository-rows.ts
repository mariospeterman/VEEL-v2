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
  provider_stream_id: string;
  provider_playback_id: string | null;
  host_ingest_url: string | null;
  host_stream_key: string | null;
  playback_url: string | null;
  teaser_seconds: number;
  pass_price_minor: number;
  currency: "SOL";
  pass_durations_minutes: number[];
  replay_content_item_id: string | null;
  request_hash?: string;
  has_active_pass: boolean;
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
}
