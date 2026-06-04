import type { components } from "@veel/contracts";

export type ContentItem = components["schemas"]["ContentItem"];
export type ContentUnlockIntent = components["schemas"]["ContentUnlockIntent"];
export type CreateContentRequest = components["schemas"]["CreateContentRequest"];
export type CreateUploadRequest = components["schemas"]["CreateUploadRequest"];
export type Entitlement = components["schemas"]["Entitlement"];
export type FeedPage = components["schemas"]["FeedPage"];
export type FeedMode = "recommended" | "following" | "nsfw" | "sfw" | "live" | "premium";
export type UploadSession = components["schemas"]["UploadSession"];

export interface ListHomeFeedInput {
  supabaseUserId: string;
  mode: FeedMode;
  cursor?: string;
  limit: number;
}

export interface ContentRepository {
  createDraft(input: CreateContentDraftInput): Promise<ContentItem>;
  createMediaAsset(input: CreateMediaAssetInput): Promise<void>;
  findContentDetail(input: FindContentDetailInput): Promise<ContentItem | null>;
  findContentUnlockOffer(input: FindContentUnlockOfferInput): Promise<ContentUnlockOffer | null>;
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

export interface FindContentDetailInput {
  supabaseUserId: string;
  contentId: string;
}

export interface FindContentUnlockOfferInput {
  supabaseUserId: string;
  contentId: string;
}

export interface ContentUnlockOffer {
  contentId: string;
  alreadyUnlocked: boolean;
  priceMinor: number;
  currency: "SOL";
  entitlement?: Entitlement;
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
