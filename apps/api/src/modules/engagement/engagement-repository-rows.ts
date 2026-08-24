import type {
  Comment,
  FeedPreferences,
  ModerationIntake,
  ShareResult
} from "./types.js";

export interface PreferencesRow {
  default_feed_mode: FeedPreferences["defaultMode"];
  nsfw_preference: FeedPreferences["nsfwPreference"];
  hidden_creator_ids: string[] | null;
  hidden_topics: string[] | null;
}

export interface EngagementStateRow {
  liked: boolean;
  saved: boolean;
  like_count: string | number;
  comment_count: string | number;
  share_count: string | number;
}

export interface CommentRow {
  id: string;
  body: string;
  moderation_state: Comment["moderationState"];
  created_at: Date;
  author_id: string;
  handle: string | null;
  display_name: string | null;
  avatar_url: string | null;
  parent_comment_id: string | null;
  liked: boolean;
  like_count: string | number;
  reply_count: string | number;
  mentions: Array<{
    id: string;
    handle: string | null;
    displayName: string | null;
    avatarUrl: string | null;
  }> | null;
}

export interface CommentReplayRow extends CommentRow {
  content_item_id: string;
}

export interface ShareRow {
  id: string;
  mode: ShareResult["mode"];
  url: string | null;
}

export interface ShareReplayRow extends ShareRow {
  target_type: string;
  target_id: string;
}

export interface ReportRow {
  id: string;
  state: ModerationIntake["state"];
  queue: ModerationIntake["queue"];
}

export interface ReportReplayRow extends ReportRow {
  subject_type: string;
  subject_id: string;
  reason: string;
}

export interface PrivacyUserRow {
  relationship: "blocked" | "muted";
  id: string;
  handle: string | null;
  display_name: string | null;
  avatar_url: string | null;
}

export interface DataRequestRow {
  id: string;
  type: "export" | "delete";
  state: "requested" | "verifying" | "processing" | "completed" | "rejected";
  created_at: Date;
  updated_at: Date | null;
  completed_at: Date | null;
}
