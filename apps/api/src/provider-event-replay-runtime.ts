import type { ServerEnv } from "@veel/config";
import { createPostgresContentRepository } from "./modules/content/content-repository.js";
import { createBunnyStreamUploadAdapter } from "./modules/content/media-upload-adapter.js";
import type {
  ContentRepository,
  GetMediaPlaybackProviderDataInput,
  MediaPlaybackProviderData
} from "./modules/content/types.js";
import { createPostgresLiveRepository } from "./modules/live/live-repository.js";
import type { LiveRepository } from "./modules/live/types.js";
import {
  createPostgresPaymentEvidenceRepository,
  createPostgresPaymentRepository
} from "./modules/payment/payment-repository.js";
import { PaymentSubmissionWriteConflictError } from "./modules/payment/payment-submission.js";
import { createSolanaRpcSettlementVerifier, paymentMemo } from "./modules/payment/solana-payment.js";
import type {
  PaymentEvidenceRepository,
  PaymentRepository,
  RecordPaymentSubmissionInput,
  PaymentSettlementVerifier,
  StoredPaymentIntent
} from "./modules/payment/types.js";
import { createPostgresClient } from "./shared/postgres.js";

export type ProviderReplayOutcome =
  | { state: "replayed" }
  | { state: "failed"; failureCode: string };

export interface HeliusProviderReplayEvent {
  provider: "helius" | "solana_indexer";
  providerEventId: string;
  replayPayload: {
    kind: "solana_payment";
    signature: string;
    referenceAddresses: string[];
  };
}

export interface BunnyProviderReplayEvent {
  providerEventId: string;
  replayPayload: {
    kind: "media_asset";
    providerAssetId: string;
    providerState: string;
    providerPlayable: boolean;
  };
}

export interface LivepeerProviderReplayEvent {
  providerEventId: string;
  replayPayload: {
    kind: "livepeer_stream";
    providerStreamId: string;
    providerPlaybackId: string | null;
    providerState: string;
    roomState: "waiting" | "live" | "ended" | "replay_ready";
    playbackUrl: string | null;
  };
}

export interface CanonicalProviderReplayHandlers {
  helius(input: HeliusProviderReplayEvent): Promise<ProviderReplayOutcome>;
  bunny(input: BunnyProviderReplayEvent): Promise<ProviderReplayOutcome>;
  livepeer(input: LivepeerProviderReplayEvent): Promise<ProviderReplayOutcome>;
}

interface ProviderReplayDependencies {
  contentRepository: Required<Pick<
    ContentRepository,
    | "captureProviderObservationCutoff"
    | "findMediaAssetByProviderAsset"
    | "updateMediaAssetFromWebhook"
    | "updateMediaAssetPlayback"
  >>;
  mediaPlaybackProvider: {
    getPlaybackData(input: GetMediaPlaybackProviderDataInput): Promise<MediaPlaybackProviderData>;
  };
  liveRepository: Pick<LiveRepository, "updateRoomFromWebhook">;
  paymentEvidenceRepository: PaymentEvidenceRepository;
  paymentRepository: Pick<PaymentRepository, "recordSubmission">;
  settlementVerifier: PaymentSettlementVerifier;
}

