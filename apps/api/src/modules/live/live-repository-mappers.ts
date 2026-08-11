import type { LiveChatMessage, StoredLiveRoom } from "./types.js";
import type { LiveChatMessageRow, LiveRoomRow } from "./live-repository-rows.js";

export function toLiveRoom(row: LiveRoomRow): StoredLiveRoom {
  const membershipGrantsAccess =
    row.has_active_membership &&
    (row.access_rule === "profile_members" || row.members_included_in_paid_event);
  const accessAllowed =
    row.is_creator || row.access_rule === "public" || row.has_active_pass || membershipGrantsAccess;
  const isPlayable =
    (row.state === "live" || row.state === "replay_ready") && Boolean(row.playback_url);
  const accessState = accessAllowed
    ? "allowed"
    : row.access_rule === "profile_members"
      ? "membership_required"
      : "event_access_required";
  const chatAllowed =
    accessAllowed && (!row.members_only_chat || row.is_creator || row.has_active_membership);
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
    accessMode: row.access_rule as StoredLiveRoom["accessMode"],
    accessState,
    playback:
      isPlayable && accessAllowed
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
    previewSecondsRemaining: accessAllowed ? null : row.preview_seconds,
    eventAccess:
      row.access_rule === "paid_event" && row.event_price_minor !== null
        ? {
            amountMinor: Number(row.event_price_minor),
            currency: row.currency,
            replayWindowHours: row.replay_window_hours,
            membersIncluded: row.members_included_in_paid_event
          }
        : null,
    chat: {
      enabled: row.state === "live",
      accessState:
        row.state !== "live" ? "closed" : chatAllowed ? "allowed" : "members_only"
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
