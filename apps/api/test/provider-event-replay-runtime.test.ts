import { describe, expect, it, vi } from "vitest";
import type {
  PaymentEvidenceRepository,
  PaymentSettlementVerifier,
  StoredPaymentIntent
} from "../src/modules/payment/types";
import { createCanonicalProviderReplayHandlers } from "../src/provider-event-replay-runtime";

describe("canonical provider event replay handlers", () => {
  it("reapplies a normalized Bunny event through the canonical media repository", async () => {
    const dependencies = replayDependencies();
    const handlers = createCanonicalProviderReplayHandlers(dependencies);

    await expect(handlers.bunny({
      providerEventId: "bunny-delivery-1",
      replayPayload: {
        kind: "media_asset",
        providerAssetId: "asset-1",
        providerState: "ready",
        providerPlayable: true
      }
    })).resolves.toEqual({ state: "replayed" });

    expect(dependencies.contentRepository.updateMediaAssetFromWebhook).toHaveBeenCalledWith({
      provider: "bunny",
      providerEventId: "bunny-delivery-1",
      providerAssetId: "asset-1",
      providerState: "ready",
      providerPlayable: true
    });
  });

  it("keeps a missing media target retryable instead of claiming recovery", async () => {
    const dependencies = replayDependencies();
    vi.mocked(dependencies.contentRepository.updateMediaAssetFromWebhook).mockResolvedValue(false);
    const handlers = createCanonicalProviderReplayHandlers(dependencies);

    await expect(handlers.bunny({
      providerEventId: "bunny-delivery-1",
      replayPayload: {
        kind: "media_asset",
        providerAssetId: "missing-asset",
        providerState: "ready",
        providerPlayable: true
      }
    })).resolves.toEqual({
      state: "failed",
      failureCode: "provider_event_replay_media_asset_not_found"
    });
  });

  it("reapplies Livepeer room and replay transitions through the canonical live repository", async () => {
    const dependencies = replayDependencies();
    const handlers = createCanonicalProviderReplayHandlers(dependencies);

    await expect(handlers.livepeer({
      providerEventId: "livepeer-delivery-1",
      replayPayload: {
        kind: "livepeer_stream",
        providerStreamId: "stream-1",
        providerPlaybackId: "playback-1",
        providerState: "recording_ready",
        roomState: "replay_ready",
        playbackUrl: "https://playback.example/replay.m3u8"
      }
    })).resolves.toEqual({ state: "replayed" });

    expect(dependencies.liveRepository.updateRoomFromWebhook).toHaveBeenCalledWith({
      providerEventId: "livepeer-delivery-1",
      providerStreamId: "stream-1",
      providerPlaybackId: "playback-1",
      providerState: "recording_ready",
      state: "replay_ready",
      playbackUrl: "https://playback.example/replay.m3u8"
    });
  });

  it("re-verifies Solana settlement and reuses the canonical payment submission authority", async () => {
    const dependencies = replayDependencies();
    const handlers = createCanonicalProviderReplayHandlers(dependencies);

    await expect(handlers.helius(heliusEvent())).resolves.toEqual({ state: "replayed" });

    expect(dependencies.paymentEvidenceRepository.findIntentByReference).toHaveBeenCalledWith({
      referenceAddresses: ["reference-address"],
      includeConfirmed: true
    });
    expect(dependencies.settlementVerifier.verifyTransfer).toHaveBeenCalledWith(
      expect.objectContaining({
        signature: "solana-signature",
        referenceAddress: "reference-address",
        memo: "veel:payment-intent-1"
      })
    );
    expect(dependencies.paymentRepository.recordSubmission).toHaveBeenCalledWith({
      supabaseUserId: "supabase-user-1",
      paymentIntentId: "payment-intent-1",
      signature: "solana-signature",
      settlement: { confirmed: true, blockTime: new Date("2026-06-06T00:00:00.000Z") }
    });
    expect(dependencies.paymentEvidenceRepository.updateSolanaProviderEvent).toHaveBeenCalledWith({
      providerEventId: "helius-delivery-1",
      normalizedState: "processed"
    });
  });

  it("treats an already-confirmed intent as recovered without a second RPC or settlement write", async () => {
    const dependencies = replayDependencies({ intentState: "confirmed" });
    const handlers = createCanonicalProviderReplayHandlers(dependencies);

    await expect(handlers.helius(heliusEvent())).resolves.toEqual({ state: "replayed" });

    expect(dependencies.settlementVerifier.verifyTransfer).not.toHaveBeenCalled();
    expect(dependencies.paymentRepository.recordSubmission).not.toHaveBeenCalled();
    expect(dependencies.paymentEvidenceRepository.updateSolanaProviderEvent).toHaveBeenCalledWith({
      providerEventId: "helius-delivery-1",
      normalizedState: "processed"
    });
  });

  it("marks an unmatched Solana delivery ignored without attempting settlement", async () => {
    const dependencies = replayDependencies();
    vi.mocked(dependencies.paymentEvidenceRepository.findIntentByReference).mockResolvedValue(null);
    const handlers = createCanonicalProviderReplayHandlers(dependencies);

    await expect(handlers.helius(heliusEvent())).resolves.toEqual({ state: "replayed" });

    expect(dependencies.settlementVerifier.verifyTransfer).not.toHaveBeenCalled();
    expect(dependencies.paymentRepository.recordSubmission).not.toHaveBeenCalled();
    expect(dependencies.paymentEvidenceRepository.updateSolanaProviderEvent).toHaveBeenCalledWith({
      providerEventId: "helius-delivery-1",
      normalizedState: "ignored"
    });
  });

  it("keeps an unconfirmed Solana event retryable and records the normalized failure", async () => {
    const dependencies = replayDependencies({ settlementConfirmed: false });
    const handlers = createCanonicalProviderReplayHandlers(dependencies);

    await expect(handlers.helius(heliusEvent())).resolves.toEqual({
      state: "failed",
      failureCode: "provider_event_replay_settlement_not_found"
    });

    expect(dependencies.paymentEvidenceRepository.updateSolanaProviderEvent).toHaveBeenCalledWith({
      providerEventId: "helius-delivery-1",
      normalizedState: "failed"
    });
  });
});