export function createCanonicalProviderReplayHandlers(
  dependencies: ProviderReplayDependencies
): CanonicalProviderReplayHandlers {
  return {
    async bunny(input) {
      const mediaAsset = await dependencies.contentRepository.findMediaAssetByProviderAsset({
        provider: "bunny",
        providerAssetId: input.replayPayload.providerAssetId
      });

      if (!mediaAsset) {
        return {
          state: "failed",
          failureCode: "provider_event_replay_media_asset_not_found"
        };
      }

      const providerObservationCutoff =
        await dependencies.contentRepository.captureProviderObservationCutoff();
      const playbackData = await dependencies.mediaPlaybackProvider.getPlaybackData({
        providerAssetId: input.replayPayload.providerAssetId
      });
      const applied = await dependencies.contentRepository.updateMediaAssetFromWebhook({
        provider: "bunny",
        providerEventId: input.providerEventId,
        providerAssetId: input.replayPayload.providerAssetId,
        providerState: input.replayPayload.providerState,
        providerPlayable: input.replayPayload.providerPlayable,
        preventStateRegression: true
      });

      if (applied) {
        await dependencies.contentRepository.updateMediaAssetPlayback({
          mediaAssetId: mediaAsset.id,
          providerObservationCutoff,
          ...playbackData
        });
      }

      return applied
        ? { state: "replayed" }
        : {
            state: "failed",
            failureCode: "provider_event_replay_media_asset_not_found"
          };
    },

    async livepeer(input) {
      const applied = await dependencies.liveRepository.updateRoomFromWebhook?.({
        providerEventId: input.providerEventId,
        providerStreamId: input.replayPayload.providerStreamId,
        providerPlaybackId: input.replayPayload.providerPlaybackId,
        providerState: input.replayPayload.providerState,
        state: input.replayPayload.roomState,
        playbackUrl: input.replayPayload.playbackUrl,
        preventStateRegression: true
      });

      return applied
        ? { state: "replayed" }
        : {
            state: "failed",
            failureCode: "provider_event_replay_live_room_not_found"
          };
    },

    async helius(input) {
      const match = await dependencies.paymentEvidenceRepository.findIntentByReference({
        referenceAddresses: input.replayPayload.referenceAddresses,
        includeConfirmed: true,
        submissionSignature: input.replayPayload.signature
      });

      if (!match) {
        await dependencies.paymentEvidenceRepository.updateSolanaProviderEvent({
          provider: input.provider,
          providerEventId: input.providerEventId,
          normalizedState: "ignored"
        });
        return { state: "replayed" };
      }

      if (match.intent.state === "confirmed") {
        await dependencies.paymentEvidenceRepository.updateSolanaProviderEvent({
          provider: input.provider,
          providerEventId: input.providerEventId,
          normalizedState: "processed"
        });
        return { state: "replayed" };
      }

      const settlement = await dependencies.settlementVerifier.verifyTransfer({
        signature: input.replayPayload.signature,
        referenceAddress: match.intent.referenceAddress,
        memo: paymentMemo(match.intent.id),
        settlementKind: match.intent.settlementKind,
        buyerWallet: match.intent.buyerWallet,
        creatorWallet: match.intent.creatorWallet,
        enterpriseWallet: match.intent.enterpriseWallet,
        platformFeeWallet: match.intent.platformFeeWallet,
        referralWallet: match.intent.referralWallet,
        treasuryWallet: match.intent.treasuryWallet,
        totalAmountMinor: match.intent.totalAmountMinor,
        creatorAmountMinor: match.intent.creatorAmountMinor,
        enterpriseManagementAmountMinor: match.intent.enterpriseManagementAmountMinor,
        platformFeeAmountMinor: match.intent.platformFeeAmountMinor,
        referralAmountMinor: match.intent.referralAmountMinor,
        currency: match.intent.currency,
        tokenMint: match.intent.tokenMint ?? null,
        tokenDecimals: match.intent.tokenDecimals ?? null,
        expiresAt: match.intent.expiresAt
      });
      const writeGuard = paymentReplayWriteGuard(
        match.intent.state,
        input.replayPayload.signature
      );

      if (!writeGuard) {
        await dependencies.paymentEvidenceRepository.updateSolanaProviderEvent({
          provider: input.provider,
          providerEventId: input.providerEventId,
          normalizedState: "ignored"
        });
        return { state: "replayed" };
      }

      try {
        await dependencies.paymentRepository.recordSubmission({
          supabaseUserId: match.supabaseUserId,
          paymentIntentId: match.intent.id,
          signature: input.replayPayload.signature,
          settlement,
          writeGuard
        });
      } catch (error) {
        if (!(error instanceof PaymentSubmissionWriteConflictError)) throw error;

        const refreshedMatch = await dependencies.paymentEvidenceRepository.findIntentByReference({
          referenceAddresses: input.replayPayload.referenceAddresses,
          includeConfirmed: true,
          submissionSignature: input.replayPayload.signature
        });
        if (!refreshedMatch) {
          await dependencies.paymentEvidenceRepository.updateSolanaProviderEvent({
            provider: input.provider,
            providerEventId: input.providerEventId,
            normalizedState: "ignored"
          });
          return { state: "replayed" };
        }
        if (refreshedMatch.intent.state === "confirmed") {
          await dependencies.paymentEvidenceRepository.updateSolanaProviderEvent({
            provider: input.provider,
            providerEventId: input.providerEventId,
            normalizedState: "processed"
          });
          return { state: "replayed" };
        }
        return {
          state: "failed",
          failureCode: "provider_event_replay_submission_changed"
        };
      }
      await dependencies.paymentEvidenceRepository.updateSolanaProviderEvent({
        provider: input.provider,
        providerEventId: input.providerEventId,
        normalizedState: settlement.confirmed ? "processed" : "failed"
      });

      return settlement.confirmed
        ? { state: "replayed" }
        : {
            state: "failed",
            failureCode: `provider_event_replay_settlement_${settlement.failureCode ?? "unconfirmed"}`
          };
    }
  };
}

