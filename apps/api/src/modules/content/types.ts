import type { components } from "@veel/contracts";

export type ContentItem = components["schemas"]["ContentItem"];
export type ContentUnlockIntent = components["schemas"]["ContentUnlockIntent"];
export type CreateContentRequest = components["schemas"]["CreateContentRequest"];
export type CreateUploadRequest = components["schemas"]["CreateUploadRequest"];
export type Entitlement = components["schemas"]["Entitlement"];
export type FeedPage = components["schemas"]["FeedPage"];
export type FeedMode = "recommended" | "following";
export type FeedSurface = "home" | "bits";
export type UploadSession = components["schemas"]["UploadSession"];
export type UpdateContentRequest = components["schemas"]["UpdateContentRequest"];
export type PublishContentRequest = components["schemas"]["PublishContentRequest"];
export type VoteOnContentPollRequest = components["schemas"]["VoteOnContentPollRequest"];
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
  captureProviderObservationCutoff?(): Promise<Date>;
  createDraft(input: CreateContentDraftInput): Promise<ContentItem>;
  createMediaAsset(input: CreateMediaAssetInput): Promise<{ id: string } | void>;
  reserveImageAssetUpload?(input: ReserveImageAssetUploadInput): Promise<ReservedImageAssetUpload>;
  completeImageAssetUpload?(input: CompleteImageAssetUploadInput): Promise<void>;
  updateOwnedMediaAsset?(input: UpdateOwnedMediaAssetInput): Promise<MediaAssetMutationResult | null>;
  retireOwnedMediaAsset?(input: RetireOwnedMediaAssetInput): Promise<RetiredMediaAssetResult | null>;
  completeMediaAssetCleanup?(input: CompleteMediaAssetCleanupInput): Promise<void>;
  countContentDraftsCreatedSince?(input: CountContentQuotaInput): Promise<number>;
  countMediaAssetsCreatedSince?(input: CountContentQuotaInput): Promise<number>;
  getContentCreationAbusePolicy?(): Promise<ContentCreationAbusePolicy | null>;
  findContentDetail(input: FindContentDetailInput): Promise<ContentItem | null>;
  findContentUnlockOffer(input: FindContentUnlockOfferInput): Promise<ContentUnlockOffer | null>;
  findMediaAssetByProviderAsset?(input: FindMediaAssetByProviderAssetInput): Promise<{ id: string } | null>;
  findOwnedMediaAssetForSync?(input: FindOwnedMediaAssetForSyncInput): Promise<OwnedMediaAssetForSync | null>;
  findOwnedContentForUpload(input: FindOwnedContentForUploadInput): Promise<OwnedContentForUpload | null>;
  findOwnedContentForUpdate?(input: FindOwnedContentForUploadInput): Promise<OwnedContentForUpload | null>;
  listHomeFeed(input: ListHomeFeedInput): Promise<FeedPage>;
  listOwnedContent?(input: ListOwnedContentInput): Promise<CreatorMediaPage>;
  findOwnedPrivateDraftReadiness?(input: {
    supabaseUserId: string;
    contentId: string;
  }): Promise<ContentDraftReadiness | null>;
  issueMcpMediaUploadCapability?(input: IssueMcpMediaUploadCapabilityInput): Promise<IssuedMcpMediaUploadCapability | null>;
  claimMcpMediaUploadCapability?(input: ClaimMcpMediaUploadCapabilityInput): Promise<ClaimedMcpMediaUploadCapability>;
  completeMcpMediaUploadCapability?(input: CompleteMcpMediaUploadCapabilityInput): Promise<McpMediaUploadCompletion>;
  releaseMcpMediaUploadCapability?(input: ReleaseMcpMediaUploadCapabilityInput): Promise<void>;
  scheduleMcpMediaProviderCleanup?(input: ScheduleMcpMediaProviderCleanupInput): Promise<void>;
  findOwnedPrivateMediaReadiness?(input: FindOwnedPrivateMediaReadinessInput): Promise<PrivateMediaReadiness | null>;
  reviewOwnedMediaAssetProvenance?(input: ReviewOwnedMediaAssetProvenanceInput): Promise<MediaAssetMutationResult | null>;
  createModerationAppeal?(input: CreateModerationAppealInput): Promise<MediaModerationAppeal | null>;
  recordMediaProviderWebhook?(input: RecordMediaProviderWebhookInput): Promise<boolean>;
  updateMediaAssetFromWebhook?(input: UpdateMediaAssetFromWebhookInput): Promise<boolean>;
  updateMediaAssetPlayback?(input: UpdateMediaAssetPlaybackInput): Promise<void>;
  updateOwnedContent?(input: UpdateOwnedContentInput): Promise<ContentItem | null>;
  publishOwnedContent?(input: PublishOwnedContentInput): Promise<ContentItem | null>;
  voteOnPoll?(input: VoteOnContentPollInput): Promise<NonNullable<ContentItem["poll"]> | null>;
  close?(): Promise<void>;
}

