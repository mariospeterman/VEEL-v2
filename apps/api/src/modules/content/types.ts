import type { components } from "@veel/contracts";

export type ContentItem = components["schemas"]["ContentItem"];
export type CreateContentRequest = components["schemas"]["CreateContentRequest"];
export type CreateUploadRequest = components["schemas"]["CreateUploadRequest"];
export type FeedPage = components["schemas"]["FeedPage"];
export type FeedMode = "recommended" | "following" | "nsfw" | "sfw" | "live" | "premium";
export type UploadSession = components["schemas"]["UploadSession"];

export interface ListHomeFeedInput {
  mode: FeedMode;
  cursor?: string;
  limit: number;
}

export interface ContentRepository {
  createDraft(input: CreateContentDraftInput): Promise<ContentItem>;
  createMediaAsset(input: CreateMediaAssetInput): Promise<void>;
  findOwnedContentForUpload(input: FindOwnedContentForUploadInput): Promise<OwnedContentForUpload | null>;
  listHomeFeed(input: ListHomeFeedInput): Promise<FeedPage>;
  close?(): Promise<void>;
}

export interface CreateContentDraftInput {
  supabaseUserId: string;
  mediaType: ContentItem["mediaType"];
  caption?: string | null;
  visibility: string;
  nsfwLabel: NonNullable<ContentItem["nsfwLabel"]>;
}

export interface FindOwnedContentForUploadInput {
  supabaseUserId: string;
  contentId: string;
}

export interface OwnedContentForUpload {
  id: string;
  mediaType: ContentItem["mediaType"];
  caption?: string | null;
}

export interface CreateMediaAssetInput {
  contentId: string;
  provider: "bunny";
  providerAssetId: string;
  providerState: string;
}

export interface MediaUploadProviderSession {
  provider: "bunny";
  providerAssetId: string;
  uploadUrl: string;
  headers: Record<string, string>;
  expiresAt: Date;
}

export interface CreateMediaUploadProviderSessionInput {
  contentId: string;
  title: string;
  mimeType: string;
}

export interface MediaUploadProviderAdapter {
  provider: "bunny";
  isConfigured(): boolean;
  createUploadSession(
    input: CreateMediaUploadProviderSessionInput
  ): Promise<MediaUploadProviderSession>;
}
