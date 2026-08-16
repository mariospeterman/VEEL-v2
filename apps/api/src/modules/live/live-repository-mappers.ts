import type { LiveChatMessage, StoredLiveRoom } from "./types.js";
import type { LiveChatMessageRow, LiveRoomRow } from "./live-repository-rows.js";

export function toLiveRoom(row: LiveRoomRow): StoredLiveRoom {
  const membershipGrantsAccess =
    row.has_active_membership &&
    (row.access_rule === "profile_members" || row.members_included_in_paid_event);
  const accessAllowed =
    row.is_creator || row.access_rule === "public" || row.has_active_pass || membershipGrantsAccess;
  const liveSafetyReleased =
    row.live_safety_state === "approved" && row.live_provider_release_allowed === true;
  const isLivePlayable = row.state === "live" && liveSafetyReleased && Boolean(row.playback_url);
  const isReplayPlayable =
    row.state === "replay_ready" && row.replay_release_allowed && Boolean(row.replay_playback_url);
  const isPlayable = isLivePlayable || isReplayPlayable;
  const playbackUrl = isReplayPlayable ? row.replay_playback_url : row.playback_url;
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
    safetyState: toLiveSafetyState(row),
    accessMode: row.access_rule as StoredLiveRoom["accessMode"],
    accessState,
    playback:
      isPlayable && accessAllowed
        ? {
            state: "full",
            url: playbackUrl,
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
      enabled: row.state === "live" && liveSafetyReleased,
      accessState:
        row.state !== "live" || !liveSafetyReleased
          ? "closed"
          : chatAllowed
            ? "allowed"
            : "members_only"
    },
    replayContentId: row.replay_content_item_id,
    providerStreamId: row.provider_stream_id,
    providerPlaybackId: isReplayPlayable
      ? row.replay_provider_playback_id
      : row.provider_playback_id,
    hostIngestUrl: row.host_ingest_url,
    hostStreamKey: row.host_stream_key
  };

  if (row.request_hash) {
    room.requestHash = row.request_hash;
  }

  return room;
}

function toLiveSafetyState(row: LiveRoomRow): StoredLiveRoom["safetyState"] {
  if (row.state === "suspended") return "suspended";
  if (row.live_safety_state === "rejected" || row.live_safety_state === "held_for_reporting") {
    return "rejected";
  }
  if (row.live_safety_state === "approved" && row.live_provider_release_allowed) {
    return row.state === "live" ? "monitoring" : "approved";
  }
  return "quarantined";
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