export interface ContentDraftReadiness {
  contentId: string;
  mediaType: ContentItem["mediaType"];
  publicationState: CreatorMediaPage["items"][number]["publicationState"];
  reviewState: string;
  reviewRequestEligible: boolean;
  assetCount: number;
  blockers: string[];
  nextAction: "continue_in_wevid" | "wait_for_processing" | "resolve_review" | "none";
}

export type McpMediaKind = "image" | "video";
export type McpMediaMimeType =
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "video/mp4"
  | "video/quicktime"
  | "video/webm";
export type AiOriginClassification =
  | "ai_assisted"
  | "ai_generated"
  | "materially_ai_manipulated";
export type MediaSourceKind = "generated" | "edited" | "composited" | "unknown";

export interface McpMediaProvenanceClaim {
  originClassification: AiOriginClassification;
  sourceKind: MediaSourceKind;
  sourceLineageReference?: string | null;
  workflowProviderReference?: string | null;
  c2paReference?: string | null;
}

export interface IssueMcpMediaUploadCapabilityInput extends McpMediaProvenanceClaim {
  connectionId: string;
  supabaseUserId: string;
  contentId: string;
  requestHash: string;
  tokenHash: string;
  mediaKind: McpMediaKind;
  mimeType: McpMediaMimeType;
  expiresAt: Date;
}

export interface IssuedMcpMediaUploadCapability {
  id: string;
  contentId: string;
  mediaAssetId: string;
  mediaKind: McpMediaKind;
  mimeType: McpMediaMimeType;
  expiresAt: string;
  issued: boolean;
}

export interface ClaimMcpMediaUploadCapabilityInput {
  capabilityId: string;
  connectionId: string;
  supabaseUserId: string;
  tokenHash: string;
  declaredMimeType: string | null;
  quotaWindowStart: Date;
  dailyMediaUploadQuota: number;
  leaseToken: string;
  leasedUntil: Date;
}

export interface ClaimedMcpMediaUploadCapability extends McpMediaProvenanceClaim {
  id: string;
  contentId: string;
  mediaAssetId: string;
  mediaKind: McpMediaKind;
  mimeType: McpMediaMimeType;
  leaseToken: string;
}

export interface CompleteMcpMediaUploadCapabilityInput {
  capabilityId: string;
  connectionId: string;
  leaseToken: string;
  providerAssetId: string;
  providerState: "stored_private" | "upload_pending";
  widthPixels?: number;
  heightPixels?: number;
  checksumSha256?: string;
}

export interface McpMediaUploadCompletion {
  mediaAssetId: string;
  contentId: string;
  compositionRevision: number;
}

export interface ReleaseMcpMediaUploadCapabilityInput {
  capabilityId: string;
  connectionId: string;
  leaseToken: string;
  failureCode: string;
}

export interface ScheduleMcpMediaProviderCleanupInput {
  capabilityId: string;
  connectionId: string;
  leaseToken: string;
  providerAssetId: string;
  failureCode: string;
}

export interface FindOwnedPrivateMediaReadinessInput {
  supabaseUserId: string;
  contentId: string;
}

export interface PrivateMediaReadiness {
  contentId: string;
  compositionRevision: number;
  assets: Array<{
    mediaAssetId: string;
    kind: McpMediaKind;
    mimeType: McpMediaMimeType | null;
    providerState: "upload_pending" | "processing" | "ready" | "failed";
    quarantineState: "pending" | "approved" | "blocked";
    provenanceReviewState: "not_required" | "pending" | "confirmed" | "rejected";
    visibleLabelState: "none" | "ai_assisted" | "ai_generated" | "manipulated";
    machineReadableMarkingState: "unavailable" | "pending" | "present" | "invalid";
  }>;
  blockers: string[];
}

export interface ReviewOwnedMediaAssetProvenanceInput {
  supabaseUserId: string;
  mediaAssetId: string;
  idempotencyKey: string;
  requestHash: string;
  expectedCompositionRevision: number;
  decision: "confirmed" | "rejected";
}