function replayDependencies(input: {
  intentState?: StoredPaymentIntent["state"];
  settlementConfirmed?: boolean;
} = {}) {
  const intent = storedPaymentIntent(input.intentState ?? "pending");
  const paymentEvidenceRepository = {
    recordSolanaProviderEvent: vi.fn(),
    findIntentByReference: vi.fn().mockResolvedValue({
      supabaseUserId: "supabase-user-1",
      intent
    }),
    updateSolanaProviderEvent: vi.fn()
  } satisfies PaymentEvidenceRepository;
  const settlementVerifier = {
    verifyTransfer: vi.fn().mockResolvedValue(
      input.settlementConfirmed === false
        ? { confirmed: false, failureCode: "not_found" }
        : { confirmed: true, blockTime: new Date("2026-06-06T00:00:00.000Z") }
    )
  } satisfies PaymentSettlementVerifier;

  return {
    contentRepository: {
      updateMediaAssetFromWebhook: vi.fn().mockResolvedValue(true)
    },
    liveRepository: {
      updateRoomFromWebhook: vi.fn().mockResolvedValue(true)
    },
    paymentEvidenceRepository,
    paymentRepository: {
      recordSubmission: vi.fn()
    },
    settlementVerifier
  };
}

function heliusEvent() {
  return {
    providerEventId: "helius-delivery-1",
    replayPayload: {
      kind: "solana_payment" as const,
      signature: "solana-signature",
      referenceAddresses: ["reference-address"]
    }
  };
}

function storedPaymentIntent(state: StoredPaymentIntent["state"]): StoredPaymentIntent {
  return {
    id: "payment-intent-1",
    productType: "support",
    targetId: "creator-1",
    amountMinor: 10_000_000,
    currency: "SOL",
    state,
    settlementKind: "creator_split",
    buyerWallet: null,
    creatorWallet: "creator-wallet",
    enterpriseWallet: null,
    platformFeeWallet: "platform-wallet",
    referralWallet: null,
    treasuryWallet: "treasury-wallet",
    totalAmountMinor: 10_000_000,
    creatorSideProceedsMinor: 9_000_000,
    creatorAmountMinor: 9_000_000,
    enterpriseManagementAmountMinor: 0,
    platformFeeGrossMinor: 1_000_000,
    platformFeeAmountMinor: 1_000_000,
    referralAmountMinor: 0,
    referenceAddress: "reference-address",
    solanaCluster: "devnet",
    expiresAt: new Date("2026-06-06T00:15:00.000Z"),
    quotedAt: new Date("2026-06-06T00:00:00.000Z"),
    minimumAmountMinor: 1_000_000,
    platformFeeBps: 1_000,
    referralShareOfPlatformFeeBps: 2_000,
    commercialPolicySource: "environment_default",
    commercialPolicyRevision: 0,
    requestHash: "request-hash",
    withdrawalWaiverRequired: false,
    withdrawalWaiverAcceptedAt: null,
    withdrawalWaiverVersion: null,
    termsVersion: null,
    durableConfirmationRequired: true,
    refundValueBasis: "original_crypto_amount",
    refundPolicy: {
      withdrawalWaiverRequired: false,
      withdrawalWaiverAcceptedAt: null,
      withdrawalWaiverVersion: "2026-01",
      termsVersion: "2026-01",
      durableConfirmationRequired: true,
      refundValueBasis: "original_crypto_amount"
    },
    quote: {
      minimumAmountMinor: 1_000_000,
      platformFeeBps: 1_000,
      referralShareOfPlatformFeeBps: 2_000,
      quotedAt: "2026-06-06T00:00:00.000Z",
      expiresAt: "2026-06-06T00:15:00.000Z",
      policySource: "environment_default",
      policyRevision: 0
    }
  };
}
