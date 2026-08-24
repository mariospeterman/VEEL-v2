import type { ContentItem, Entitlement } from "./types.js";
import type { ContentRow, PlaybackProjectionRow } from "./content-repository-rows.js";

export function toContentItem(
  row: ContentRow,
  posterUrl: string | null,
  accessState: ContentItem["accessState"] = "free"
): ContentItem {
  const fullCompositionAllowed = ["free", "unlocked", "subscribed"].includes(accessState);

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
    distributionMode: row.distribution_mode ?? "post",
    ...(row.expires_at !== undefined
      ? { expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null }
      : {}),
    ...(row.scheduled_for !== undefined
      ? { scheduledFor: row.scheduled_for ? new Date(row.scheduled_for).toISOString() : null }
      : {}),
    caption: row.caption,
    ...(row.body_text !== undefined
      ? { bodyText: fullCompositionAllowed ? row.body_text : null }
      : {}),
    ...(row.asset_revision !== undefined ? { compositionRevision: Number(row.asset_revision) } : {}),
    ...(Array.isArray(row.media_assets)
      ? {
          mediaAssets: row.media_assets.map((asset) => {
            const { playbackUrl, providerPlayable, ...publicAsset } = asset;
            return {
              ...publicAsset,
              posterUrl: fullCompositionAllowed ? (asset.posterUrl ?? null) : null,
              ...(asset.kind === "video"
                ? {
                    playback: playbackForRow({
                      playback_url: playbackUrl ?? null,
                      provider: asset.provider,
                      provider_playable: providerPlayable ?? false
                    }, accessState)
                  }
                : {})
            };
          })
        }
      : {}),
    ...(row.poll !== undefined
      ? { poll: fullCompositionAllowed ? normalizeContentPoll(row.poll) : null }
      : {}),
    posterUrl: fullCompositionAllowed || accessState === "teaser" ? posterUrl : null,
    playback: playbackForRow(row as Partial<PlaybackProjectionRow>, accessState),
    accessState,
    nsfwLabel: row.nsfw_label,
    engagement: {
      liked: Boolean(row.liked),
      saved: Boolean(row.saved),
      likeCount: Number(row.like_count ?? 0),
      commentCount: Number(row.comment_count ?? 0),
      shareCount: Number(row.share_count ?? 0)
    },
    ...(typeof row.viewer_following_creator === "boolean"
      ? { viewerFollowingCreator: row.viewer_following_creator }
      : {})
  };
}

export function normalizeContentPoll(
  poll: Exclude<ContentItem["poll"], undefined>
): Exclude<ContentItem["poll"], undefined> {
  if (!poll) return poll;
  return {
    ...poll,
    closesAt: poll.closesAt ? new Date(poll.closesAt).toISOString() : null
  };
}

export function accessStateForRule(row: {
  access_type: string | null;
  product_type: string | null;
  entitlement_id?: string | null;
  viewer_is_creator?: boolean;
}): ContentItem["accessState"] {
  if (row.viewer_is_creator || row.entitlement_id) {
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
