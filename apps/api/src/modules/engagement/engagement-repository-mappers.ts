import type { Comment, FeedPreferences, ModerationIntake } from "./types.js";
import type { CommentRow, PreferencesRow } from "./engagement-repository-rows.js";

export function toPreferences(row: PreferencesRow | undefined): FeedPreferences {
  return {
    defaultMode: row?.default_feed_mode ?? "recommended",
    nsfwPreference: row?.nsfw_preference ?? "both",
    hiddenCreatorIds: row?.hidden_creator_ids ?? [],
    hiddenTopics: row?.hidden_topics ?? []
  };
}

export function toComment(row: CommentRow): Comment {
  return {
    id: row.id,
    author: {
      id: row.author_id,
      handle: row.handle ?? "",
      displayName: row.display_name ?? "",
      avatarUrl: row.avatar_url,
      badges: []
    },
    body: row.body,
    moderationState: row.moderation_state,
    createdAt: row.created_at.toISOString()
  };
}

export function queueForSubject(subjectType: string): ModerationIntake["queue"] {
  if (subjectType === "content") return "content";
  if (subjectType === "user") return "user";
  if (subjectType === "message") return "message";
  if (subjectType === "live_room") return "live";
  if (subjectType === "event") return "event";
  return "general";
}

export function shareUrl(
  webUrl: string,
  targetType: string,
  targetId: string,
  mode: string
): string | null {
  if (mode === "internal_message") return null;

  const base = webUrl.replace(/\/$/, "");
  return `${base}/share/${targetType}/${targetId}`;
}
