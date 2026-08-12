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

export interface BlockReplayRow {
  blocker_user_id: string;
  blocked_user_id: string;
  idempotency_key: string;
}
