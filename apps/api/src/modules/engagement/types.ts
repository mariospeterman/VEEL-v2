import type { components } from "@veel/contracts";

export type BlockState = components["schemas"]["BlockState"];
export type Comment = components["schemas"]["Comment"];
export type CommentPage = components["schemas"]["CommentPage"];
export type CreateCommentRequest = components["schemas"]["CreateCommentRequest"];
export type CreateReportRequest = components["schemas"]["CreateReportRequest"];
export type CreateShareRequest = components["schemas"]["CreateShareRequest"];
export type EngagementState = components["schemas"]["EngagementState"];
export type FeedPreferences = components["schemas"]["FeedPreferences"];
export type FollowState = components["schemas"]["FollowState"];
export type HideFeedCreatorRequest = components["schemas"]["HideFeedCreatorRequest"];
export type HideFeedTopicRequest = components["schemas"]["HideFeedTopicRequest"];
export type ModerationIntake = components["schemas"]["ModerationIntake"];
export type RecordFeedImpressionRequest = components["schemas"]["RecordFeedImpressionRequest"];
export type ShareResult = components["schemas"]["ShareResult"];
export type UpdateFeedPreferencesRequest = components["schemas"]["UpdateFeedPreferencesRequest"];

export interface EngagementRepository {
  getFollowState(input: { supabaseUserId: string; targetUserId: string }): Promise<FollowState>;
  setFollowState(input: {
    supabaseUserId: string;
    targetUserId: string;
    following: boolean;
    idempotencyKey: string;
  }): Promise<FollowState>;
  recordFeedImpression(input: {
    supabaseUserId: string;
    body: RecordFeedImpressionRequest;
    idempotencyKey: string;
  }): Promise<void>;
  getFeedPreferences(input: { supabaseUserId: string }): Promise<FeedPreferences>;
  updateFeedPreferences(input: {
    supabaseUserId: string;
    body: UpdateFeedPreferencesRequest;
  }): Promise<FeedPreferences>;
  resetFeedRecommendations(input: { supabaseUserId: string; idempotencyKey: string }): Promise<void>;
  hideCreator(input: {
    supabaseUserId: string;
    creatorUserId: string;
    idempotencyKey: string;
  }): Promise<FeedPreferences>;
  hideTopic(input: { supabaseUserId: string; topic: string; idempotencyKey: string }): Promise<FeedPreferences>;
  toggleLike(input: { supabaseUserId: string; contentId: string; idempotencyKey: string }): Promise<EngagementState>;
  toggleSave(input: { supabaseUserId: string; contentId: string; idempotencyKey: string }): Promise<EngagementState>;
  listComments(input: { supabaseUserId: string; contentId: string; cursor?: string; limit: number }): Promise<CommentPage>;
  createComment(input: {
    supabaseUserId: string;
    contentId: string;
    body: CreateCommentRequest;
    idempotencyKey: string;
  }): Promise<Comment>;
  createShare(input: {
    supabaseUserId: string;
    body: CreateShareRequest;
    idempotencyKey: string;
    webUrl: string;
  }): Promise<ShareResult>;
  createReport(input: {
    supabaseUserId: string;
    body: CreateReportRequest;
    idempotencyKey: string;
  }): Promise<ModerationIntake>;
  blockUser(input: {
    supabaseUserId: string;
    blockedUserId: string;
    idempotencyKey: string;
  }): Promise<BlockState>;
  close?(): Promise<void>;
}
