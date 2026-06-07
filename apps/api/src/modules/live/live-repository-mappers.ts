import type { LiveChatMessage, StoredLiveRoom } from "./types.js";
import type { LiveChatMessageRow, LiveRoomRow } from "./live-repository-rows.js";

export function toLiveRoom(row: LiveRoomRow): StoredLiveRoom {
  const passActive = row.has_active_pass || row.is_creator;
  const isPlayable = row.state === "live" && Boolean(row.playback_url);
  const room: StoredLiveRoom = {
    id: row.id,
    title: row.title,
    creator: {
      id: row.creator_user_id,
      handle: row.creator_handle,
      displayName: row.creator_display_name,
      avatarUrl: row.creator_avatar_url,
      badges: []
    },
    state: row.state,
    accessState: passActive ? "pass_active" : "pass_required",
    playback:
      isPlayable && passActive
        ? {
            state: "full",
            url: row.playback_url,
            provider: "livepeer"
          }
        : {
            state: isPlayable ? "blocked" : "not_ready",
            url: null,
            provider: "livepeer"
          },
    teaserSecondsRemaining: passActive ? null : row.teaser_seconds,
    passOptions: row.pass_durations_minutes.map((durationMinutes) => ({
      durationMinutes: durationMinutes as 30 | 60 | 180,
      amountMinor: Number(row.pass_price_minor),
      currency: row.currency
    })),
    chat: {
      enabled: row.state === "live",
      accessState: row.state === "live" ? (passActive ? "allowed" : "pass_required") : "closed"
    },
    replayContentId: row.replay_content_item_id,
    providerStreamId: row.provider_stream_id,
    providerPlaybackId: row.provider_playback_id,
    hostIngestUrl: row.host_ingest_url,
    hostStreamKey: row.host_stream_key
  };

  if (row.request_hash) {
    room.requestHash = row.request_hash;
  }

  return room;
}

export function toLiveChatMessage(row: LiveChatMessageRow): LiveChatMessage {
  return {
    id: row.id,
    roomId: row.room_id,
    author: {
      id: row.author_id,
      handle: row.author_handle,
      displayName: row.author_display_name,
      avatarUrl: row.author_avatar_url,
      badges: []
    },
    body: row.body,
    createdAt: row.created_at.toISOString()
  };
}
