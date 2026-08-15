import type { components } from "@veel/contracts";

export type ContentItem = components["schemas"]["ContentItem"];
export type ContentUnlockIntent = components["schemas"]["ContentUnlockIntent"];
export type CreateContentRequest = components["schemas"]["CreateContentRequest"];
export type CreateUploadRequest = components["schemas"]["CreateUploadRequest"];
export type Entitlement = components["schemas"]["Entitlement"];
export type FeedPage = components["schemas"]["FeedPage"];
export type FeedMode = "recommended" | "following" | "nsfw" | "sfw";
export type FeedSurface = "home" | "bits";
export type UploadSession = components["schemas"]["UploadSession"];
export type UpdateContentRequest = components["schemas"]["UpdateContentRequest"];
export type PublishContentRequest = components["schemas"]["PublishContentRequest"];
export type CreatorMediaPage = components["schemas"]["CreatorMediaPage"];
export type MediaModerationAppeal = components["schemas"]["MediaModerationAppeal"];
export type CreateMediaModerationAppealRequest =
  components["schemas"]["CreateMediaModerationAppealRequest"];

export interface ListHomeFeedInput {
  supabaseUserId: string;
  mode: FeedMode;
  surface: FeedSurface;
  cursor?: string;
  limit: number;
}

export interface ContentRepository {
  createDraft(input: CreateContentDraftInput): Promise<ContentItem>;
  createMediaAsset(input: CreateMediaAssetInput): Promise<{ id: string } | void>;
  countContentDraftsCreatedSince?(input: CountContentQuotaInput): Promise<number>;
  countMediaAssetsCreatedSince?(input: CountContentQuotaInput): Promise<number>;
  getContentCreationAbusePolicy?(): Promise<ContentCreationAbusePolicy | null>;
  findContentDetail(input: FindContentDetailInput): Promise<ContentItem | null>;
  findContentUnlockOffer(input: FindContentUnlockOfferInput): Promise<ContentUnlockOffer | null>;
  findOwnedMediaAssetForSync?(input: FindOwnedMediaAssetForSyncInput): Promise<OwnedMediaAssetForSync | null>;
  findOwnedContentForUpload(input: FindOwnedContentForUploadInput): Promise<OwnedContentForUpload | null>;
  findOwnedContentForUpdate?(input: FindOwnedContentForUploadInput): Promise<OwnedContentForUpload | null>;
  listHomeFeed(input: ListHomeFeedInput): Promise<FeedPage>;
  listOwnedContent?(input: ListOwnedContentInput): Promise<CreatorMediaPage>;
  createModerationAppeal?(input: CreateModerationAppealInput): Promise<MediaModerationAppeal | null>;
  recordMediaProviderWebhook?(input: RecordMediaProviderWebhookInput): Promise<boolean>;
  updateMediaAssetFromWebhook?(input: UpdateMediaAssetFromWebhookInput): Promise<boolean>;
  updateMediaAssetPlayback?(input: UpdateMediaAssetPlaybackInput): Promise<void>;
  updateOwnedContent?(input: UpdateOwnedContentInput): Promise<ContentItem | null>;
  publishOwnedContent?(input: PublishOwnedContentInput): Promise<ContentItem | null>;
  close?(): Promise<void>;
}

export interface ListOwnedContentInput {
  supabaseUserId: string;
  cursor?: string;
  limit: number;
}

export interface CreateModerationAppealInput {
  supabaseUserId: string;
  contentId: string;
  idempotencyKey: string;
  reason: string;
}

export interface CreateContentDraftInput {
  supabaseUserId: string;
  idempotencyKey: string;
  requestHash: string;
  mediaType: ContentItem["mediaType"];
  caption?: string | null | undefined;
  visibility: string;
  nsfwLabel: NonNullable<ContentItem["nsfwLabel"]>;
  representationMode: "not_declared" | NonNullable<CreateContentRequest["representationMode"]>;
  contentSafetyPolicyAccepted: boolean;
  quotaWindowStart: Date;
  dailyDraftQuota: number;
}

export interface CountContentQuotaInput {
  supabaseUserId: string;
  since: Date;
}

export interface ContentCreationAbusePolicy {
  dailyContentDraftQuota?: number | null;
  dailyMediaUploadQuota?: number | null;
  rollingWindowHours?: number | null;
}

export interface UpdateOwnedContentInput {
  supabaseUserId: string;
  contentId: string;
  idempotencyKey: string;
  caption?: string | null | undefined;
  captionProvided: boolean;
  visibility?: string | undefined;
  nsfwLabel?: NonNullable<ContentItem["nsfwLabel"]> | undefined;
  representationMode?: NonNullable<UpdateContentRequest["representationMode"]> | undefined;
  contentSafetyPolicyAccepted: boolean;
  teaserStartMs?: number | null | undefined;
  teaserStartMsProvided: boolean;
  teaserEndMs?: number | null | undefined;
  teaserEndMsProvided: boolean;
  thumbnailFrameMs?: number | null | undefined;
  thumbnailFrameMsProvided: boolean;
  eventDraft?: components["schemas"]["EventDraft"] | undefined;
  eventDraftProvided: boolean;
}

export interface PublishOwnedContentInput {
  supabaseUserId: string;
  contentId: string;
  idempotencyKey: string;
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

export interface FindOwnedMediaAssetForSyncInput {
  supabaseUserId: string;
  mediaAssetId: string;
}

export interface OwnedMediaAssetForSync {
  id: string;
  contentId: string;
  provider: "bunny";
  providerAssetId: string;
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
  nsfwLabel: NonNullable<ContentItem["nsfwLabel"]>;
}

export interface CreateMediaAssetInput {
  contentId: string;
  provider: "bunny";
  providerAssetId: string;
  providerState: string;
}

export interface UpdateMediaAssetPlaybackInput {
  mediaAssetId: string;
  providerState: string;
  providerPlayable: boolean;
  playbackUrl?: string | null;
  posterUrl?: string | null;
  durationMs?: number | null;
}

export interface RecordMediaProviderWebhookInput {
  provider: "bunny" | "livepeer";
  providerEventId: string;
  eventType: string;
  normalizedState: string;
  signatureHash?: string | null;
  replayPayload?: Record<string, unknown>;
}

export interface UpdateMediaAssetFromWebhookInput {
  provider: "bunny" | "livepeer";
  providerEventId: string;
  providerAssetId: string;
  providerState: string;
  providerPlayable: boolean;
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
  createPlaybackResource?(
    input: CreateMediaPlaybackResourceInput
  ): NonNullable<ContentItem["playback"]>;
  getPlaybackData?(input: GetMediaPlaybackProviderDataInput): Promise<MediaPlaybackProviderData>;
}

export interface CreateMediaPlaybackResourceInput {
  providerAssetId: string;
  now?: Date;
}

export interface GetMediaPlaybackProviderDataInput {
  providerAssetId: string;
}

export interface MediaPlaybackProviderData {
  providerState: string;
  providerPlayable: boolean;
  playbackUrl?: string | null;
  posterUrl?: string | null;
  durationMs?: number | null;
}
