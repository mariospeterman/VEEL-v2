import type { ContentItem, Entitlement } from "./types.js";
import type { ContentRow, PlaybackProjectionRow } from "./content-repository-rows.js";

export function toContentItem(
  row: ContentRow,
  posterUrl: string | null,
  accessState: ContentItem["accessState"] = "free"
): ContentItem {
  return {
    id: row.id,
    creator: {
      id: row.creator_id,
      handle: row.handle ?? "",
      displayName: row.display_name ?? "",
      avatarUrl: row.avatar_url,
      badges: []
    },
    mediaType: row.media_type,
    caption: row.caption,
    posterUrl,
    playback: playbackForRow(row as Partial<PlaybackProjectionRow>, accessState),
    accessState,
    nsfwLabel: row.nsfw_label,
    engagement: {
      liked: Boolean(row.liked),
      saved: Boolean(row.saved),
      likeCount: Number(row.like_count ?? 0),
      commentCount: Number(row.comment_count ?? 0),
      shareCount: Number(row.share_count ?? 0)
    }
  };
}

export function accessStateForRule(row: {
  access_type: string | null;
  product_type: string | null;
  entitlement_id?: string | null;
}): ContentItem["accessState"] {
  if (row.entitlement_id) {
    return "unlocked";
  }

  if (!row.access_type || row.access_type === "free") {
    return "free";
  }

  if (row.access_type === "teaser") {
    return "teaser";
  }

  if (row.product_type === "live_pass" || row.access_type === "live_pass") {
    return "pass_required";
  }

  if (
    row.product_type === "content_unlock" ||
    row.product_type === "subscriber_only" ||
    row.access_type === "locked" ||
    row.access_type === "paid"
  ) {
    return "locked";
  }

  return "locked";
}

export function extractHashtagSlugs(caption: string | null | undefined): string[] {
  if (!caption) {
    return [];
  }

  const slugs = new Set<string>();
  const matches = caption.matchAll(/(^|[\s([{"'])#([A-Za-z0-9_]{1,64})/g);

  for (const match of matches) {
    const slug = match[2]?.toLowerCase();
    if (slug && /^[a-z0-9][a-z0-9_]{0,63}$/.test(slug)) {
      slugs.add(slug);
    }
  }

  return [...slugs].slice(0, 20);
}

export function toEntitlement(row: {
  content_id: string;
  entitlement_id: string | null;
  entitlement_state: Entitlement["state"] | null;
  entitlement_granted_at: Date | null;
  entitlement_ends_at: Date | null;
}): Entitlement | undefined {
  if (!row.entitlement_id || !row.entitlement_state || !row.entitlement_granted_at) {
    return undefined;
  }

  return {
    id: row.entitlement_id,
    targetType: "content",
    targetId: row.content_id,
    productType: "content_unlock",
    state: row.entitlement_state,
    grantedAt: row.entitlement_granted_at.toISOString(),
    expiresAt: row.entitlement_ends_at ? row.entitlement_ends_at.toISOString() : null
  };
}

function playbackForRow(
  row: Partial<PlaybackProjectionRow>,
  accessState: ContentItem["accessState"]
): NonNullable<ContentItem["playback"]> {
  if (!row.provider || !row.provider_playable || !row.playback_url) {
    return {
      state: "not_ready",
      url: null,
      provider: "none"
    };
  }

  if (!["free", "unlocked", "subscribed"].includes(accessState)) {
    return {
      state: accessState === "teaser" ? "teaser" : "blocked",
      url: null,
      provider: row.provider
    };
  }

  return {
    state: "full",
    url: row.playback_url,
    provider: row.provider
  };
}