function paymentReplayWriteGuard(
  state: StoredPaymentIntent["state"],
  signature: string
): RecordPaymentSubmissionInput["writeGuard"] | null {
  if (state === "pending" || state === "transaction_requested") {
    return { state, submittedSignature: null };
  }
  if (state === "submitted") {
    return { state, submittedSignature: signature };
  }
  return null;
}

export function createCanonicalProviderReplayRuntime(config: Pick<
  ServerEnv,
  "DATABASE_URL" | "SOLANA_RPC_URL" | "PAYMENT_SOLANA_FINALITY"
> & Partial<Pick<
  ServerEnv,
  | "BUNNY_STREAM_API_KEY"
  | "BUNNY_STREAM_EMBED_TOKEN_KEY"
  | "BUNNY_STREAM_LIBRARY_ID"
  | "BUNNY_STREAM_PLAYBACK_TOKEN_TTL_SECONDS"
>>, overrides: {
  mediaPlaybackProvider?: ProviderReplayDependencies["mediaPlaybackProvider"];
} = {}): {
  handlers: CanonicalProviderReplayHandlers;
  close(): Promise<void>;
} {
  if (!config.DATABASE_URL) {
    throw new Error("DATABASE_URL_NOT_CONFIGURED");
  }

  const sql = createPostgresClient(config.DATABASE_URL);
  const bunnyProvider = createBunnyStreamUploadAdapter(config);
  const handlers = createCanonicalProviderReplayHandlers({
    contentRepository: createPostgresContentRepository(sql),
    liveRepository: createPostgresLiveRepository(sql),
    paymentEvidenceRepository: createPostgresPaymentEvidenceRepository(sql),
    paymentRepository: createPostgresPaymentRepository(sql),
    settlementVerifier: createSolanaRpcSettlementVerifier(
      config.SOLANA_RPC_URL,
      config.PAYMENT_SOLANA_FINALITY
    ),
    mediaPlaybackProvider: overrides.mediaPlaybackProvider ?? {
      async getPlaybackData(input) {
        if (!bunnyProvider.getPlaybackData) {
          throw new Error("BUNNY_PLAYBACK_RECONCILIATION_NOT_CONFIGURED");
        }
        return bunnyProvider.getPlaybackData(input);
      }
    }
  });

  return {
    handlers,
    async close() {
      await sql.end({ timeout: 5 });
    }
  };
}