export interface VoteOnContentPollInput {
  appUserId: string;
  contentId: string;
  optionId: string;
  idempotencyKey: string;
  requestHash: string;
}

export interface ListOwnedContentInput {
  supabaseUserId: string;
  cursor?: string;
  limit: number;
  privateDraftsOnly?: boolean;
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
  bodyText?: string | null | undefined;
  poll?: components["schemas"]["ContentPollDraft"] | undefined;
  visibility: string;
  nsfwLabel: NonNullable<ContentItem["nsfwLabel"]>;
  representationMode: "not_declared" | NonNullable<CreateContentRequest["representationMode"]>;
  contentSafetyPolicyAccepted: boolean;
  quotaWindowStart: Date;
  dailyDraftQuota: number;
  origin?: {
    kind: "mcp";
    connectionId: string;
    toolName: "creator_create_private_draft";
    toolVersion: string;
    requestHash: string;
  };
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
  bodyText?: string | undefined;
  bodyTextProvided: boolean;
  expectedCompositionRevision?: number | undefined;
  assetOrder?: string[] | undefined;
  requestHash?: string | undefined;
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

export interface FindMediaAssetByProviderAssetInput {
  provider: "bunny" | "livepeer";
  providerAssetId: string;
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
  supabaseUserId: string;
  contentId: string;
  provider: "bunny";
  providerAssetId: string;
  providerState: string;
  quotaWindowStart: Date;
  dailyMediaUploadQuota: number;
}

export interface ReserveImageAssetUploadInput {
  supabaseUserId: string;
  contentId: string;
  mediaAssetId: string;
  idempotencyKey: string;
  requestHash: string;
  providerAssetId: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  widthPixels: number;
  heightPixels: number;
  checksumSha256: string;
  quotaWindowStart: Date;
  dailyMediaUploadQuota: number;
}

export interface ReservedImageAssetUpload {
  mediaAssetId: string;
  providerAssetId: string;
  completed: boolean;
}

export interface CompleteImageAssetUploadInput {
  mediaAssetId: string;
  providerAssetId: string;
}

export interface UpdateOwnedMediaAssetInput {
  supabaseUserId: string;
  mediaAssetId: string;
  idempotencyKey: string;
  requestHash: string;
  expectedCompositionRevision: number;
  altText?: string | null;
  altTextProvided: boolean;
  originClassification?:
    | "human_created"
    | "ai_assisted"
    | "ai_generated"
    | "materially_ai_manipulated";
}

export interface MediaAssetMutationResult {
  compositionRevision: number;
  asset: NonNullable<ContentItem["mediaAssets"]>[number];
}

export interface RetireOwnedMediaAssetInput {
  supabaseUserId: string;
  mediaAssetId: string;
  idempotencyKey: string;
  requestHash: string;
  expectedCompositionRevision: number;
  reason: string;
}

export interface RetiredMediaAssetResult {
  contentId: string;
  mediaAssetId: string;
  compositionRevision: number;
  cleanupState: "pending" | "retry" | "completed";
  provider: "bunny" | "livepeer";
  providerAssetId: string;
  assetKind: "image" | "video";
}

export interface CompleteMediaAssetCleanupInput {
  supabaseUserId: string;
  mediaAssetId: string;
  idempotencyKey: string;
  succeeded: boolean;
  errorCode?: string;
}

export interface UpdateMediaAssetPlaybackInput {
  mediaAssetId: string;
  providerObservationCutoff: Date;
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
  preventStateRegression?: boolean;
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
  ttlSeconds?: number;
}

export interface MediaUploadProviderAdapter {
  provider: "bunny";
  isConfigured(): boolean;
  createUploadSession(
    input: CreateMediaUploadProviderSessionInput
  ): Promise<MediaUploadProviderSession>;
  isImageUploadConfigured?(): boolean;
  createImageObjectReference?(input: {
    contentId: string;
    mediaAssetId: string;
    extension: "jpg" | "png" | "webp";
    uploadAttemptId?: string;
  }): string;
  uploadImageObject?(input: {
    providerAssetId: string;
    body: Buffer;
    mimeType: "image/jpeg" | "image/png" | "image/webp";
    checksumSha256: string;
  }): Promise<void>;
  deleteProviderAsset?(input: {
    providerAssetId: string;
    assetKind: "image" | "video";
  }): Promise<void>;
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
