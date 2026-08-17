import type { ServerEnv } from "@veel/config";
import { createPostgresContentRepository } from "./modules/content/content-repository.js";
import type { ContentRepository } from "./modules/content/types.js";
import { createPostgresLiveRepository } from "./modules/live/live-repository.js";
import type { LiveRepository } from "./modules/live/types.js";
import {
  createPostgresPaymentEvidenceRepository,
  createPostgresPaymentRepository
} from "./modules/payment/payment-repository.js";
import { createSolanaRpcSettlementVerifier, paymentMemo } from "./modules/payment/solana-payment.js";
import type {
  PaymentEvidenceRepository,
  PaymentRepository,
  PaymentSettlementVerifier
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
  contentRepository: Pick<ContentRepository, "updateMediaAssetFromWebhook">;
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
      const applied = await dependencies.contentRepository.updateMediaAssetFromWebhook?.({
        provider: "bunny",
        providerEventId: input.providerEventId,
        providerAssetId: input.replayPayload.providerAssetId,
        providerState: input.replayPayload.providerState,
        providerPlayable: input.replayPayload.providerPlayable,
        preventStateRegression: true
      });

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
        includeConfirmed: true
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

      await dependencies.paymentRepository.recordSubmission({
        supabaseUserId: match.supabaseUserId,
        paymentIntentId: match.intent.id,
        signature: input.replayPayload.signature,
        settlement
      });
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

export function createCanonicalProviderReplayRuntime(config: Pick<
  ServerEnv,
  "DATABASE_URL" | "SOLANA_RPC_URL" | "PAYMENT_SOLANA_FINALITY"
>): {
  handlers: CanonicalProviderReplayHandlers;
  close(): Promise<void>;
} {
  if (!config.DATABASE_URL) {
    throw new Error("DATABASE_URL_NOT_CONFIGURED");
  }

  const sql = createPostgresClient(config.DATABASE_URL);
  const handlers = createCanonicalProviderReplayHandlers({
    contentRepository: createPostgresContentRepository(sql),
    liveRepository: createPostgresLiveRepository(sql),
    paymentEvidenceRepository: createPostgresPaymentEvidenceRepository(sql),
    paymentRepository: createPostgresPaymentRepository(sql),
    settlementVerifier: createSolanaRpcSettlementVerifier(
      config.SOLANA_RPC_URL,
      config.PAYMENT_SOLANA_FINALITY
    )
  });

  return {
    handlers,
    async close() {
      await sql.end({ timeout: 5 });
    }
  };
}
