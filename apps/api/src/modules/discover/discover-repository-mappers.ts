import type { ContentItem, Event, LiveRoom, User } from "./types.js";
import type { ContentRow, CreatorRow, EventRow, LiveRoomRow } from "./discover-repository-rows.js";

export function normalizeSearch(query: string | undefined): string | null {
  const normalized = query?.trim().replace(/^#/, "").toLowerCase();

  return normalized && normalized.length > 0 ? normalized.slice(0, 80) : null;
}

export function toUser(
  row: CreatorRow | { creator_id: string; handle: string | null; display_name: string | null; avatar_url: string | null }
): User {
  return {
    id: "id" in row ? row.id : row.creator_id,
    handle: row.handle ?? "",
    displayName: row.display_name ?? "",
    avatarUrl: row.avatar_url,
    badges: []
  };
}

export function toContentItem(row: ContentRow): ContentItem {
  const accessState = row.entitlement_id
    ? "unlocked"
    : row.access_type === "locked" || row.access_type === "paid" || row.product_type === "content_unlock"
      ? "locked"
      : "free";
  const playback =
    row.provider && row.provider_playable && row.playback_url && ["free", "unlocked", "subscribed"].includes(accessState)
      ? { state: "full" as const, url: row.playback_url, provider: row.provider }
      : { state: "not_ready" as const, url: null, provider: "none" as const };

  return {
    id: row.id,
    creator: toUser(row),
    mediaType: row.media_type,
    caption: row.caption,
    posterUrl: row.poster_url,
    playback,
    accessState,
    nsfwLabel: row.nsfw_label,
    engagement: {
      liked: row.liked,
      saved: row.saved,
      likeCount: Number(row.like_count),
      commentCount: Number(row.comment_count),
      shareCount: Number(row.share_count)
    }
  };
}

export function toEvent(row: EventRow): Event {
  const accessPassTypes = Array.isArray(row.access_pass_types) ? row.access_pass_types : [];
  const location: Event["location"] = {
    type: row.location_type,
    ...(row.location_label ? { label: row.location_label } : {}),
    ...(row.location_lat === null ? {} : { latitude: Number(row.location_lat) }),
    ...(row.location_lng === null ? {} : { longitude: Number(row.location_lng) })
  };

  return {
    id: row.id,
    title: row.title,
    description: row.description,
    startsAt: row.starts_at.toISOString(),
    endsAt: row.ends_at?.toISOString() ?? null,
    accessRule: row.access_rule,
    location,
    state: row.state,
    accessPassTypes: accessPassTypes as Event["accessPassTypes"]
  };
}

export function toLiveRoom(row: LiveRoomRow): LiveRoom {
  const membershipGrantsAccess =
    row.has_active_membership &&
    (row.access_rule === "profile_members" || row.members_included_in_paid_event);
  const accessAllowed =
    row.is_creator || row.access_rule === "public" || row.has_active_pass || membershipGrantsAccess;
  const accessState = accessAllowed
    ? "allowed"
    : row.access_rule === "profile_members"
      ? "membership_required"
      : "event_access_required";
  const chatAllowed =
    accessAllowed && (!row.members_only_chat || row.is_creator || row.has_active_membership);

  return {
    id: row.id,
    title: row.title,
    creator: toUser({
      creator_id: row.creator_id,
      handle: row.handle,
      display_name: row.display_name,
      avatar_url: row.avatar_url
    }),
    state: row.state,
    safetyState: row.state === "suspended" ? "suspended" : row.state === "live" ? "monitoring" : "approved",
    accessMode: row.access_rule,
    accessState,
    playback: row.playback_url && accessAllowed
      ? { state: "full", url: row.playback_url, provider: "livepeer" }
      : { state: "blocked", url: null, provider: "livepeer" },
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
      enabled: true,
      accessState: chatAllowed ? "allowed" : "members_only"
    },
    replayContentId: row.replay_content_item_id
  };
}
