import { createHash, createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { buildApi } from "../src/app";
import { AdminRepositoryStateConflictError } from "../src/modules/admin/admin-repository";
import type { AdminRepository } from "../src/modules/admin/types";
import type { ActivityRepository } from "../src/modules/activity/types";
import { createBunnyStreamUploadAdapter } from "../src/modules/content/media-upload-adapter";
import type {
  ContentItem,
  ContentRepository,
  CreateMediaAssetInput,
  MediaUploadProviderAdapter
} from "../src/modules/content/types";
import type {
  AgeProviderWaterfall,
  AgeRepository,
  CreatePendingAgeVerificationInput
} from "../src/modules/age/types";
import type { AiRepository, AiSession, AiToolCall } from "../src/modules/ai/types";
import type { ProfileRepository } from "../src/modules/profile/types";
import type { ReferralRepository } from "../src/modules/referral/types";
import type { RefundRepository } from "../src/modules/refund/types";
import type {
  SessionRepository,
  SupabaseAuthVerifier,
  VerifiedSupabaseSession
} from "../src/modules/session/types";
import type {
  OnrampSessionResource,
  StoredWalletLinkChallenge,
  WalletOnrampProviderAdapter,
  WalletRepository,
  WalletResource
} from "../src/modules/wallet/types";
import type {
  PaymentEvidenceRepository,
  PaymentRepository,
  PaymentSettlementInput,
  PaymentSettlementVerifier,
  RecordPaymentSubmissionInput,
  RecordTransactionRequestInput,
  StoredPaymentIntent
} from "../src/modules/payment/types";
import type {
  LiveChatMessage,
  LiveProviderRoomStatus,
  LiveRepository,
  StoredLiveRoom
} from "../src/modules/live/types";
import type { Message, MessageRepository } from "../src/modules/message/types";
import type {
  Notification,
  NotificationDevice,
  NotificationPreferences,
  NotificationRepository
} from "../src/modules/notification/types";
import type {
  OrganizationDashboard,
  OrganizationDashboardPage,
  OrganizationRepository
} from "../src/modules/organization/types";
import type { EventRepository } from "../src/modules/event/types";
import type { DatingRepository } from "../src/modules/dating/types";
import type { DiscoverRepository } from "../src/modules/discover/types";
import type { EngagementRepository } from "../src/modules/engagement/types";
import type {
  Subscription,
  SubscriptionAuthorizationIntent,
  SubscriptionAuthorizationVerifier,
  SubscriptionPage,
  SubscriptionPlan,
  SubscriptionRepository
} from "../src/modules/subscription/types";

describe("buildApi", () => {
  it("boots the Fastify skeleton and loads the OpenAPI document", async () => {
    const app = await buildApi();
    await app.ready();

    expect(app.supabaseBoundary.hasServiceRoleKey).toBe(false);
    expect(app.swagger()).toMatchObject({
      openapi: "3.1.0",
      info: {
        title: "Veel V2 API"
      }
    });

    await app.close();
  });

  it("rejects /v1/session without a bearer token", async () => {
    const app = await buildApi();
    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: "/v1/session"
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      code: "unauthorized"
    });

    await app.close();
  });

  it("returns a contract-safe session for a verified Supabase user with a Veel profile", async () => {
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      ageRepository: verifiedAgeRepository,
      walletRepository: walletRepositoryWithWallet,
      sessionRepository: sessionRepositoryWithProfile({
        async onFind(supabaseUserId) {
          expect(supabaseUserId).toBe("00000000-0000-4000-8000-000000000001");

          return {
            id: "00000000-0000-4000-8000-000000000010",
            state: "active",
            handle: "maki",
            displayName: "Maki",
            avatarUrl: null
          };
        }
      })
    });
    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: "/v1/session",
      headers: {
        authorization: "Bearer valid-token"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      authenticated: true,
      appAccessState: {
        allowed: true,
        reason: "ready"
      },
      user: {
        id: "00000000-0000-4000-8000-000000000010",
        handle: "maki",
        displayName: "Maki",
        avatarUrl: null,
        badges: []
      }
    });

    await app.close();
  });

  it("keeps profiled users gated until age is verified", async () => {
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      ageRepository: requiredAgeRepository,
      walletRepository: walletRepositoryWithWallet,
      sessionRepository: sessionRepositoryWithProfile({
        async onFind() {
          return {
            id: "00000000-0000-4000-8000-000000000010",
            state: "active",
            handle: "maki",
            displayName: "Maki",
            avatarUrl: null
          };
        }
      })
    });
    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: "/v1/session",
      headers: {
        authorization: "Bearer valid-token"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      authenticated: true,
      appAccessState: {
        allowed: false,
        reason: "age_required"
      }
    });

    await app.close();
  });

  it("keeps verified users gated until a wallet path exists", async () => {
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      ageRepository: verifiedAgeRepository,
      walletRepository: walletRepositoryWithoutWallet,
      sessionRepository: sessionRepositoryWithProfile({
        async onFind() {
          return {
            id: "00000000-0000-4000-8000-000000000010",
            state: "active",
            handle: "maki",
            displayName: "Maki",
            avatarUrl: null
          };
        }
      })
    });
    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: "/v1/session",
      headers: {
        authorization: "Bearer valid-token"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      authenticated: true,
      appAccessState: {
        allowed: false,
        reason: "wallet_required"
      }
    });

    await app.close();
  });

  it("keeps authenticated users gated until the Veel profile exists", async () => {
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      ageRepository: requiredAgeRepository,
      walletRepository: walletRepositoryWithoutWallet,
      sessionRepository: sessionRepositoryWithProfile({
        async onFind() {
          return null;
        }
      })
    });
    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: "/v1/session",
      headers: {
        authorization: "Bearer valid-token"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      authenticated: true,
      appAccessState: {
        allowed: false,
        reason: "identity_required"
      }
    });

    await app.close();
  });

  it("returns the current age gate status for an authenticated user", async () => {
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      ageRepository: verifiedAgeRepository
    });
    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: "/v1/age/status",
      headers: {
        authorization: "Bearer valid-token"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      state: "verified",
      provider: "test"
    });

    await app.close();
  });

  it("starts an age provider session through the backend waterfall", async () => {
    const createdPendingVerifications: CreatePendingAgeVerificationInput[] = [];
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      sessionRepository: sessionRepositoryWithProfile({
        async onFind() {
          return null;
        }
      }),
      ageRepository: {
        async findLatestAgeStatusBySupabaseUserId() {
          return {
            state: "required",
            provider: null
          };
        },
        async createPendingAgeVerification(input) {
          createdPendingVerifications.push(input);
        },
        async recordProviderWebhook() {
          throw new Error("not implemented");
        },
        async updateVerificationFromWebhook() {
          throw new Error("not implemented");
        }
      },
      ageProviderWaterfall: fakeAgeProviderWaterfall
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/v1/age/sessions",
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "age-session-1"
      },
      payload: {
        providerPreference: "reusable_first"
      }
    });

    expect(response.statusCode, JSON.stringify(response.json())).toBe(201);
    expect(response.json()).toEqual({
      id: "age-session-provider-ref-1",
      provider: "yoti",
      launchUrl: "https://age.example.test/session/age-session-provider-ref-1",
      expiresAt: "2026-06-03T22:15:00.000Z"
    });
    expect(createdPendingVerifications).toEqual([
      {
        supabaseUserId: "00000000-0000-4000-8000-000000000001",
        provider: "yoti",
        providerReference: "age-session-provider-ref-1",
        jurisdiction: "US",
        rule: "over_18",
        expiresAt: new Date("2026-06-03T22:15:00.000Z")
      }
    ]);

    await app.close();
  });

  it("accepts a signed Sumsub age webhook and applies normalized verification state", async () => {
    vi.stubEnv("SUMSUB_WEBHOOK_SECRET", "sumsub-test-secret");
    const recordedEvents: unknown[] = [];
    const appliedEvents: unknown[] = [];
    const ageRepository: AgeRepository = {
      ...requiredAgeRepository,
      async recordProviderWebhook(input) {
        recordedEvents.push(input);
        return true;
      },
      async updateVerificationFromWebhook(input) {
        appliedEvents.push(input);
        return true;
      }
    };
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      ageRepository
    });
    await app.ready();
    const payload = {
      type: "applicantReviewed",
      applicantId: "sumsub-applicant",
      correlationId: "sumsub-event",
      reviewResult: {
        reviewAnswer: "GREEN"
      },
      createdAt: "2026-06-06 01:00:00+0000"
    };
    const rawPayload = JSON.stringify(payload);

    const response = await app.inject({
      method: "POST",
      url: "/v1/webhooks/age/sumsub",
      headers: {
        "content-type": "application/json",
        "x-payload-digest": sumsubDigest(rawPayload),
        "x-payload-digest-alg": "HMAC_SHA256_HEX"
      },
      payload: rawPayload
    });

    expect(response.statusCode, JSON.stringify(response.json())).toBe(202);
    expect(response.json()).toEqual({
      provider: "sumsub",
      received: 1,
      processed: 1
    });
    expect(recordedEvents).toMatchObject([
      {
        provider: "sumsub",
        providerEventId: "sumsub-event",
        eventType: "applicantReviewed",
        normalizedState: "verified"
      }
    ]);
    expect(appliedEvents).toMatchObject([
      {
        provider: "sumsub",
        providerEventId: "sumsub-event",
        providerReference: "sumsub-applicant",
        state: "verified"
      }
    ]);

    await app.close();
    vi.unstubAllEnvs();
  });

  it("deduplicates repeated signed Sumsub age webhooks", async () => {
    vi.stubEnv("SUMSUB_WEBHOOK_SECRET", "sumsub-test-secret");
    const appliedEvents: unknown[] = [];
    const ageRepository: AgeRepository = {
      ...requiredAgeRepository,
      async recordProviderWebhook() {
        return false;
      },
      async updateVerificationFromWebhook(input) {
        appliedEvents.push(input);
        return true;
      }
    };
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      ageRepository
    });
    await app.ready();
    const rawPayload = JSON.stringify({
      type: "applicantReviewed",
      applicantId: "sumsub-applicant",
      correlationId: "sumsub-event",
      reviewResult: {
        reviewAnswer: "GREEN"
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/webhooks/age/sumsub",
      headers: {
        "content-type": "application/json",
        "x-payload-digest": sumsubDigest(rawPayload),
        "x-payload-digest-alg": "HMAC_SHA256_HEX"
      },
      payload: rawPayload
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({
      provider: "sumsub",
      received: 1,
      processed: 0
    });
    expect(appliedEvents).toEqual([]);

    await app.close();
    vi.unstubAllEnvs();
  });

  it("rejects Sumsub age webhooks with invalid signatures", async () => {
    vi.stubEnv("SUMSUB_WEBHOOK_SECRET", "sumsub-test-secret");
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      ageRepository: requiredAgeRepository
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/v1/webhooks/age/sumsub",
      headers: {
        "content-type": "application/json",
        "x-payload-digest": "00",
        "x-payload-digest-alg": "HMAC_SHA256_HEX"
      },
      payload: {
        type: "applicantReviewed",
        applicantId: "sumsub-applicant",
        correlationId: "sumsub-event"
      }
    });

    expect(response.statusCode).toBe(401);

    await app.close();
    vi.unstubAllEnvs();
  });

  it("fails closed when no age provider is configured", async () => {
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      sessionRepository: sessionRepositoryWithProfile({
        async onFind() {
          return null;
        }
      }),
      ageRepository: requiredAgeRepository
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/v1/age/sessions",
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "age-session-2"
      },
      payload: {
        providerPreference: "reusable_first"
      }
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      code: "service_unavailable"
    });

    await app.close();
  });

  it("updates the current profile after bootstrapping the Veel user row", async () => {
    const ensuredSupabaseUserIds: string[] = [];
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      sessionRepository: sessionRepositoryWithProfile({
        async onEnsure(supabaseUserId) {
          ensuredSupabaseUserIds.push(supabaseUserId);
        },
        async onFind() {
          return null;
        }
      }),
      profileRepository: fakeProfileRepository
    });
    await app.ready();

    const response = await app.inject({
      method: "PATCH",
      url: "/v1/profiles/me",
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "profile-setup-1"
      },
      payload: {
        handle: "maki",
        displayName: "Maki",
        bio: "Building Veel v2"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(ensuredSupabaseUserIds).toEqual(["00000000-0000-4000-8000-000000000001"]);
    expect(response.json()).toEqual({
      id: "00000000-0000-4000-8000-000000000010",
      handle: "maki",
      displayName: "Maki",
      avatarUrl: null,
      badges: []
    });

    await app.close();
  });

  it("rejects profile updates without an idempotency key", async () => {
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      sessionRepository: sessionRepositoryWithProfile({
        async onFind() {
          return null;
        }
      }),
      profileRepository: fakeProfileRepository
    });
    await app.ready();

    const response = await app.inject({
      method: "PATCH",
      url: "/v1/profiles/me",
      headers: {
        authorization: "Bearer valid-token"
      },
      payload: {
        handle: "maki",
        displayName: "Maki"
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      code: "validation_failed"
    });

    await app.close();
  });

  it("returns a public creator profile by handle", async () => {
    const app = await buildApi({
      profileRepository: fakeProfileRepository
    });
    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: "/v1/profiles/maki"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      user: {
        id: "00000000-0000-4000-8000-000000000010",
        handle: "maki",
        displayName: "Maki"
      },
      stats: {
        contentCount: 2,
        liveRoomCount: 1,
        confirmedPaymentCount: 3,
        followerCount: 0
      },
      monetisation: {
        tipsEnabled: true,
        subscriptionsEnabled: false
      }
    });

    await app.close();
  });

  it("returns the current creator monetisation dashboard for a verified creator", async () => {
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      ageRepository: verifiedAgeRepository,
      sessionRepository: sessionRepositoryWithProfile({
        async onFind() {
          return {
            id: "00000000-0000-4000-8000-000000000010",
            state: "active",
            handle: "maki",
            displayName: "Maki",
            avatarUrl: null
          };
        }
      }),
      profileRepository: fakeProfileRepository
    });
    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: "/v1/profiles/me/creator-dashboard",
      headers: {
        authorization: "Bearer valid-token"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      creator: {
        handle: "maki"
      },
      readiness: {
        recipientWalletState: "missing",
        blockedReasons: ["earnings_recipient_wallet_required"]
      },
      earnings: {
        creatorEarningsMinor: 85000000,
        platformFeesMinor: 15000000,
        referralCommissionsMinor: 5000000
      }
    });

    await app.close();
  });

  it("returns backend-owned creator onboarding readiness before dashboard access is complete", async () => {
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      sessionRepository: sessionRepositoryWithProfile({
        onEnsure(supabaseUserId) {
          expect(supabaseUserId).toBe("00000000-0000-4000-8000-000000000001");
        },
        async onFind() {
          return null;
        }
      }),
      profileRepository: fakeProfileRepository
    });
    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: "/v1/profiles/me/creator-onboarding",
      headers: {
        authorization: "Bearer valid-token"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      state: "action_required",
      canStartEarning: false,
      nextAction: "/wallet",
      steps: expect.arrayContaining([
        expect.objectContaining({
          key: "wallet",
          state: "action_required",
          actionHref: "/wallet"
        }),
        expect.objectContaining({
          key: "recipient_wallet",
          state: "action_required",
          actionHref: "/wallet"
        })
      ])
    });
    expect(response.body).not.toMatch(/balance|withdraw|payout|escrow|private|secret/i);

    await app.close();
  });

  it("lists authenticated user wallets", async () => {
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      walletRepository: walletRepositoryWithWallet
    });
    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: "/v1/wallets",
      headers: {
        authorization: "Bearer valid-token"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      items: [
        {
          id: "00000000-0000-4000-8000-000000000020",
          chain: "solana_devnet",
          address: "VeelWallet111111111111111111111111111111111",
          provider: "embedded_privy",
          isPrimary: true
        }
      ]
    });

    await app.close();
  });

  it("sets an authenticated user's primary wallet", async () => {
    const walletRepository: WalletRepository = {
      ...walletRepositoryWithWallet,
      async setPrimaryWallet(input) {
        expect(input).toEqual({
          supabaseUserId: "00000000-0000-4000-8000-000000000001",
          walletId: "00000000-0000-4000-8000-000000000020"
        });

        return {
          id: input.walletId,
          chain: "solana_devnet",
          address: "VeelWallet111111111111111111111111111111111",
          provider: "embedded_privy",
          isPrimary: true
        };
      }
    };
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      walletRepository
    });
    await app.ready();

    const response = await app.inject({
      method: "PATCH",
      url: "/v1/wallets/00000000-0000-4000-8000-000000000020/primary",
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "wallet-primary-1"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: "00000000-0000-4000-8000-000000000020",
      isPrimary: true
    });

    await app.close();
  });

  it("creates a wallet funding onramp session without granting payment state", async () => {
    const onrampSession: OnrampSessionResource = {
      id: "00000000-0000-4000-8000-000000000070",
      provider: "coinbase",
      launchUrl: "https://pay.coinbase.com/buy",
      walletId: "00000000-0000-4000-8000-000000000020",
      walletAddress: "VeelWallet111111111111111111111111111111111",
      state: "created",
      createdAt: "2026-06-06T00:00:00.000Z",
      expiresAt: null
    };
    const walletRepository: WalletRepository = {
      ...walletRepositoryWithWallet,
      async findOnrampSessionByIdempotencyKey() {
        return null;
      },
      async recordOnrampSession(input) {
        expect(input).toMatchObject({
          supabaseUserId: "00000000-0000-4000-8000-000000000001",
          walletId: "00000000-0000-4000-8000-000000000020",
          idempotencyKey: "onramp",
          provider: "coinbase",
          walletAddress: "VeelWallet111111111111111111111111111111111",
          chain: "solana_devnet",
          purchaseCurrency: "SOL"
        });

        return onrampSession;
      }
    };
    const onrampProvider: WalletOnrampProviderAdapter = {
      async createSession(input) {
        expect(input.wallet.id).toBe("00000000-0000-4000-8000-000000000020");
        expect(input.returnUrl).toBe("https://veel.example/wallet");

        return {
          provider: "coinbase",
          providerSessionReferenceHash: "a".repeat(64),
          launchUrl: onrampSession.launchUrl,
          purchaseCurrency: "SOL",
          expiresAt: null
        };
      }
    };
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      walletRepository,
      onrampProvider
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/v1/wallets/onramp-sessions",
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "onramp"
      },
      payload: {
        walletId: "00000000-0000-4000-8000-000000000020",
        returnUrl: "https://veel.example/wallet"
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual(onrampSession);
    expect(response.json()).not.toHaveProperty("paymentIntentId");
    expect(response.json()).not.toHaveProperty("entitlementId");

    await app.close();
  });

  it("keeps wallet funding unavailable until the provider is configured", async () => {
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      walletRepository: walletRepositoryWithWallet
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/v1/wallets/onramp-sessions",
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "wallet-onramp-disabled"
      },
      payload: {
        walletId: "00000000-0000-4000-8000-000000000020"
      }
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      code: "service_unavailable"
    });

    await app.close();
  });

  it("creates and verifies an external wallet link challenge", async () => {
    const walletKeypair = nacl.sign.keyPair();
    const address = bs58.encode(walletKeypair.publicKey);
    let storedChallenge: StoredWalletLinkChallenge | null = null;
    const linkedWallet: WalletResource = {
      id: "00000000-0000-4000-8000-000000000021",
      chain: "solana_devnet",
      address,
      provider: "phantom",
      isPrimary: true
    };
    const walletRepository: WalletRepository = {
      async hasWalletBySupabaseUserId() {
        return false;
      },
      async listWalletsBySupabaseUserId() {
        return [];
      },
      async createLinkChallenge(input) {
        storedChallenge = {
          id: "00000000-0000-4000-8000-000000000030",
          userId: "00000000-0000-4000-8000-000000000010",
          chain: input.chain,
          provider: input.provider,
          address: input.address,
          message: input.message,
          expiresAt: input.expiresAt,
          consumedAt: null
        };

        return {
          id: storedChallenge.id,
          chain: storedChallenge.chain,
          provider: storedChallenge.provider,
          address: storedChallenge.address,
          message: storedChallenge.message,
          expiresAt: storedChallenge.expiresAt.toISOString()
        };
      },
      async findLinkChallenge() {
        return storedChallenge;
      },
      async consumeVerifiedExternalWalletLink() {
        return linkedWallet;
      },
      async findWalletForSupabaseUser() {
        return null;
      },
      async setPrimaryWallet() {
        throw new Error("not implemented");
      },
      async findOnrampSessionByIdempotencyKey() {
        return null;
      },
      async recordOnrampSession() {
        throw new Error("not implemented");
      }
    };
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      sessionRepository: sessionRepositoryWithProfile({
        async onFind() {
          return null;
        }
      }),
      walletRepository
    });
    await app.ready();

    const challengeResponse = await app.inject({
      method: "POST",
      url: "/v1/wallets/link-challenges",
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "wallet-challenge-1"
      },
      payload: {
        chain: "solana_devnet",
        provider: "phantom",
        address
      }
    });

    expect(challengeResponse.statusCode).toBe(201);
    const challenge = challengeResponse.json() as {
      id: string;
      message: string;
    };
    const signature = nacl.sign.detached(new TextEncoder().encode(challenge.message), walletKeypair.secretKey);

    const linkResponse = await app.inject({
      method: "POST",
      url: "/v1/wallets/link",
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "wallet-link-1"
      },
      payload: {
        chain: "solana_devnet",
        provider: "phantom",
        address,
        proof: {
          challengeId: challenge.id,
          message: challenge.message,
          signature: bs58.encode(signature),
          signatureEncoding: "base58"
        }
      }
    });

    expect(linkResponse.statusCode).toBe(201);
    expect(linkResponse.json()).toEqual(linkedWallet);

    await app.close();
  });

  it("returns the protected Home feed for an app-ready user", async () => {
    const contentRepository: ContentRepository = {
      async createDraft() {
        throw new Error("not implemented");
      },
      async createMediaAsset() {
        throw new Error("not implemented");
      },
      async findContentDetail() {
        throw new Error("not implemented");
      },
      async findContentUnlockOffer() {
        throw new Error("not implemented");
      },
      async findOwnedContentForUpload() {
        throw new Error("not implemented");
      },
      async listHomeFeed(input) {
        expect(input).toEqual({
          supabaseUserId: "00000000-0000-4000-8000-000000000001",
          mode: "recommended",
          limit: 20
        });

        return {
          items: [homeFeedItem],
          nextCursor: null
        };
      }
    };
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      sessionRepository: sessionRepositoryWithProfile({
        async onFind() {
          return {
            id: "00000000-0000-4000-8000-000000000010",
            state: "active",
            handle: "maki",
            displayName: "Maki",
            avatarUrl: null
          };
        }
      }),
      ageRepository: verifiedAgeRepository,
      walletRepository: walletRepositoryWithWallet,
      contentRepository
    });
    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: "/v1/content/feed",
      headers: {
        authorization: "Bearer valid-token"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      items: [homeFeedItem],
      nextCursor: null
    });

    await app.close();
  });

  it("returns a protected content detail projection without playback URLs", async () => {
    const lockedContent: ContentItem = {
      ...homeFeedItem,
      accessState: "locked",
      playback: {
        state: "not_ready",
        url: null,
        provider: "none"
      }
    };
    const contentRepository: ContentRepository = {
      async createDraft() {
        throw new Error("not implemented");
      },
      async createMediaAsset() {
        throw new Error("not implemented");
      },
      async findContentDetail(input) {
        expect(input).toEqual({
          supabaseUserId: "00000000-0000-4000-8000-000000000001",
          contentId: "00000000-0000-4000-8000-000000000040"
        });

        return lockedContent;
      },
      async findContentUnlockOffer() {
        throw new Error("not implemented");
      },
      async findOwnedContentForUpload() {
        throw new Error("not implemented");
      },
      async listHomeFeed() {
        throw new Error("not implemented");
      }
    };
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      sessionRepository: sessionRepositoryWithProfile({
        async onFind() {
          return {
            id: "00000000-0000-4000-8000-000000000010",
            state: "active",
            handle: "maki",
            displayName: "Maki",
            avatarUrl: null
          };
        }
      }),
      ageRepository: verifiedAgeRepository,
      walletRepository: walletRepositoryWithWallet,
      contentRepository
    });
    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: "/v1/content/00000000-0000-4000-8000-000000000040",
      headers: {
        authorization: "Bearer valid-token"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(lockedContent);
    expect(response.json().playback.url).toBeNull();

    await app.close();
  });

  it("returns tokenized Bunny playback for backend-unlocked content", async () => {
    const unlockedContent: ContentItem = {
      ...homeFeedItem,
      accessState: "unlocked",
      playback: {
        state: "full",
        url: "https://vz-example.b-cdn.net/11111111-1111-4111-8111-111111111111/playlist.m3u8",
        provider: "bunny"
      }
    };
    const contentRepository: ContentRepository = {
      async createDraft() {
        throw new Error("not implemented");
      },
      async createMediaAsset() {
        throw new Error("not implemented");
      },
      async findContentDetail() {
        return unlockedContent;
      },
      async findContentUnlockOffer() {
        throw new Error("not implemented");
      },
      async findOwnedContentForUpload() {
        throw new Error("not implemented");
      },
      async listHomeFeed() {
        throw new Error("not implemented");
      }
    };
    const mediaUploadProvider: MediaUploadProviderAdapter = {
      provider: "bunny",
      isConfigured() {
        return true;
      },
      async createUploadSession() {
        throw new Error("not implemented");
      },
      createPlaybackResource(input) {
        expect(input.providerAssetId).toBe("11111111-1111-4111-8111-111111111111");

        return {
          state: "full",
          url: "https://iframe.mediadelivery.net/embed/123/11111111-1111-4111-8111-111111111111?token=signed&expires=1770000900",
          provider: "bunny",
          resourceType: "embed",
          expiresAt: "2026-02-02T10:15:00.000Z"
        };
      }
    };
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      sessionRepository: sessionRepositoryWithProfile({
        async onFind() {
          return {
            id: "00000000-0000-4000-8000-000000000010",
            state: "active",
            handle: "maki",
            displayName: "Maki",
            avatarUrl: null
          };
        }
      }),
      ageRepository: verifiedAgeRepository,
      walletRepository: walletRepositoryWithWallet,
      contentRepository,
      mediaUploadProvider
    });
    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: "/v1/content/00000000-0000-4000-8000-000000000040",
      headers: {
        authorization: "Bearer valid-token"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().playback).toEqual({
      state: "full",
      url: "https://iframe.mediadelivery.net/embed/123/11111111-1111-4111-8111-111111111111?token=signed&expires=1770000900",
      provider: "bunny",
      resourceType: "embed",
      expiresAt: "2026-02-02T10:15:00.000Z"
    });

    await app.close();
  });

  it("fails Bunny playback closed when the signer is unavailable", async () => {
    const unlockedContent: ContentItem = {
      ...homeFeedItem,
      accessState: "unlocked",
      playback: {
        state: "full",
        url: "https://vz-example.b-cdn.net/11111111-1111-4111-8111-111111111111/playlist.m3u8",
        provider: "bunny"
      }
    };
    const contentRepository: ContentRepository = {
      async createDraft() {
        throw new Error("not implemented");
      },
      async createMediaAsset() {
        throw new Error("not implemented");
      },
      async findContentDetail() {
        return unlockedContent;
      },
      async findContentUnlockOffer() {
        throw new Error("not implemented");
      },
      async findOwnedContentForUpload() {
        throw new Error("not implemented");
      },
      async listHomeFeed() {
        throw new Error("not implemented");
      }
    };
    const mediaUploadProvider: MediaUploadProviderAdapter = {
      provider: "bunny",
      isConfigured() {
        return true;
      },
      async createUploadSession() {
        throw new Error("not implemented");
      },
      createPlaybackResource() {
        throw new Error("signer unavailable");
      }
    };
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      sessionRepository: sessionRepositoryWithProfile({
        async onFind() {
          return {
            id: "00000000-0000-4000-8000-000000000010",
            state: "active",
            handle: "maki",
            displayName: "Maki",
            avatarUrl: null
          };
        }
      }),
      ageRepository: verifiedAgeRepository,
      walletRepository: walletRepositoryWithWallet,
      contentRepository,
      mediaUploadProvider
    });
    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: "/v1/content/00000000-0000-4000-8000-000000000040",
      headers: {
        authorization: "Bearer valid-token"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().playback).toEqual({
      state: "blocked",
      url: null,
      provider: "bunny"
    });

    await app.close();
  });

  it("blocks generic Livepeer content playback until replay signing exists", async () => {
    const replayContent: ContentItem = {
      ...homeFeedItem,
      mediaType: "live_replay",
      accessState: "unlocked",
      playback: {
        state: "full",
        url: "https://livepeercdn.studio/hls/livepeer-replay-1/index.m3u8",
        provider: "livepeer"
      }
    };
    const contentRepository: ContentRepository = {
      async createDraft() {
        throw new Error("not implemented");
      },
      async createMediaAsset() {
        throw new Error("not implemented");
      },
      async findContentDetail() {
        return replayContent;
      },
      async findContentUnlockOffer() {
        throw new Error("not implemented");
      },
      async findOwnedContentForUpload() {
        throw new Error("not implemented");
      },
      async listHomeFeed() {
        throw new Error("not implemented");
      }
    };
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      sessionRepository: sessionRepositoryWithProfile({
        async onFind() {
          return {
            id: "00000000-0000-4000-8000-000000000010",
            state: "active",
            handle: "maki",
            displayName: "Maki",
            avatarUrl: null
          };
        }
      }),
      ageRepository: verifiedAgeRepository,
      walletRepository: walletRepositoryWithWallet,
      contentRepository
    });
    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: "/v1/content/00000000-0000-4000-8000-000000000040",
      headers: {
        authorization: "Bearer valid-token"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().playback).toEqual({
      state: "blocked",
      url: null,
      provider: "livepeer"
    });

    await app.close();
  });

  it("returns 404 for a missing protected content detail", async () => {
    const contentRepository: ContentRepository = {
      async createDraft() {
        throw new Error("not implemented");
      },
      async createMediaAsset() {
        throw new Error("not implemented");
      },
      async findContentDetail() {
        return null;
      },
      async findContentUnlockOffer() {
        throw new Error("not implemented");
      },
      async findOwnedContentForUpload() {
        throw new Error("not implemented");
      },
      async listHomeFeed() {
        throw new Error("not implemented");
      }
    };
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      sessionRepository: sessionRepositoryWithProfile({
        async onFind() {
          return {
            id: "00000000-0000-4000-8000-000000000010",
            state: "active",
            handle: "maki",
            displayName: "Maki",
            avatarUrl: null
          };
        }
      }),
      ageRepository: verifiedAgeRepository,
      walletRepository: walletRepositoryWithWallet,
      contentRepository
    });
    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: "/v1/content/00000000-0000-4000-8000-000000000099",
      headers: {
        authorization: "Bearer valid-token"
      }
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      code: "not_found"
    });

    await app.close();
  });

  it("blocks Home feed access before age verification", async () => {
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      sessionRepository: sessionRepositoryWithProfile({
        async onFind() {
          return {
            id: "00000000-0000-4000-8000-000000000010",
            state: "active",
            handle: "maki",
            displayName: "Maki",
            avatarUrl: null
          };
        }
      }),
      ageRepository: requiredAgeRepository,
      walletRepository: walletRepositoryWithWallet
    });
    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: "/v1/content/feed",
      headers: {
        authorization: "Bearer valid-token"
      }
    });

    expect(response.statusCode).toBe(403);

    await app.close();
  });

  it("returns protected Discover results for an app-ready user", async () => {
    const discoverRepository: DiscoverRepository = {
      async search(input) {
        expect(input).toEqual({
          supabaseUserId: "00000000-0000-4000-8000-000000000001",
          query: "studio",
          cursor: undefined,
          limit: 12
        });

        return {
          content: [homeFeedItem],
          creators: [homeFeedItem.creator],
          hashtags: [{ slug: "studio", displayName: "#studio", state: "active" }],
          events: [eventFixture()],
          liveRooms: [liveRoomFixture({ state: "live", hasPass: false })],
          nextCursor: null
        };
      },
      async listHashtags() {
        throw new Error("not implemented");
      },
      async getHashtag() {
        throw new Error("not implemented");
      },
      async listCreators() {
        throw new Error("not implemented");
      },
      async listEvents() {
        throw new Error("not implemented");
      },
      async listLive() {
        throw new Error("not implemented");
      }
    };
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      sessionRepository: sessionRepositoryWithProfile({
        async onFind() {
          return {
            id: "00000000-0000-4000-8000-000000000010",
            state: "active",
            handle: "maki",
            displayName: "Maki",
            avatarUrl: null
          };
        }
      }),
      ageRepository: verifiedAgeRepository,
      walletRepository: walletRepositoryWithWallet,
      discoverRepository
    });
    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: "/v1/discover/search?q=studio",
      headers: {
        authorization: "Bearer valid-token"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      content: [homeFeedItem],
      creators: [homeFeedItem.creator],
      hashtags: [{ slug: "studio", displayName: "#studio", state: "active" }],
      events: [eventFixture()],
      liveRooms: [{ title: "Live room", accessState: "pass_required" }],
      nextCursor: null
    });

    await app.close();
  });

  it("blocks Discover before app readiness", async () => {
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      sessionRepository: sessionRepositoryWithProfile({
        async onFind() {
          return {
            id: "00000000-0000-4000-8000-000000000010",
            state: "active",
            handle: "maki",
            displayName: "Maki",
            avatarUrl: null
          };
        }
      }),
      ageRepository: requiredAgeRepository,
      walletRepository: walletRepositoryWithWallet
    });
    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: "/v1/discover/search?q=studio",
      headers: {
        authorization: "Bearer valid-token"
      }
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      code: "forbidden"
    });

    await app.close();
  });

  it("creates a content draft for an app-ready user", async () => {
    const contentRepository: ContentRepository = {
      async createDraft(input) {
        expect(input).toEqual({
          supabaseUserId: "00000000-0000-4000-8000-000000000001",
          mediaType: "vod",
          caption: "studio cut",
          visibility: "private",
          nsfwLabel: "none"
        });

        return homeFeedItem;
      },
      async createMediaAsset() {
        throw new Error("not implemented");
      },
      async findContentDetail() {
        throw new Error("not implemented");
      },
      async findContentUnlockOffer() {
        throw new Error("not implemented");
      },
      async findOwnedContentForUpload() {
        throw new Error("not implemented");
      },
      async listHomeFeed() {
        throw new Error("not implemented");
      }
    };
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      sessionRepository: sessionRepositoryWithProfile({
        async onFind() {
          return {
            id: "00000000-0000-4000-8000-000000000010",
            state: "active",
            handle: "maki",
            displayName: "Maki",
            avatarUrl: null
          };
        }
      }),
      ageRepository: verifiedAgeRepository,
      walletRepository: walletRepositoryWithWallet,
      contentRepository
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/v1/content",
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "content-draft-1"
      },
      payload: {
        mediaType: "vod",
        caption: "studio cut",
        visibility: "private",
        nsfwLabel: "none"
      }
    });

    expect(response.statusCode, JSON.stringify(response.json())).toBe(201);
    expect(response.json()).toEqual(homeFeedItem);

    await app.close();
  });

  it("creates a Bunny upload session for an owned content draft", async () => {
    const createdAssets: CreateMediaAssetInput[] = [];
    const contentRepository: ContentRepository = {
      async createDraft() {
        throw new Error("not implemented");
      },
      async createMediaAsset(input) {
        createdAssets.push(input);
      },
      async findContentDetail() {
        throw new Error("not implemented");
      },
      async findContentUnlockOffer() {
        throw new Error("not implemented");
      },
      async findOwnedContentForUpload(input) {
        expect(input).toEqual({
          supabaseUserId: "00000000-0000-4000-8000-000000000001",
          contentId: "00000000-0000-4000-8000-000000000040"
        });

        return {
          id: "00000000-0000-4000-8000-000000000040",
          mediaType: "vod",
          caption: "studio cut"
        };
      },
      async listHomeFeed() {
        throw new Error("not implemented");
      }
    };
    const mediaUploadProvider: MediaUploadProviderAdapter = {
      provider: "bunny",
      isConfigured() {
        return true;
      },
      async createUploadSession(input) {
        expect(input).toEqual({
          contentId: "00000000-0000-4000-8000-000000000040",
          title: "studio cut",
          mimeType: "video/mp4"
        });

        return {
          provider: "bunny",
          providerAssetId: "bunny-video-guid",
          uploadUrl: "https://video.bunnycdn.com/tusupload",
          headers: {
            AuthorizationSignature: "signed",
            AuthorizationExpire: "upload-expires-at",
            LibraryId: "library-id",
            VideoId: "bunny-video-guid"
          },
          expiresAt: new Date("2026-06-04T23:00:00.000Z")
        };
      }
    };
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      sessionRepository: sessionRepositoryWithProfile({
        async onFind() {
          return {
            id: "00000000-0000-4000-8000-000000000010",
            state: "active",
            handle: "maki",
            displayName: "Maki",
            avatarUrl: null
          };
        }
      }),
      ageRepository: verifiedAgeRepository,
      walletRepository: walletRepositoryWithWallet,
      contentRepository,
      mediaUploadProvider
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/v1/media/uploads",
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "media-upload-1"
      },
      payload: {
        contentId: "00000000-0000-4000-8000-000000000040",
        fileName: "studio.mp4",
        mimeType: "video/mp4"
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      uploadUrl: "https://video.bunnycdn.com/tusupload",
      provider: "bunny",
      headers: {
        AuthorizationSignature: "signed",
        AuthorizationExpire: "upload-expires-at",
        LibraryId: "library-id",
        VideoId: "bunny-video-guid"
      },
      expiresAt: "2026-06-04T23:00:00.000Z"
    });
    expect(createdAssets).toEqual([
      {
        contentId: "00000000-0000-4000-8000-000000000040",
        provider: "bunny",
        providerAssetId: "bunny-video-guid",
        providerState: "created"
      }
    ]);

    await app.close();
  });

  it("fails media uploads closed when Bunny is not configured", async () => {
    const contentRepository: ContentRepository = {
      async createDraft() {
        throw new Error("not implemented");
      },
      async createMediaAsset() {
        throw new Error("not implemented");
      },
      async findContentDetail() {
        throw new Error("not implemented");
      },
      async findContentUnlockOffer() {
        throw new Error("not implemented");
      },
      async findOwnedContentForUpload() {
        return {
          id: "00000000-0000-4000-8000-000000000040",
          mediaType: "vod",
          caption: "studio cut"
        };
      },
      async listHomeFeed() {
        throw new Error("not implemented");
      }
    };
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      sessionRepository: sessionRepositoryWithProfile({
        async onFind() {
          return {
            id: "00000000-0000-4000-8000-000000000010",
            state: "active",
            handle: "maki",
            displayName: "Maki",
            avatarUrl: null
          };
        }
      }),
      ageRepository: verifiedAgeRepository,
      walletRepository: walletRepositoryWithWallet,
      contentRepository
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/v1/media/uploads",
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "media-upload-2"
      },
      payload: {
        contentId: "00000000-0000-4000-8000-000000000040",
        fileName: "studio.mp4",
        mimeType: "video/mp4"
      }
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      code: "service_unavailable"
    });

    await app.close();
  });

  it("syncs Bunny playback status into the backend media projection", async () => {
    const playbackUpdates: Array<{
      mediaAssetId: string;
      providerState: string;
      providerPlayable: boolean;
      playbackUrl?: string | null;
      posterUrl?: string | null;
      durationMs?: number | null;
    }> = [];
    const contentRepository: ContentRepository = {
      async createDraft() {
        throw new Error("not implemented");
      },
      async createMediaAsset() {
        throw new Error("not implemented");
      },
      async findContentDetail() {
        throw new Error("not implemented");
      },
      async findContentUnlockOffer() {
        throw new Error("not implemented");
      },
      async findOwnedContentForUpload() {
        throw new Error("not implemented");
      },
      async findOwnedMediaAssetForSync(input) {
        expect(input).toEqual({
          supabaseUserId: "00000000-0000-4000-8000-000000000001",
          mediaAssetId: "00000000-0000-4000-8000-000000000070"
        });

        return {
          id: input.mediaAssetId,
          contentId: "00000000-0000-4000-8000-000000000040",
          provider: "bunny",
          providerAssetId: "bunny-video-guid"
        };
      },
      async listHomeFeed() {
        throw new Error("not implemented");
      },
      async updateMediaAssetPlayback(input) {
        playbackUpdates.push(input);
      }
    };
    const mediaUploadProvider: MediaUploadProviderAdapter = {
      provider: "bunny",
      isConfigured() {
        return true;
      },
      async createUploadSession() {
        throw new Error("not implemented");
      },
      async getPlaybackData(input) {
        expect(input).toEqual({
          providerAssetId: "bunny-video-guid"
        });

        return {
          providerState: "ready",
          providerPlayable: true,
          playbackUrl: "https://vz.example.test/video/playlist.m3u8",
          posterUrl: "https://vz.example.test/video/thumbnail.jpg",
          durationMs: 90000
        };
      }
    };
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      sessionRepository: appReadySessionRepository,
      ageRepository: verifiedAgeRepository,
      walletRepository: walletRepositoryWithWallet,
      contentRepository,
      mediaUploadProvider
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/v1/media/assets/00000000-0000-4000-8000-000000000070/sync",
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "media-sync-1"
      }
    });

    expect(response.statusCode).toBe(202);
    expect(playbackUpdates).toEqual([
      {
        mediaAssetId: "00000000-0000-4000-8000-000000000070",
        providerState: "ready",
        providerPlayable: true,
        playbackUrl: "https://vz.example.test/video/playlist.m3u8",
        posterUrl: "https://vz.example.test/video/thumbnail.jpg",
        durationMs: 90000
      }
    ]);

    await app.close();
  });

  it("accepts a signed Bunny media webhook and applies normalized playback state", async () => {
    vi.stubEnv("BUNNY_STREAM_WEBHOOK_READONLY_KEY", "bunny-readonly-secret");
    const recordedEvents: unknown[] = [];
    const appliedEvents: unknown[] = [];
    const contentRepository: ContentRepository = {
      async createDraft() {
        throw new Error("not implemented");
      },
      async createMediaAsset() {
        throw new Error("not implemented");
      },
      async findContentDetail() {
        throw new Error("not implemented");
      },
      async findContentUnlockOffer() {
        throw new Error("not implemented");
      },
      async findOwnedContentForUpload() {
        throw new Error("not implemented");
      },
      async listHomeFeed() {
        throw new Error("not implemented");
      },
      async recordMediaProviderWebhook(input) {
        recordedEvents.push(input);
        return true;
      },
      async updateMediaAssetFromWebhook(input) {
        appliedEvents.push(input);
        return true;
      }
    };
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      contentRepository
    });
    await app.ready();
    const payload = {
      VideoLibraryId: 133,
      VideoGuid: "bunny-video-guid",
      Status: 3
    };
    const rawPayload = JSON.stringify(payload);

    const response = await app.inject({
      method: "POST",
      url: "/v1/webhooks/media/bunny",
      headers: {
        "content-type": "application/json",
        "x-bunnystream-signature": bunnySignature(rawPayload),
        "x-bunnystream-signature-version": "v1",
        "x-bunnystream-signature-algorithm": "hmac-sha256"
      },
      payload: rawPayload
    });

    expect(response.statusCode, JSON.stringify(response.json())).toBe(202);
    expect(response.json()).toEqual({
      provider: "bunny",
      received: 1,
      processed: 1
    });
    expect(recordedEvents).toMatchObject([
      {
        provider: "bunny",
        providerEventId: "133:bunny-video-guid:3",
        eventType: "video.status.3",
        normalizedState: "ready"
      }
    ]);
    expect(appliedEvents).toEqual([
      {
        provider: "bunny",
        providerEventId: "133:bunny-video-guid:3",
        providerAssetId: "bunny-video-guid",
        providerState: "ready",
        providerPlayable: true
      }
    ]);

    await app.close();
    vi.unstubAllEnvs();
  });

  it("deduplicates repeated signed Bunny media webhooks", async () => {
    vi.stubEnv("BUNNY_STREAM_WEBHOOK_READONLY_KEY", "bunny-readonly-secret");
    const appliedEvents: unknown[] = [];
    const contentRepository: ContentRepository = {
      async createDraft() {
        throw new Error("not implemented");
      },
      async createMediaAsset() {
        throw new Error("not implemented");
      },
      async findContentDetail() {
        throw new Error("not implemented");
      },
      async findContentUnlockOffer() {
        throw new Error("not implemented");
      },
      async findOwnedContentForUpload() {
        throw new Error("not implemented");
      },
      async listHomeFeed() {
        throw new Error("not implemented");
      },
      async recordMediaProviderWebhook() {
        return false;
      },
      async updateMediaAssetFromWebhook(input) {
        appliedEvents.push(input);
        return true;
      }
    };
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      contentRepository
    });
    await app.ready();
    const rawPayload = JSON.stringify({
      VideoLibraryId: 133,
      VideoGuid: "bunny-video-guid",
      Status: 4
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/webhooks/media/bunny",
      headers: {
        "content-type": "application/json",
        "x-bunnystream-signature": bunnySignature(rawPayload),
        "x-bunnystream-signature-version": "v1",
        "x-bunnystream-signature-algorithm": "hmac-sha256"
      },
      payload: rawPayload
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({
      provider: "bunny",
      received: 1,
      processed: 0
    });
    expect(appliedEvents).toEqual([]);

    await app.close();
    vi.unstubAllEnvs();
  });

  it("rejects Bunny media webhooks with invalid signatures", async () => {
    vi.stubEnv("BUNNY_STREAM_WEBHOOK_READONLY_KEY", "bunny-readonly-secret");
    const app = await buildApi({
      authVerifier: fakeAuthVerifier
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/v1/webhooks/media/bunny",
      headers: {
        "content-type": "application/json",
        "x-bunnystream-signature": "00",
        "x-bunnystream-signature-version": "v1",
        "x-bunnystream-signature-algorithm": "hmac-sha256"
      },
      payload: {
        VideoLibraryId: 133,
        VideoGuid: "bunny-video-guid",
        Status: 3
      }
    });

    expect(response.statusCode).toBe(401);

    await app.close();
    vi.unstubAllEnvs();
  });

  it("accepts a signed Livepeer stream webhook and applies normalized live state", async () => {
    vi.stubEnv("LIVEPEER_WEBHOOK_SECRET", "livepeer-webhook-secret");
    const recordedEvents: unknown[] = [];
    const appliedEvents: unknown[] = [];
    const liveRepository = fakeLiveRepository({
      async onRecordLiveProviderWebhook(input) {
        recordedEvents.push(input);
        return true;
      },
      async onUpdateRoomFromWebhook(input) {
        appliedEvents.push(input);
        return true;
      }
    });
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      liveRepository
    });
    await app.ready();
    const timestamp = Math.floor(Date.now() / 1000);
    const payload = {
      webhookId: "livepeer-webhook-1",
      timestamp: String(timestamp),
      event: "stream.started",
      event_object: {
        id: "livepeer-stream-13",
        playbackId: "livepeer-playback-13"
      }
    };
    const rawPayload = JSON.stringify(payload);

    const response = await app.inject({
      method: "POST",
      url: "/v1/webhooks/media/livepeer",
      headers: {
        "content-type": "application/json",
        "livepeer-signature": livepeerSignature(rawPayload, timestamp)
      },
      payload: rawPayload
    });

    expect(response.statusCode, JSON.stringify(response.json())).toBe(202);
    expect(response.json()).toEqual({
      provider: "livepeer",
      received: 1,
      processed: 1
    });
    expect(recordedEvents).toMatchObject([
      {
        providerEventId: `livepeer-webhook-1:stream.started:livepeer-stream-13:${timestamp}`,
        eventType: "stream.started",
        normalizedState: "active"
      }
    ]);
    expect(appliedEvents).toEqual([
      {
        providerEventId: `livepeer-webhook-1:stream.started:livepeer-stream-13:${timestamp}`,
        providerStreamId: "livepeer-stream-13",
        providerPlaybackId: "livepeer-playback-13",
        providerState: "active",
        state: "live",
        playbackUrl: "https://livepeercdn.studio/hls/livepeer-playback-13/index.m3u8"
      }
    ]);

    await app.close();
    vi.unstubAllEnvs();
  });

  it("deduplicates repeated signed Livepeer stream webhooks", async () => {
    vi.stubEnv("LIVEPEER_WEBHOOK_SECRET", "livepeer-webhook-secret");
    const appliedEvents: unknown[] = [];
    const liveRepository = fakeLiveRepository({
      async onRecordLiveProviderWebhook() {
        return false;
      },
      async onUpdateRoomFromWebhook(input) {
        appliedEvents.push(input);
        return true;
      }
    });
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      liveRepository
    });
    await app.ready();
    const timestamp = Math.floor(Date.now() / 1000);
    const rawPayload = JSON.stringify({
      webhookId: "livepeer-webhook-1",
      timestamp: String(timestamp),
      event: "stream.started",
      event_object: {
        id: "livepeer-stream-13",
        playbackId: "livepeer-playback-13"
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/webhooks/media/livepeer",
      headers: {
        "content-type": "application/json",
        "livepeer-signature": livepeerSignature(rawPayload, timestamp)
      },
      payload: rawPayload
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({
      provider: "livepeer",
      received: 1,
      processed: 0
    });
    expect(appliedEvents).toEqual([]);

    await app.close();
    vi.unstubAllEnvs();
  });

  it("rejects Livepeer stream webhooks with invalid signatures", async () => {
    vi.stubEnv("LIVEPEER_WEBHOOK_SECRET", "livepeer-webhook-secret");
    const app = await buildApi({
      authVerifier: fakeAuthVerifier
    });
    await app.ready();
    const timestamp = Math.floor(Date.now() / 1000);

    const response = await app.inject({
      method: "POST",
      url: "/v1/webhooks/media/livepeer",
      headers: {
        "content-type": "application/json",
        "livepeer-signature": `t=${timestamp},v1=00`
      },
      payload: {
        webhookId: "livepeer-webhook-1",
        timestamp: String(timestamp),
        event: "stream.started",
        event_object: {
          id: "livepeer-stream-13",
          playbackId: "livepeer-playback-13"
        }
      }
    });

    expect(response.statusCode).toBe(401);

    await app.close();
    vi.unstubAllEnvs();
  });

  it("creates Bunny TUS credentials without exposing the Stream API key", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-04T00:00:00.000Z"));

    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ guid: "bunny-video-guid" }), {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      });
    });
    const adapter = createBunnyStreamUploadAdapter(
      {
        NODE_ENV: "test",
        API_URL: "http://localhost:4000",
        WEB_URL: "http://localhost:3000",
        SOLANA_CLUSTER: "devnet",
        SOLANA_NETWORK: "solana:devnet",
        SOLANA_RPC_URL: "https://api.devnet.solana.com",
        PAYMENT_DEFAULT_ASSET: "SOL",
        SOLANA_SUBSCRIPTION_DELEGATION_PROGRAM_ID: "De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44",
        HELIUS_CLUSTER: "devnet",
        ONRAMP_PROVIDER: "disabled",
        ONRAMP_PURCHASE_CURRENCY: "SOL",
        COINBASE_CDP_API_BASE_URL: "https://api.cdp.coinbase.com",
        COINBASE_ONRAMP_DESTINATION_NETWORK: "solana",
        AGE_VERIFICATION_ALLOW_MOCK_PROVIDER: false,
        SUMSUB_API_BASE_URL: "https://api.sumsub.com",
        YOTI_API_BASE_URL: "https://age.yoti.com/api/v1",
        YOTI_LAUNCH_BASE_URL: "https://age.yoti.com",
        VERIFF_API_BASE_URL: "https://stationapi.veriff.com",
        PERSONA_API_BASE_URL: "https://api.withpersona.com",
        BUNNY_STREAM_API_KEY: "bunny-secret",
        BUNNY_STREAM_LIBRARY_ID: "library-id",
        BUNNY_STREAM_PLAYBACK_TOKEN_TTL_SECONDS: 900
      },
      fetchMock
    );

    const session = await adapter.createUploadSession({
      contentId: "00000000-0000-4000-8000-000000000040",
      title: "studio cut",
      mimeType: "video/mp4"
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://video.bunnycdn.com/library/library-id/videos",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          AccessKey: "bunny-secret"
        }),
        body: JSON.stringify({ title: "studio cut" })
      })
    );
    expect(session).toMatchObject({
      provider: "bunny",
      providerAssetId: "bunny-video-guid",
      uploadUrl: "https://video.bunnycdn.com/tusupload",
      headers: {
        LibraryId: "library-id",
        VideoId: "bunny-video-guid"
      }
    });
    expect(session.headers.AuthorizationExpire).toMatch(/^\d+$/);
    expect(session.headers.AuthorizationSignature).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.values(session.headers)).not.toContain("bunny-secret");

    vi.useRealTimers();
  });

  it("creates a Bunny embed playback token without exposing the token key", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-04T00:00:00.000Z"));

    const adapter = createBunnyStreamUploadAdapter({
      NODE_ENV: "test",
      API_URL: "http://localhost:4000",
      WEB_URL: "http://localhost:3000",
      SOLANA_CLUSTER: "devnet",
      SOLANA_NETWORK: "solana:devnet",
      SOLANA_RPC_URL: "https://api.devnet.solana.com",
      PAYMENT_DEFAULT_ASSET: "SOL",
      SOLANA_SUBSCRIPTION_DELEGATION_PROGRAM_ID: "De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44",
      HELIUS_CLUSTER: "devnet",
      ONRAMP_PROVIDER: "disabled",
      ONRAMP_PURCHASE_CURRENCY: "SOL",
      COINBASE_CDP_API_BASE_URL: "https://api.cdp.coinbase.com",
      COINBASE_ONRAMP_DESTINATION_NETWORK: "solana",
      AGE_VERIFICATION_ALLOW_MOCK_PROVIDER: false,
      SUMSUB_API_BASE_URL: "https://api.sumsub.com",
      YOTI_API_BASE_URL: "https://age.yoti.com/api/v1",
      YOTI_LAUNCH_BASE_URL: "https://age.yoti.com",
      VERIFF_API_BASE_URL: "https://stationapi.veriff.com",
      PERSONA_API_BASE_URL: "https://api.withpersona.com",
      BUNNY_STREAM_API_KEY: "bunny-secret",
      BUNNY_STREAM_LIBRARY_ID: "759",
      BUNNY_STREAM_EMBED_TOKEN_KEY: "embed-token-secret",
      BUNNY_STREAM_PLAYBACK_TOKEN_TTL_SECONDS: 900
    });
    const providerAssetId = "eb1c4f77-0cda-46be-b47d-1118ad7c2ffe";
    const expires = 1_780_531_200 + 900;
    const token = createHash("sha256")
      .update(`embed-token-secret${providerAssetId}${expires}`)
      .digest("hex");

    const playback = adapter.createPlaybackResource?.({
      providerAssetId
    });

    expect(playback).toEqual({
      state: "full",
      url: `https://iframe.mediadelivery.net/embed/759/${providerAssetId}?token=${token}&expires=${expires}`,
      provider: "bunny",
      resourceType: "embed",
      expiresAt: "2026-06-04T00:15:00.000Z"
    });
    expect(playback?.url).not.toContain("embed-token-secret");

    vi.useRealTimers();
  });

  it("creates a native SOL payment intent for an app-ready user", async () => {
    vi.stubEnv("PAYMENT_PLATFORM_TREASURY_WALLET", treasuryWallet);
    const paymentRepository: PaymentRepository = {
      async createOrReuseIntent(input) {
        expect(input).toMatchObject({
          supabaseUserId: "00000000-0000-4000-8000-000000000001",
          idempotencyKey: "payment-intent-1",
          productType: "tip",
          targetId: "00000000-0000-4000-8000-000000000010",
          amountMinor: 10000000,
          currency: "SOL",
          solanaCluster: "devnet",
          treasuryWallet
        });

        return {
          ...storedPaymentIntent,
          referenceAddress: input.referenceAddress,
          requestHash: input.requestHash,
          expiresAt: input.expiresAt
        };
      },
      async findIntent() {
        throw new Error("not implemented");
      },
      async recordTransactionRequest() {
        throw new Error("not implemented");
      },
      async recordSubmission() {
        throw new Error("not implemented");
      }
    };
    vi.stubEnv("PAYMENT_PLATFORM_TREASURY_WALLET", treasuryWallet);
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      sessionRepository: appReadySessionRepository,
      ageRepository: verifiedAgeRepository,
      walletRepository: walletRepositoryWithWallet,
      paymentRepository,
      settlementVerifier: fakeUnconfirmedSettlementVerifier
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/v1/payments/intents",
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "payment-intent-1"
      },
      payload: {
        productType: "tip",
        targetId: "00000000-0000-4000-8000-000000000010",
        amountMinor: 10000000
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      id: storedPaymentIntent.id,
      productType: "tip",
      amountMinor: 10000000,
      currency: "SOL",
      state: "pending"
    });

    await app.close();
    vi.unstubAllEnvs();
  });

  it("creates an external referral token for an app-ready user", async () => {
    const referralRepository: ReferralRepository = {
      async createOrReuseToken(input) {
        expect(input).toMatchObject({
          supabaseUserId: "00000000-0000-4000-8000-000000000001",
          idempotencyKey: "referral-token-1",
          targetType: "content",
          targetId: "00000000-0000-4000-8000-000000000040",
          channel: "external"
        });
        expect(input.token).toMatch(/^veel_/);
        expect(input.url).toContain(`ref=${input.token}`);

        return {
          token: input.token,
          url: input.url,
          eligibility: "external_share"
        };
      },
      async listActivity() {
        throw new Error("not implemented");
      }
    };
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      sessionRepository: appReadySessionRepository,
      ageRepository: verifiedAgeRepository,
      walletRepository: walletRepositoryWithWallet,
      referralRepository
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/v1/referrals/tokens",
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "referral-token-1"
      },
      payload: {
        targetType: "content",
        targetId: "00000000-0000-4000-8000-000000000040",
        channel: "external"
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      eligibility: "external_share"
    });

    await app.close();
  });

  it("returns referral activity for the current user", async () => {
    const calls: Array<{ supabaseUserId: string; limit: number; cursor?: string }> = [];
    const referralRepository: ReferralRepository = {
      async createOrReuseToken() {
        throw new Error("not implemented");
      },
      async listActivity(input) {
        calls.push(input);

        return {
          items: [
            {
              id: "referral-activity-test-id",
              kind: "referral",
              title: "Referral share",
              state: "active",
              createdAt: "2026-06-04T20:00:00.000Z"
            }
          ],
          nextCursor: null
        };
      }
    };
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      sessionRepository: appReadySessionRepository,
      ageRepository: verifiedAgeRepository,
      walletRepository: walletRepositoryWithWallet,
      referralRepository
    });
    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: "/v1/referrals/activity",
      headers: {
        authorization: "Bearer valid-token"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      items: [
        {
          id: "referral-activity-test-id",
          kind: "referral",
          title: "Referral share",
          state: "active",
          createdAt: "2026-06-04T20:00:00.000Z"
        }
      ],
      nextCursor: null
    });

    const activityAliasResponse = await app.inject({
      method: "GET",
      url: "/v1/activity/referrals",
      headers: {
        authorization: "Bearer valid-token"
      }
    });

    expect(activityAliasResponse.statusCode).toBe(200);
    expect(activityAliasResponse.json()).toEqual(response.json());
    expect(calls).toEqual([
      {
        supabaseUserId: "00000000-0000-4000-8000-000000000001",
        limit: 20
      },
      {
        supabaseUserId: "00000000-0000-4000-8000-000000000001",
        limit: 20
      }
    ]);

    await app.close();
  });

  it("returns backend-derived payment activity for the current user", async () => {
    const activityRepository: ActivityRepository = {
      async listActivity() {
        throw new Error("not implemented");
      },
      async listPaymentActivity(input) {
        expect(input).toEqual({
          supabaseUserId: "00000000-0000-4000-8000-000000000001",
          limit: 20
        });

        return {
          items: [
            {
              id: "00000000-0000-4000-8000-000000000050",
              kind: "payment_intent",
              title: "Tip",
              state: "confirmed",
              productType: "tip",
              targetId: "00000000-0000-4000-8000-000000000010",
              amountMinor: 10000000,
              currency: "SOL",
              paymentIntentId: "00000000-0000-4000-8000-000000000050",
              signature: "5".repeat(88),
              referenceAddress: "11111111111111111111111111111112",
              createdAt: "2026-06-04T20:00:00.000Z",
              confirmedAt: "2026-06-04T20:01:00.000Z"
            }
          ],
          nextCursor: null
        };
      },
      async listWalletTransactions() {
        throw new Error("not implemented");
      },
      async listTickets() {
        throw new Error("not implemented");
      }
    };
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      sessionRepository: appReadySessionRepository,
      ageRepository: verifiedAgeRepository,
      activityRepository
    });
    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: "/v1/activity/payments",
      headers: {
        authorization: "Bearer valid-token"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      items: [
        {
          kind: "payment_intent",
          title: "Tip",
          state: "confirmed",
          productType: "tip",
          amountMinor: 10000000,
          currency: "SOL"
        }
      ],
      nextCursor: null
    });

    await app.close();
  });

  it("serves notification projections, preferences, and push devices without raw push secrets", async () => {
    const calls: Array<{ kind: string; input: unknown }> = [];
    const notificationRepository = fakeNotificationRepository({
      onListNotifications(input) {
        calls.push({ kind: "list", input });
        return {
          items: [
            notificationFixture({
              title: "Wallet action required",
              kind: "wallet_action_required",
              actionUrl: "/settings#wallet"
            })
          ],
          nextCursor: null
        };
      },
      onUpdatePreferences(input) {
        calls.push({ kind: "preferences", input });
        return notificationPreferencesFixture({
          pushEnabled: false,
          liveEnabled: false
        });
      },
      onRegisterDevice(input) {
        calls.push({ kind: "device", input });
        return notificationDeviceFixture({
          platform: input.body.platform
        });
      },
      onMarkRead(input) {
        calls.push({ kind: "read", input });
        return notificationFixture({
          id: input.notificationId,
          state: "read",
          readAt: "2026-06-06T09:01:00.000Z"
        });
      },
      onDeleteDevice(input) {
        calls.push({ kind: "delete", input });
        return true;
      }
    });
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      notificationRepository
    });
    await app.ready();

    const pushConfigResponse = await app.inject({
      method: "GET",
      url: "/v1/notifications/push-config"
    });
    const listResponse = await app.inject({
      method: "GET",
      url: "/v1/notifications",
      headers: {
        authorization: "Bearer valid-token"
      }
    });
    const preferenceResponse = await app.inject({
      method: "PATCH",
      url: "/v1/notifications/preferences",
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "pref"
      },
      payload: {
        pushEnabled: false,
        liveEnabled: false
      }
    });
    const deviceResponse = await app.inject({
      method: "POST",
      url: "/v1/notifications/devices",
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "dev"
      },
      payload: {
        provider: "web_push",
        platform: "desktop",
        endpoint: "https://push.example.test/token",
        p256dh: "browser-public-key",
        auth: "browser-auth-secret",
        userAgent: "Veel smoke"
      }
    });
    const readResponse = await app.inject({
      method: "PATCH",
      url: "/v1/notifications/00000000-0000-4000-8000-000000000090/read",
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "read"
      }
    });
    const deleteResponse = await app.inject({
      method: "DELETE",
      url: "/v1/notifications/devices/00000000-0000-4000-8000-000000000091",
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "del"
      }
    });

    expect(pushConfigResponse.statusCode).toBe(200);
    expect(pushConfigResponse.json()).toEqual({
      enabled: false,
      vapidPublicKey: null
    });
    expect(JSON.stringify(pushConfigResponse.json())).not.toMatch(/private|secret|endpoint|auth/i);
    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json()).toMatchObject({
      items: [
        {
          kind: "wallet_action_required",
          title: "Wallet action required",
          state: "unread",
          actionUrl: "/settings#wallet"
        }
      ],
      nextCursor: null
    });
    expect(preferenceResponse.statusCode).toBe(200);
    expect(preferenceResponse.json()).toMatchObject({
      pushEnabled: false,
      liveEnabled: false
    });
    expect(deviceResponse.statusCode).toBe(201);
    expect(JSON.stringify(deviceResponse.json())).not.toContain("https://push.example.test/token");
    expect(JSON.stringify(deviceResponse.json())).not.toContain("browser-auth-secret");
    expect(deviceResponse.json()).toMatchObject({
      provider: "web_push",
      platform: "desktop",
      state: "active"
    });
    expect(readResponse.statusCode).toBe(200);
    expect(readResponse.json()).toMatchObject({
      state: "read",
      readAt: "2026-06-06T09:01:00.000Z"
    });
    expect(deleteResponse.statusCode).toBe(202);
    expect(deleteResponse.json()).toEqual({ accepted: true });
    expect(calls).toEqual([
      {
        kind: "list",
        input: {
          supabaseUserId: "00000000-0000-4000-8000-000000000001",
          limit: 20
        }
      },
      {
        kind: "preferences",
        input: {
          supabaseUserId: "00000000-0000-4000-8000-000000000001",
          body: {
            pushEnabled: false,
            liveEnabled: false
          },
          idempotencyKey: "pref"
        }
      },
      {
        kind: "device",
        input: {
          supabaseUserId: "00000000-0000-4000-8000-000000000001",
          body: {
            provider: "web_push",
            platform: "desktop",
            endpoint: "https://push.example.test/token",
            p256dh: "browser-public-key",
            auth: "browser-auth-secret",
            userAgent: "Veel smoke"
          },
          idempotencyKey: "dev"
        }
      },
      {
        kind: "read",
        input: {
          supabaseUserId: "00000000-0000-4000-8000-000000000001",
          notificationId: "00000000-0000-4000-8000-000000000090",
          idempotencyKey: "read"
        }
      },
      {
        kind: "delete",
        input: {
          supabaseUserId: "00000000-0000-4000-8000-000000000001",
          notificationDeviceId: "00000000-0000-4000-8000-000000000091",
          idempotencyKey: "del"
        }
      }
    ]);

    await app.close();
  });

  it("returns member-scoped organization dashboards without custody state", async () => {
    const calls: Array<Parameters<OrganizationRepository["listMyDashboards"]>[0]> = [];
    const organizationRepository = fakeOrganizationRepository({
      onListMyDashboards(input) {
        calls.push(input);
        return {
          items: [organizationDashboardFixture()],
          nextCursor: null
        };
      }
    });
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      sessionRepository: appReadySessionRepository,
      ageRepository: verifiedAgeRepository,
      organizationRepository
    });
    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: "/v1/organizations",
      headers: {
        authorization: "Bearer valid-token"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      items: [
        {
          organization: {
            name: "Veel Enterprise",
            role: "owner",
            membershipState: "active"
          },
          governance: {
            kybState: "verified",
            activeMemberCount: 3,
            supportState: "priority"
          },
          capabilities: {
            rbacEnabled: true,
            consolidatedReportingEnabled: true
          },
          rolePermissions: expect.arrayContaining([
            expect.objectContaining({
              key: "manage_members",
              allowed: true,
              reason: "allowed"
            }),
            expect.objectContaining({
              key: "export_compliance",
              allowed: true,
              reason: "allowed"
            })
          ]),
          financeBoundary: "no_custody_no_payout_queue"
        }
      ],
      nextCursor: null
    });
    expect(JSON.stringify(response.json())).not.toMatch(/creatorBalance|withdraw|payoutQueue|escrow/i);
    expect(calls).toEqual([
      {
        supabaseUserId: "00000000-0000-4000-8000-000000000001",
        limit: 20
      }
    ]);

    await app.close();
  });

  it("returns backend-observed wallet transaction activity without raw provider payloads", async () => {
    const activityRepository: ActivityRepository = {
      async listActivity() {
        throw new Error("not implemented");
      },
      async listPaymentActivity() {
        throw new Error("not implemented");
      },
      async listWalletTransactions(input) {
        expect(input).toEqual({
          supabaseUserId: "00000000-0000-4000-8000-000000000001",
          limit: 20
        });

        return {
          items: [
            {
              id: "00000000-0000-4000-8000-000000000060",
              chain: "solana_devnet",
              direction: "outgoing",
              amountMinor: 10000000,
              currency: "SOL",
              state: "submitted",
              source: "payment_intent",
              paymentIntentId: "00000000-0000-4000-8000-000000000050",
              walletId: "00000000-0000-4000-8000-000000000030",
              signature: "4".repeat(88),
              referenceAddress: "11111111111111111111111111111112",
              createdAt: "2026-06-04T20:00:00.000Z",
              submittedAt: "2026-06-04T20:00:00.000Z",
              confirmedAt: null
            }
          ],
          nextCursor: null
        };
      },
      async listTickets() {
        throw new Error("not implemented");
      }
    };
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      sessionRepository: appReadySessionRepository,
      ageRepository: verifiedAgeRepository,
      activityRepository
    });
    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: "/v1/activity/wallet-transactions",
      headers: {
        authorization: "Bearer valid-token"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      items: [
        {
          chain: "solana_devnet",
          direction: "outgoing",
          amountMinor: 10000000,
          currency: "SOL",
          state: "submitted",
          source: "payment_intent"
        }
      ],
      nextCursor: null
    });
    expect(JSON.stringify(response.json())).not.toMatch(/raw|providerPayload|private/i);

    await app.close();
  });

  it("creates an event with backend-owned ticket inventory", async () => {
    const eventRepository: EventRepository = {
      async createEvent(input) {
        expect(input).toMatchObject({
          supabaseUserId: "00000000-0000-4000-8000-000000000001",
          idempotencyKey: "event-key"
        });
        expect(input.body.ticketTypes[0]).toMatchObject({
          label: "General admission",
          priceMinor: 10000000,
          currency: "SOL",
          capacity: 25
        });

        return eventFixture({ state: "draft" });
      },
      async findEvent() {
        throw new Error("not implemented");
      },
      async updateEvent() {
        throw new Error("not implemented");
      },
      async findTicketOffer() {
        throw new Error("not implemented");
      },
      async recordTicketPurchaseRequest() {
        throw new Error("not implemented");
      },
      async grantFreeTicket() {
        throw new Error("not implemented");
      },
      async createTicketRequest() {
        throw new Error("not implemented");
      },
      async checkInTicket() {
        throw new Error("not implemented");
      },
      async listTickets() {
        throw new Error("not implemented");
      }
    };
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      sessionRepository: appReadySessionRepository,
      ageRepository: verifiedAgeRepository,
      eventRepository
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/v1/events",
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "event-key"
      },
      payload: {
        title: "Studio meetup",
        startsAt: "2026-07-01T20:00:00.000Z",
        accessRule: "public_sale",
        location: { type: "physical", label: "Belgrade studio" },
        ticketTypes: [
          {
            label: "General admission",
            priceMinor: 10000000,
            currency: "SOL",
            capacity: 25
          }
        ]
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      title: "Studio meetup",
      state: "draft",
      ticketTypes: [{ label: "General admission", remaining: 25 }]
    });

    await app.close();
  });

  it("creates a server-priced paid ticket intent", async () => {
    const eventId = "00000000-0000-4000-8000-0000000000e1";
    const ticketTypeId = "00000000-0000-4000-8000-0000000000e2";
    const eventRepository: EventRepository = {
      async createEvent() {
        throw new Error("not implemented");
      },
      async findEvent() {
        throw new Error("not implemented");
      },
      async updateEvent() {
        throw new Error("not implemented");
      },
      async findTicketOffer(input) {
        expect(input).toMatchObject({ eventId, ticketTypeId });
        return {
          event: eventFixture({ id: eventId, state: "published", ticketTypeId }),
          ticketType: ticketTypeFixture({ id: ticketTypeId, priceMinor: 10000000 }),
          alreadyIssuedTicket: null
        };
      },
      async recordTicketPurchaseRequest(input) {
        expect(input).toMatchObject({
          eventId,
          ticketTypeId,
          paymentIntentId: "00000000-0000-4000-8000-000000000050",
          amountMinor: 10000000,
          currency: "SOL"
        });
      },
      async grantFreeTicket() {
        throw new Error("not implemented");
      },
      async createTicketRequest() {
        throw new Error("not implemented");
      },
      async checkInTicket() {
        throw new Error("not implemented");
      },
      async listTickets() {
        throw new Error("not implemented");
      }
    };
    const paymentRepository: PaymentRepository = {
      async createOrReuseIntent(input) {
        expect(input).toMatchObject({
          productType: "event_ticket",
          targetId: eventId,
          amountMinor: 10000000,
          currency: "SOL"
        });

        return {
          ...storedPaymentIntent,
          productType: "event_ticket",
          targetId: eventId,
          amountMinor: 10000000
        };
      },
      async findIntent() {
        throw new Error("not implemented");
      },
      async recordTransactionRequest() {
        throw new Error("not implemented");
      },
      async recordSubmission() {
        throw new Error("not implemented");
      }
    };
    vi.stubEnv("PAYMENT_PLATFORM_TREASURY_WALLET", treasuryWallet);
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      sessionRepository: appReadySessionRepository,
      ageRepository: verifiedAgeRepository,
      walletRepository: walletRepositoryWithWallet,
      eventRepository,
      paymentRepository
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: `/v1/events/${eventId}/tickets/intents`,
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "ticket-key"
      },
      payload: { ticketTypeId }
    });

    expect(response.statusCode, JSON.stringify(response.json())).toBe(201);
    expect(response.json()).toMatchObject({
      state: "payment_required",
      paymentIntent: {
        productType: "event_ticket",
        amountMinor: 10000000,
        currency: "SOL"
      }
    });

    await app.close();
  });

  it("grants a free ticket and supports ticket activity/check-in projections", async () => {
    const eventId = "00000000-0000-4000-8000-0000000000e1";
    const ticketTypeId = "00000000-0000-4000-8000-0000000000e2";
    const ticket = ticketFixture({ eventId, ticketTypeId });
    const eventRepository: EventRepository = {
      async createEvent() {
        throw new Error("not implemented");
      },
      async findEvent() {
        throw new Error("not implemented");
      },
      async updateEvent() {
        throw new Error("not implemented");
      },
      async findTicketOffer() {
        return {
          event: eventFixture({ id: eventId, state: "published", ticketTypeId, priceMinor: null }),
          ticketType: ticketTypeFixture({ id: ticketTypeId, priceMinor: null }),
          alreadyIssuedTicket: null
        };
      },
      async recordTicketPurchaseRequest() {
        throw new Error("not implemented");
      },
      async grantFreeTicket() {
        return ticket;
      },
      async createTicketRequest() {
        throw new Error("not implemented");
      },
      async checkInTicket(input) {
        expect(input).toMatchObject({ ticketId: ticket.id, qrToken: ticket.qrToken });
        return { ...ticket, state: "checked_in", checkedInAt: "2026-07-01T20:10:00.000Z" };
      },
      async listTickets() {
        throw new Error("not implemented");
      }
    };
    const activityRepository: ActivityRepository = {
      async listActivity() {
        throw new Error("not implemented");
      },
      async listPaymentActivity() {
        throw new Error("not implemented");
      },
      async listWalletTransactions() {
        throw new Error("not implemented");
      },
      async listTickets(input) {
        expect(input).toMatchObject({
          supabaseUserId: "00000000-0000-4000-8000-000000000001",
          limit: 20
        });
        return { items: [ticket], nextCursor: null };
      }
    };
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      sessionRepository: appReadySessionRepository,
      ageRepository: verifiedAgeRepository,
      eventRepository,
      activityRepository
    });
    await app.ready();

    const grantResponse = await app.inject({
      method: "POST",
      url: `/v1/events/${eventId}/tickets/intents`,
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "free-ticket-key"
      },
      payload: { ticketTypeId }
    });
    const activityResponse = await app.inject({
      method: "GET",
      url: "/v1/activity/tickets",
      headers: { authorization: "Bearer valid-token" }
    });
    const checkInResponse = await app.inject({
      method: "POST",
      url: `/v1/tickets/${ticket.id}/check-in`,
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "check-in-key"
      },
      payload: { qrToken: ticket.qrToken }
    });

    expect(grantResponse.statusCode).toBe(201);
    expect(grantResponse.json()).toMatchObject({ state: "free_granted", ticket });
    expect(activityResponse.statusCode).toBe(200);
    expect(activityResponse.json()).toMatchObject({ items: [ticket], nextCursor: null });
    expect(checkInResponse.statusCode).toBe(200);
    expect(checkInResponse.json()).toMatchObject({ state: "checked_in" });

    await app.close();
  });

  it("activates dating mode and returns the explicit dating feed", async () => {
    const datingRepository: DatingRepository = {
      async activate(input) {
        expect(input).toMatchObject({
          supabaseUserId: "00000000-0000-4000-8000-000000000001",
          consentVersion: "dating-consent-2026-06-04"
        });
        return datingProfileFixture({ enabled: true });
      },
      async updatePreferences() {
        throw new Error("not implemented");
      },
      async listFeed(input) {
        expect(input).toMatchObject({
          supabaseUserId: "00000000-0000-4000-8000-000000000001",
          limit: 20
        });
        return {
          items: [datingFeedItemFixture()],
          nextCursor: null
        };
      },
      async createSwipe() {
        throw new Error("not implemented");
      },
      async listMatches() {
        throw new Error("not implemented");
      },
      async archiveMatch() {
        throw new Error("not implemented");
      }
    };
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      sessionRepository: appReadySessionRepository,
      ageRepository: verifiedAgeRepository,
      datingRepository
    });
    await app.ready();

    const activateResponse = await app.inject({
      method: "POST",
      url: "/v1/dating/activate",
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "dating-activate-key"
      },
      payload: { consentVersion: "dating-consent-2026-06-04" }
    });
    const feedResponse = await app.inject({
      method: "GET",
      url: "/v1/dating/feed",
      headers: { authorization: "Bearer valid-token" }
    });

    expect(activateResponse.statusCode).toBe(200);
    expect(activateResponse.json()).toMatchObject({
      enabled: true,
      consentVersion: "dating-consent-2026-06-04",
      activeMatchLimit: 10
    });
    expect(feedResponse.statusCode).toBe(200);
    expect(feedResponse.json()).toMatchObject({
      items: [
        {
          handle: "maki",
          title: "Dating mode profile card",
          mediaKind: "image"
        }
      ],
      nextCursor: null
    });

    await app.close();
  });

  it("creates a mutual dating match from backend-owned swipe state", async () => {
    const match = datingMatchFixture();
    const datingRepository: DatingRepository = {
      async activate() {
        throw new Error("not implemented");
      },
      async updatePreferences() {
        throw new Error("not implemented");
      },
      async listFeed() {
        throw new Error("not implemented");
      },
      async createSwipe(input) {
        expect(input).toMatchObject({
          supabaseUserId: "00000000-0000-4000-8000-000000000001",
          idempotencyKey: "dating-swipe-key",
          body: {
            targetUserId: "00000000-0000-4000-8000-000000000011",
            contentId: "00000000-0000-4000-8000-000000000040",
            action: "yes"
          }
        });
        return {
          swipeId: "00000000-0000-4000-8000-0000000000d1",
          matchCreated: true,
          matchId: match.id,
          match
        };
      },
      async listMatches(input) {
        expect(input).toMatchObject({
          supabaseUserId: "00000000-0000-4000-8000-000000000001",
          limit: 20
        });
        return { items: [match], nextCursor: null };
      },
      async archiveMatch(input) {
        expect(input).toMatchObject({ matchId: match.id });
        return { ...match, state: "archived" };
      }
    };
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      sessionRepository: appReadySessionRepository,
      ageRepository: verifiedAgeRepository,
      datingRepository
    });
    await app.ready();

    const swipeResponse = await app.inject({
      method: "POST",
      url: "/v1/dating/swipes",
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "dating-swipe-key"
      },
      payload: {
        targetUserId: "00000000-0000-4000-8000-000000000011",
        contentId: "00000000-0000-4000-8000-000000000040",
        action: "yes"
      }
    });
    const matchesResponse = await app.inject({
      method: "GET",
      url: "/v1/dating/matches",
      headers: { authorization: "Bearer valid-token" }
    });
    const archiveResponse = await app.inject({
      method: "PATCH",
      url: `/v1/dating/matches/${match.id}/archive`,
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "dating-archive-key"
      }
    });

    expect(swipeResponse.statusCode).toBe(200);
    expect(swipeResponse.json()).toMatchObject({
      matchCreated: true,
      matchId: match.id,
      match: { conversationId: match.conversationId }
    });
    expect(matchesResponse.statusCode).toBe(200);
    expect(matchesResponse.json()).toMatchObject({ items: [match], nextCursor: null });
    expect(archiveResponse.statusCode).toBe(200);
    expect(archiveResponse.json()).toMatchObject({ state: "archived" });

    await app.close();
  });

  it("creates scoped AI sessions and executes safe user tools", async () => {
    const aiRepository = fakeAiRepository();
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      sessionRepository: appReadySessionRepository,
      ageRepository: verifiedAgeRepository,
      aiRepository
    });
    await app.ready();

    const sessionResponse = await app.inject({
      method: "POST",
      url: "/v1/ai/sessions",
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "ai-session-1"
      },
      payload: {
        scope: "user_self_service",
        requestedTools: ["explain_app_state", "provider_health_summary"]
      }
    });
    const session = sessionResponse.json() as AiSession;
    const toolResponse = await app.inject({
      method: "POST",
      url: `/v1/ai/sessions/${session.id}/tool-calls`,
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "ai-tool-1"
      },
      payload: {
        toolName: "explain_app_state",
        input: { topic: "payments" }
      }
    });

    expect(sessionResponse.statusCode).toBe(201);
    expect(session).toMatchObject({
      scope: "user_self_service",
      state: "active",
      allowedTools: ["explain_app_state"]
    });
    expect(toolResponse.statusCode).toBe(201);
    expect(toolResponse.json()).toMatchObject({
      toolName: "explain_app_state",
      state: "executed",
      confirmationState: "not_required",
      outputSummary: "App state explanation prepared"
    });

    await app.close();
  });

  it("returns AI capabilities without creating a session", async () => {
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      sessionRepository: appReadySessionRepository,
      ageRepository: verifiedAgeRepository,
      adminRepository: fakeAdminRepository,
      aiRepository: fakeAiRepository()
    });
    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: "/v1/ai/capabilities",
      headers: {
        authorization: "Bearer valid-token"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      items: [
        {
          scope: "user_self_service",
          canStartSession: true,
          allowedTools: ["explain_app_state", "summarize_own_activity", "find_own_purchases"],
          confirmationRequiredTools: []
        },
        {
          scope: "creator_helper",
          canStartSession: true,
          allowedTools: expect.arrayContaining(["draft_caption", "prepare_event_copy"]),
          confirmationRequiredTools: []
        },
        {
          scope: "admin_ops",
          canStartSession: true,
          allowedTools: expect.arrayContaining(["prepare_refund_decision"]),
          confirmationRequiredTools: expect.arrayContaining(["prepare_refund_decision"])
        }
      ]
    });

    await app.close();
  });

  it("prepares confirmation-required admin AI tools without mutating admin state", async () => {
    const aiRepository = fakeAiRepository();
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      sessionRepository: appReadySessionRepository,
      ageRepository: verifiedAgeRepository,
      adminRepository: fakeAdminRepository,
      aiRepository
    });
    await app.ready();

    const sessionResponse = await app.inject({
      method: "POST",
      url: "/v1/ai/sessions",
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "ai-admin-session-1"
      },
      payload: {
        scope: "admin_ops",
        requestedTools: ["prepare_refund_decision"]
      }
    });
    const session = sessionResponse.json() as AiSession;
    const toolResponse = await app.inject({
      method: "POST",
      url: `/v1/ai/sessions/${session.id}/tool-calls`,
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "ai-admin-tool-1"
      },
      payload: {
        toolName: "prepare_refund_decision",
        input: { resourceType: "payment", resourceId: "00000000-0000-4000-8000-000000000050" }
      }
    });

    expect(sessionResponse.statusCode).toBe(201);
    expect(toolResponse.statusCode).toBe(201);
    expect(toolResponse.json()).toMatchObject({
      toolName: "prepare_refund_decision",
      state: "prepared",
      confirmationState: "required",
      affectedResource: {
        type: "payment",
        id: "00000000-0000-4000-8000-000000000050"
      }
    });

    await app.close();
  });

  it("rejects admin AI sessions for non-staff users", async () => {
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      sessionRepository: appReadySessionRepository,
      ageRepository: verifiedAgeRepository,
      adminRepository: {
        async hasAdminAccess() {
          return false;
        },
        async getOpsSummary() {
          throw new Error("not implemented");
        },
        async getNotificationHealth() {
          throw new Error("not implemented");
        },
        async listPaymentIntents() {
          throw new Error("not implemented");
        },
        async listUnlocks() {
          throw new Error("not implemented");
        },
        async listProviderEvents() {
          throw new Error("not implemented");
        },
        async listSupportCases() {
          throw new Error("not implemented");
        },
        async updateSupportCase() {
          throw new Error("not implemented");
        },
        async listSupportPolicies() {
          throw new Error("not implemented");
        },
        async updateSupportPolicy() {
          throw new Error("not implemented");
        },
        async listRefundDisputes() {
          throw new Error("not implemented");
        },
        async updateRefundDispute() {
          throw new Error("not implemented");
        },
        async getDatingSafety() {
          throw new Error("not implemented");
        },
        async updateOrganizationKyb() {
          throw new Error("not implemented");
        },
        async listOrganizationMembers() {
          throw new Error("not implemented");
        },
        async updateOrganizationMember() {
          throw new Error("not implemented");
        },
        ...unimplementedComplianceAdminMethods
      },
      aiRepository: fakeAiRepository()
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/v1/ai/sessions",
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "ai-admin-denied"
      },
      payload: {
        scope: "admin_ops"
      }
    });

    expect(response.statusCode).toBe(403);

    await app.close();
  });

  it("does not expose admin AI capabilities to non-staff users", async () => {
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      sessionRepository: appReadySessionRepository,
      ageRepository: verifiedAgeRepository,
      adminRepository: {
        async hasAdminAccess() {
          return false;
        },
        async getOpsSummary() {
          throw new Error("not implemented");
        },
        async getNotificationHealth() {
          throw new Error("not implemented");
        },
        async listPaymentIntents() {
          throw new Error("not implemented");
        },
        async listUnlocks() {
          throw new Error("not implemented");
        },
        async listProviderEvents() {
          throw new Error("not implemented");
        },
        async listSupportCases() {
          throw new Error("not implemented");
        },
        async updateSupportCase() {
          throw new Error("not implemented");
        },
        async listSupportPolicies() {
          throw new Error("not implemented");
        },
        async updateSupportPolicy() {
          throw new Error("not implemented");
        },
        async listRefundDisputes() {
          throw new Error("not implemented");
        },
        async updateRefundDispute() {
          throw new Error("not implemented");
        },
        async getDatingSafety() {
          throw new Error("not implemented");
        },
        async updateOrganizationKyb() {
          throw new Error("not implemented");
        },
        async listOrganizationMembers() {
          throw new Error("not implemented");
        },
        async updateOrganizationMember() {
          throw new Error("not implemented");
        },
        ...unimplementedComplianceAdminMethods
      },
      aiRepository: fakeAiRepository()
    });
    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: "/v1/ai/capabilities",
      headers: {
        authorization: "Bearer valid-token"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().items.map((item: { scope: string }) => item.scope)).toEqual([
      "user_self_service",
      "creator_helper"
    ]);

    await app.close();
  });

  it("rejects admin reads for non-staff users", async () => {
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      adminRepository: {
        async hasAdminAccess() {
          return false;
        },
        async getOpsSummary() {
          throw new Error("not implemented");
        },
        async getNotificationHealth() {
          throw new Error("not implemented");
        },
        async listPaymentIntents() {
          throw new Error("not implemented");
        },
        async listUnlocks() {
          throw new Error("not implemented");
        },
        async listProviderEvents() {
          throw new Error("not implemented");
        },
        async listSupportCases() {
          throw new Error("not implemented");
        },
        async updateSupportCase() {
          throw new Error("not implemented");
        },
        async listSupportPolicies() {
          throw new Error("not implemented");
        },
        async updateSupportPolicy() {
          throw new Error("not implemented");
        },
        async listRefundDisputes() {
          throw new Error("not implemented");
        },
        async updateRefundDispute() {
          throw new Error("not implemented");
        },
        async getDatingSafety() {
          throw new Error("not implemented");
        },
        async updateOrganizationKyb() {
          throw new Error("not implemented");
        },
        async listOrganizationMembers() {
          throw new Error("not implemented");
        },
        async updateOrganizationMember() {
          throw new Error("not implemented");
        },
        ...unimplementedComplianceAdminMethods
      }
    });
    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: "/v1/admin/ops/summary",
      headers: {
        authorization: "Bearer valid-token"
      }
    });

    expect(response.statusCode).toBe(403);

    await app.close();
  });

  it("returns admin compliance, referral governance, tier waiver, and organization projections", async () => {
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      adminRepository: fakeAdminRepository
    });
    await app.ready();

    const headers = { authorization: "Bearer valid-token" };
    const [
      ledger,
      dac7Reports,
      carfReports,
      vatDeterminations,
      receipts,
      invoices,
      referralPrograms,
      partnerCampaigns,
      tierWaivers,
      organizations
    ] = await Promise.all([
      app.inject({ method: "GET", url: "/v1/admin/compliance/ledger", headers }),
      app.inject({ method: "GET", url: "/v1/admin/compliance/dac7/reports", headers }),
      app.inject({ method: "GET", url: "/v1/admin/compliance/carf/reports", headers }),
      app.inject({ method: "GET", url: "/v1/admin/compliance/vat/determinations", headers }),
      app.inject({ method: "GET", url: "/v1/admin/compliance/receipts", headers }),
      app.inject({ method: "GET", url: "/v1/admin/compliance/invoices", headers }),
      app.inject({ method: "GET", url: "/v1/admin/referrals/programs", headers }),
      app.inject({ method: "GET", url: "/v1/admin/referrals/partner-campaigns", headers }),
      app.inject({ method: "GET", url: "/v1/admin/tier-waivers", headers }),
      app.inject({ method: "GET", url: "/v1/admin/organizations", headers })
    ]);

    for (const response of [
      ledger,
      dac7Reports,
      carfReports,
      vatDeterminations,
      receipts,
      invoices,
      referralPrograms,
      partnerCampaigns,
      tierWaivers,
      organizations
    ]) {
      expect(response.statusCode).toBe(200);
      expect(JSON.stringify(response.json())).not.toMatch(/raw|payload|secret|privateKey|serviceRole/i);
    }

    expect(ledger.json().items[0]).toMatchObject({
      productType: "event_access_pass",
      vatStatus: "pending",
      dac7Reportable: true
    });
    expect(carfReports.json().items[0]).toMatchObject({
      reportType: "carf",
      carfReportingRequired: false
    });
    expect(referralPrograms.json().items[0]).toMatchObject({
      commissionSource: "veel_platform_commission_net_of_refunds_and_tax"
    });
    expect(organizations.json().items[0]).toMatchObject({
      plan: "enterprise",
      kybState: "pending"
    });

    await app.close();
  });

  it("returns sanitized admin support case and policy projections", async () => {
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      adminRepository: fakeAdminRepository
    });
    await app.ready();

    const headers = { authorization: "Bearer valid-token" };
    const [supportCases, supportPolicies] = await Promise.all([
      app.inject({ method: "GET", url: "/v1/admin/support/cases", headers }),
      app.inject({ method: "GET", url: "/v1/admin/support/policies", headers })
    ]);

    expect(supportCases.statusCode).toBe(200);
    expect(supportCases.json().items[0]).toMatchObject({
      category: "organization",
      priority: "enterprise_review",
      subjectType: "organization"
    });
    expect(supportPolicies.statusCode).toBe(200);
    expect(supportPolicies.json().items[0]).toMatchObject({
      supportState: "enterprise_review",
      moneyBoundary: "software_sla_only_no_social_priority"
    });
    expect(`${supportCases.body}${supportPolicies.body}`).not.toMatch(
      /raw|payload|secret|privateKey|serviceRole|balance|withdraw|payout|escrow|recommendation|visibility|messagePriority/i
    );

    await app.close();
  });

  it("updates support cases and support policies through audited admin mutations", async () => {
    const supportCaseCalls: Array<Parameters<AdminRepository["updateSupportCase"]>[0]> = [];
    const supportPolicyCalls: Array<Parameters<AdminRepository["updateSupportPolicy"]>[0]> = [];
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      adminRepository: {
        ...fakeAdminRepository,
        async updateSupportCase(input) {
          supportCaseCalls.push(input);
          return fakeAdminRepository.updateSupportCase(input);
        },
        async updateSupportPolicy(input) {
          supportPolicyCalls.push(input);
          return fakeAdminRepository.updateSupportPolicy(input);
        }
      }
    });
    await app.ready();

    const supportCase = await app.inject({
      method: "PATCH",
      url: "/v1/admin/support/cases/00000000-0000-4000-8000-000000000150",
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "support-case-1"
      },
      payload: {
        state: "pending_internal",
        reason: "KYB evidence requires internal support review"
      }
    });
    const supportPolicy = await app.inject({
      method: "PATCH",
      url: "/v1/admin/support/policies/00000000-0000-4000-8000-000000000151",
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "support-policy-1"
      },
      payload: {
        supportState: "priority",
        slaTier: "priority",
        state: "active",
        reason: "Enterprise contract reviewed; software SLA only"
      }
    });

    expect(supportCase.statusCode).toBe(200);
    expect(supportCase.json()).toMatchObject({
      id: "00000000-0000-4000-8000-000000000150",
      state: "pending_internal"
    });
    expect(supportPolicy.statusCode).toBe(200);
    expect(supportPolicy.json()).toMatchObject({
      id: "00000000-0000-4000-8000-000000000151",
      supportState: "priority",
      moneyBoundary: "software_sla_only_no_social_priority"
    });
    expect(supportCaseCalls[0]).toMatchObject({
      supabaseUserId: "00000000-0000-4000-8000-000000000001",
      idempotencyKey: "support-case-1"
    });
    expect(supportPolicyCalls[0]).toMatchObject({
      supabaseUserId: "00000000-0000-4000-8000-000000000001",
      idempotencyKey: "support-policy-1"
    });
    expect(`${supportCase.body}${supportPolicy.body}`).not.toMatch(
      /balance|withdraw|payout|escrow|privateKey|serviceRole|recommendation|visibility|messagePriority/i
    );

    await app.close();
  });

  it("rejects support policy updates without idempotency", async () => {
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      adminRepository: fakeAdminRepository
    });
    await app.ready();

    const response = await app.inject({
      method: "PATCH",
      url: "/v1/admin/support/policies/00000000-0000-4000-8000-000000000151",
      headers: {
        authorization: "Bearer valid-token"
      },
      payload: {
        supportState: "priority",
        slaTier: "priority",
        state: "active",
        reason: "Missing idempotency should fail"
      }
    });

    expect(response.statusCode).toBe(400);

    await app.close();
  });

  it("creates and lists refund dispute requests without custody or payout obligations", async () => {
    const createCalls: Array<Parameters<RefundRepository["createRequest"]>[0]> = [];
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      sessionRepository: appReadySessionRepository,
      ageRepository: verifiedAgeRepository,
      refundRepository: fakeRefundRepository({
        onCreateRequest(input) {
          createCalls.push(input);
        }
      })
    });
    await app.ready();

    const created = await app.inject({
      method: "POST",
      url: "/v1/refunds/requests",
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "refund-request-1"
      },
      payload: {
        paymentIntentId: "00000000-0000-4000-8000-000000000050",
        kind: "refund_request",
        requestedAction: "creator_refund",
        reason: "Content access was not available after the confirmed transaction"
      }
    });
    const listed = await app.inject({
      method: "GET",
      url: "/v1/refunds/requests",
      headers: {
        authorization: "Bearer valid-token"
      }
    });

    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      paymentIntentId: "00000000-0000-4000-8000-000000000050",
      kind: "refund_request",
      requestedAction: "creator_refund",
      custodyBoundary: "no_platform_custody_no_payout_queue"
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().items[0]).toMatchObject({
      state: "opened",
      custodyBoundary: "no_platform_custody_no_payout_queue"
    });
    expect(createCalls[0]).toMatchObject({
      supabaseUserId: "00000000-0000-4000-8000-000000000001",
      idempotencyKey: "refund-request-1"
    });
    expect(`${created.body}${listed.body}`).not.toMatch(
      /raw|payload|secret|privateKey|serviceRole|creatorBalance|withdraw|payoutQueue|escrow|paymentProof|automaticRefund|platformBalance/i
    );

    await app.close();
  });

  it("rejects refund dispute requests without idempotency", async () => {
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      sessionRepository: appReadySessionRepository,
      ageRepository: verifiedAgeRepository,
      refundRepository: fakeRefundRepository()
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/v1/refunds/requests",
      headers: {
        authorization: "Bearer valid-token"
      },
      payload: {
        paymentIntentId: "00000000-0000-4000-8000-000000000050",
        kind: "access_issue",
        requestedAction: "review_only",
        reason: "Access state needs review by support"
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      code: "validation_failed"
    });

    await app.close();
  });

  it("returns and updates sanitized admin refund dispute projections", async () => {
    const updateCalls: Array<Parameters<AdminRepository["updateRefundDispute"]>[0]> = [];
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      adminRepository: {
        ...fakeAdminRepository,
        async updateRefundDispute(input) {
          updateCalls.push(input);
          return fakeAdminRepository.updateRefundDispute(input);
        }
      }
    });
    await app.ready();

    const headers = { authorization: "Bearer valid-token" };
    const listed = await app.inject({
      method: "GET",
      url: "/v1/admin/refunds/disputes",
      headers
    });
    const updated = await app.inject({
      method: "PATCH",
      url: "/v1/admin/refunds/disputes/00000000-0000-4000-8000-000000000160",
      headers: {
        ...headers,
        "idempotency-key": "refund-admin-1"
      },
      payload: {
        state: "creator_action_required",
        resolution: "Creator must decide whether to submit a noncustodial refund transaction",
        reason: "Confirmed access issue after support review"
      }
    });

    expect(listed.statusCode).toBe(200);
    expect(listed.json().items[0]).toMatchObject({
      kind: "access_issue",
      custodyBoundary: "no_platform_custody_no_payout_queue"
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({
      id: "00000000-0000-4000-8000-000000000160",
      state: "creator_action_required",
      custodyBoundary: "no_platform_custody_no_payout_queue"
    });
    expect(updateCalls[0]).toMatchObject({
      supabaseUserId: "00000000-0000-4000-8000-000000000001",
      idempotencyKey: "refund-admin-1"
    });
    expect(`${listed.body}${updated.body}`).not.toMatch(
      /raw|payload|secret|privateKey|serviceRole|creatorBalance|withdraw|payoutQueue|escrow|paymentProof|automaticRefund|platformBalance/i
    );

    await app.close();
  });

  it("rejects admin refund dispute updates without idempotency", async () => {
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      adminRepository: fakeAdminRepository
    });
    await app.ready();

    const response = await app.inject({
      method: "PATCH",
      url: "/v1/admin/refunds/disputes/00000000-0000-4000-8000-000000000160",
      headers: {
        authorization: "Bearer valid-token"
      },
      payload: {
        state: "reviewing",
        resolution: "Review opened",
        reason: "Missing idempotency should fail"
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      code: "validation_failed"
    });

    await app.close();
  });

  it("updates organization KYB state through an audited admin mutation", async () => {
    const calls: Array<Parameters<AdminRepository["updateOrganizationKyb"]>[0]> = [];
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      adminRepository: {
        ...fakeAdminRepository,
        async updateOrganizationKyb(input) {
          calls.push(input);
          return {
            id: input.organizationId,
            name: "Veel Enterprise",
            state: "active",
            plan: "enterprise",
            kybState: input.body.kybState,
            createdAt: "2026-06-05T10:00:00.000Z"
          };
        }
      }
    });
    await app.ready();

    const response = await app.inject({
      method: "PATCH",
      url: "/v1/admin/organizations/00000000-0000-4000-8000-000000000140/kyb",
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "org-kyb-1"
      },
      payload: {
        kybState: "verified",
        reason: "KYB provider review completed"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: "00000000-0000-4000-8000-000000000140",
      state: "active",
      kybState: "verified"
    });
    expect(calls[0]).toMatchObject({
      supabaseUserId: "00000000-0000-4000-8000-000000000001",
      idempotencyKey: "org-kyb-1",
      body: {
        kybState: "verified",
        reason: "KYB provider review completed"
      }
    });
    expect(response.body).not.toMatch(/balance|withdraw|payout|escrow|privateKey|serviceRole/i);

    await app.close();
  });

  it("rejects organization KYB updates without idempotency", async () => {
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      adminRepository: fakeAdminRepository
    });
    await app.ready();

    const response = await app.inject({
      method: "PATCH",
      url: "/v1/admin/organizations/00000000-0000-4000-8000-000000000140/kyb",
      headers: {
        authorization: "Bearer valid-token"
      },
      payload: {
        kybState: "verified",
        reason: "KYB provider review completed"
      }
    });

    expect(response.statusCode).toBe(400);

    await app.close();
  });

  it("returns admin organization members without money or profile payloads", async () => {
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      adminRepository: fakeAdminRepository
    });
    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: "/v1/admin/organizations/00000000-0000-4000-8000-000000000140/members",
      headers: { authorization: "Bearer valid-token" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      items: [
        {
          id: "00000000-0000-4000-8000-000000000141",
          organizationId: "00000000-0000-4000-8000-000000000140",
          userId: "00000000-0000-4000-8000-000000000001",
          role: "owner",
          state: "active"
        }
      ],
      nextCursor: null
    });
    expect(response.body).not.toMatch(/email|displayName|handle|balance|withdraw|payout|escrow|privateKey|serviceRole|rawPayload/i);

    await app.close();
  });

  it("updates organization member role and state through an audited admin mutation", async () => {
    const calls: Array<Parameters<AdminRepository["updateOrganizationMember"]>[0]> = [];
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      adminRepository: {
        ...fakeAdminRepository,
        async updateOrganizationMember(input) {
          calls.push(input);
          return {
            id: input.membershipId,
            organizationId: input.organizationId,
            userId: "00000000-0000-4000-8000-000000000011",
            role: input.body.role,
            state: input.body.state,
            invitedByUserId: "00000000-0000-4000-8000-000000000001",
            joinedAt: "2026-06-06T12:00:00.000Z",
            createdAt: "2026-06-05T10:00:00.000Z",
            updatedAt: "2026-06-06T12:30:00.000Z"
          };
        }
      }
    });
    await app.ready();

    const response = await app.inject({
      method: "PATCH",
      url: "/v1/admin/organizations/00000000-0000-4000-8000-000000000140/members/00000000-0000-4000-8000-000000000142",
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "org-member-1"
      },
      payload: {
        role: "admin",
        state: "active",
        reason: "Enterprise admin handoff approved"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: "00000000-0000-4000-8000-000000000142",
      role: "admin",
      state: "active"
    });
    expect(calls[0]).toMatchObject({
      supabaseUserId: "00000000-0000-4000-8000-000000000001",
      organizationId: "00000000-0000-4000-8000-000000000140",
      membershipId: "00000000-0000-4000-8000-000000000142",
      idempotencyKey: "org-member-1",
      body: {
        role: "admin",
        state: "active",
        reason: "Enterprise admin handoff approved"
      }
    });
    expect(response.body).not.toMatch(/balance|withdraw|payout|escrow|privateKey|serviceRole|recommendation|visibility/i);

    await app.close();
  });

  it("rejects organization member updates without idempotency", async () => {
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      adminRepository: fakeAdminRepository
    });
    await app.ready();

    const response = await app.inject({
      method: "PATCH",
      url: "/v1/admin/organizations/00000000-0000-4000-8000-000000000140/members/00000000-0000-4000-8000-000000000142",
      headers: {
        authorization: "Bearer valid-token"
      },
      payload: {
        role: "admin",
        state: "active",
        reason: "Enterprise admin handoff approved"
      }
    });

    expect(response.statusCode).toBe(400);

    await app.close();
  });

  it("rejects organization member updates that would remove the last active owner", async () => {
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      adminRepository: {
        ...fakeAdminRepository,
        async updateOrganizationMember() {
          throw new AdminRepositoryStateConflictError("At least one active organization owner is required");
        }
      }
    });
    await app.ready();

    const response = await app.inject({
      method: "PATCH",
      url: "/v1/admin/organizations/00000000-0000-4000-8000-000000000140/members/00000000-0000-4000-8000-000000000141",
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "org-member-last-owner"
      },
      payload: {
        role: "viewer",
        state: "suspended",
        reason: "Test last owner guard"
      }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      code: "conflict",
      message: "At least one active organization owner is required"
    });

    await app.close();
  });

  it("returns admin payment, unlock, and provider ops projections", async () => {
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      adminRepository: fakeAdminRepository
    });
    await app.ready();

    const [summary, notificationHealth, payments, unlocks, providerEvents] = await Promise.all([
      app.inject({
        method: "GET",
        url: "/v1/admin/ops/summary",
        headers: { authorization: "Bearer valid-token" }
      }),
      app.inject({
        method: "GET",
        url: "/v1/admin/notifications/health",
        headers: { authorization: "Bearer valid-token" }
      }),
      app.inject({
        method: "GET",
        url: "/v1/admin/payments/intents?q=1111",
        headers: { authorization: "Bearer valid-token" }
      }),
      app.inject({
        method: "GET",
        url: "/v1/admin/unlocks",
        headers: { authorization: "Bearer valid-token" }
      }),
      app.inject({
        method: "GET",
        url: "/v1/admin/provider-events",
        headers: { authorization: "Bearer valid-token" }
      })
    ]);

    expect(summary.statusCode).toBe(200);
    expect(summary.json()).toMatchObject({
      providerHealth: "ok",
      paymentCounts: { confirmed: 1 },
      unlockCounts: { confirmed: 1 }
    });
    expect(notificationHealth.statusCode).toBe(200);
    expect(notificationHealth.json()).toMatchObject({
      unreadCount: 2,
      activeDeviceCount: 1,
      pushEnabledPreferenceCount: 1,
      queuedDeliveryCount: 2,
      deliveredDeliveryCount: 7
    });
    expect(JSON.stringify(notificationHealth.json())).not.toMatch(/raw|payload|endpoint|auth|secret|privateKey|serviceRole/i);
    expect(payments.statusCode).toBe(200);
    expect(payments.json().items[0]).toMatchObject({
      productType: "content_unlock",
      state: "confirmed",
      settlementAttemptCount: 1,
      entitlementId: "00000000-0000-4000-8000-000000000090"
    });
    expect(unlocks.statusCode).toBe(200);
    expect(unlocks.json().items[0]).toMatchObject({
      productType: "content_unlock",
      state: "active"
    });
    expect(providerEvents.statusCode).toBe(200);
    expect(providerEvents.json().items[0]).toMatchObject({
      provider: "solana_rpc",
      eventType: "payment.settlement",
      state: "processed"
    });
    expect(JSON.stringify(providerEvents.json())).not.toMatch(/raw|payload|secret|streamKey/i);

    await app.close();
  });

  it("passes referral tokens to backend-owned payment intent creation", async () => {
    vi.stubEnv("PAYMENT_PLATFORM_TREASURY_WALLET", treasuryWallet);
    const paymentRepository: PaymentRepository = {
      async createOrReuseIntent(input) {
        expect(input).toMatchObject({
          productType: "tip",
          targetId: "00000000-0000-4000-8000-000000000010",
          amountMinor: 10000000,
          referralToken: "veel_referral_token"
        });

        return {
          ...storedPaymentIntent,
          referenceAddress: input.referenceAddress,
          requestHash: input.requestHash,
          expiresAt: input.expiresAt
        };
      },
      async findIntent() {
        throw new Error("not implemented");
      },
      async recordTransactionRequest() {
        throw new Error("not implemented");
      },
      async recordSubmission() {
        throw new Error("not implemented");
      }
    };
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      sessionRepository: appReadySessionRepository,
      ageRepository: verifiedAgeRepository,
      walletRepository: walletRepositoryWithWallet,
      paymentRepository,
      settlementVerifier: fakeUnconfirmedSettlementVerifier
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/v1/payments/intents",
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "payment-intent-referral-1"
      },
      payload: {
        productType: "tip",
        targetId: "00000000-0000-4000-8000-000000000010",
        amountMinor: 10000000,
        referralToken: "veel_referral_token"
      }
    });

    expect(response.statusCode).toBe(201);

    await app.close();
    vi.unstubAllEnvs();
  });

  it("creates a server-priced content unlock payment intent", async () => {
    vi.stubEnv("PAYMENT_PLATFORM_TREASURY_WALLET", treasuryWallet);
    const contentRepository: ContentRepository = {
      async createDraft() {
        throw new Error("not implemented");
      },
      async createMediaAsset() {
        throw new Error("not implemented");
      },
      async findContentDetail() {
        throw new Error("not implemented");
      },
      async findContentUnlockOffer(input) {
        expect(input).toEqual({
          supabaseUserId: "00000000-0000-4000-8000-000000000001",
          contentId: "00000000-0000-4000-8000-000000000040"
        });

        return {
          contentId: "00000000-0000-4000-8000-000000000040",
          alreadyUnlocked: false,
          priceMinor: 25000000,
          currency: "SOL"
        };
      },
      async findOwnedContentForUpload() {
        throw new Error("not implemented");
      },
      async listHomeFeed() {
        throw new Error("not implemented");
      }
    };
    const paymentRepository: PaymentRepository = {
      async createOrReuseIntent(input) {
        expect(input).toMatchObject({
          supabaseUserId: "00000000-0000-4000-8000-000000000001",
          idempotencyKey: "content-unlock-1",
          productType: "content_unlock",
          targetId: "00000000-0000-4000-8000-000000000040",
          amountMinor: 25000000,
          currency: "SOL",
          treasuryWallet
        });

        return {
          ...storedPaymentIntent,
          id: "00000000-0000-4000-8000-000000000055",
          productType: "content_unlock",
          targetId: input.targetId,
          amountMinor: input.amountMinor,
          referenceAddress: input.referenceAddress,
          requestHash: input.requestHash,
          expiresAt: input.expiresAt
        };
      },
      async findIntent() {
        throw new Error("not implemented");
      },
      async recordTransactionRequest() {
        throw new Error("not implemented");
      },
      async recordSubmission() {
        throw new Error("not implemented");
      }
    };
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      sessionRepository: appReadySessionRepository,
      ageRepository: verifiedAgeRepository,
      walletRepository: walletRepositoryWithWallet,
      contentRepository,
      paymentRepository,
      settlementVerifier: fakeUnconfirmedSettlementVerifier
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/v1/content/00000000-0000-4000-8000-000000000040/unlock-intents",
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "content-unlock-1"
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      state: "payment_required",
      contentId: "00000000-0000-4000-8000-000000000040",
      paymentIntent: {
        id: "00000000-0000-4000-8000-000000000055",
        productType: "content_unlock",
        amountMinor: 25000000,
        currency: "SOL",
        state: "pending"
      }
    });

    await app.close();
    vi.unstubAllEnvs();
  });

  it("rejects client-priced generic content unlock payment intents", async () => {
    vi.stubEnv("PAYMENT_PLATFORM_TREASURY_WALLET", treasuryWallet);
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      sessionRepository: appReadySessionRepository,
      ageRepository: verifiedAgeRepository,
      walletRepository: walletRepositoryWithWallet
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/v1/payments/intents",
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "generic-content-unlock-1"
      },
      payload: {
        productType: "content_unlock",
        targetId: "00000000-0000-4000-8000-000000000040",
        amountMinor: 1
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      code: "validation_failed"
    });

    await app.close();
    vi.unstubAllEnvs();
  });

  it("returns a Solana Pay transfer request without treating it as settlement", async () => {
    vi.stubEnv("PAYMENT_PLATFORM_TREASURY_WALLET", treasuryWallet);
    const recordedRequests: RecordTransactionRequestInput[] = [];
    const paymentRepository: PaymentRepository = {
      async createOrReuseIntent() {
        throw new Error("not implemented");
      },
      async findIntent() {
        return storedPaymentIntent;
      },
      async recordTransactionRequest(input) {
        recordedRequests.push(input);

        return {
          transactionRequestUrl: input.transactionRequestUrl,
          expiresAt: storedPaymentIntent.expiresAt.toISOString()
        };
      },
      async recordSubmission() {
        throw new Error("not implemented");
      }
    };
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      sessionRepository: appReadySessionRepository,
      ageRepository: verifiedAgeRepository,
      walletRepository: walletRepositoryWithWallet,
      paymentRepository,
      settlementVerifier: fakeUnconfirmedSettlementVerifier
    });
    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: `/v1/payments/intents/${storedPaymentIntent.id}/transaction-request`,
      headers: {
        authorization: "Bearer valid-token"
      }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { transactionRequestUrl: string; expiresAt: string };
    expect(body.transactionRequestUrl).toContain(`solana:${treasuryWallet}?`);
    expect(body.transactionRequestUrl).toContain("amount=0.01");
    expect(body.transactionRequestUrl).toContain(
      `reference=${storedPaymentIntent.referenceAddress}`
    );
    expect(recordedRequests[0]?.transactionRequestUrl).toBe(body.transactionRequestUrl);

    await app.close();
    vi.unstubAllEnvs();
  });

  it("records a payment submission and confirms only verified settlement", async () => {
    vi.stubEnv("PAYMENT_PLATFORM_TREASURY_WALLET", treasuryWallet);
    const submissions: RecordPaymentSubmissionInput[] = [];
    const settlementInputs: PaymentSettlementInput[] = [];
    const paymentRepository: PaymentRepository = {
      async createOrReuseIntent() {
        throw new Error("not implemented");
      },
      async findIntent() {
        return storedPaymentIntent;
      },
      async recordTransactionRequest() {
        throw new Error("not implemented");
      },
      async recordSubmission(input) {
        submissions.push(input);
      }
    };
    const settlementVerifier: PaymentSettlementVerifier = {
      async verifyNativeSolTransfer(input) {
        settlementInputs.push(input);

        return {
          confirmed: true
        };
      }
    };
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      sessionRepository: appReadySessionRepository,
      ageRepository: verifiedAgeRepository,
      walletRepository: walletRepositoryWithWallet,
      paymentRepository,
      settlementVerifier
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: `/v1/payments/intents/${storedPaymentIntent.id}/submissions`,
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "payment-submission-1"
      },
      payload: {
        signature: validSolanaSignature
      }
    });

    expect(response.statusCode).toBe(202);
    expect(settlementInputs).toEqual([
      {
        signature: validSolanaSignature,
        referenceAddress: storedPaymentIntent.referenceAddress,
        treasuryWallet,
        amountMinor: storedPaymentIntent.amountMinor
      }
    ]);
    expect(submissions).toEqual([
      {
        supabaseUserId: "00000000-0000-4000-8000-000000000001",
        paymentIntentId: storedPaymentIntent.id,
        signature: validSolanaSignature,
        settlement: {
          confirmed: true
        }
      }
    ]);

    await app.close();
    vi.unstubAllEnvs();
  });

  it("accepts authenticated Helius payment evidence and still requires backend settlement verification", async () => {
    vi.stubEnv("HELIUS_WEBHOOK_SECRET", "helius-secret");
    const providerEvents: unknown[] = [];
    const eventStates: unknown[] = [];
    const submissions: RecordPaymentSubmissionInput[] = [];
    const settlementInputs: PaymentSettlementInput[] = [];
    const paymentEvidenceRepository: PaymentEvidenceRepository = {
      async recordSolanaProviderEvent(input) {
        providerEvents.push(input);

        return true;
      },
      async findIntentByReference(input) {
        expect(input.referenceAddresses).toContain(storedPaymentIntent.referenceAddress);

        return {
          supabaseUserId: "00000000-0000-4000-8000-000000000001",
          intent: storedPaymentIntent
        };
      },
      async updateSolanaProviderEvent(input) {
        eventStates.push(input);
      }
    };
    const paymentRepository: PaymentRepository = {
      async createOrReuseIntent() {
        throw new Error("not implemented");
      },
      async findIntent() {
        throw new Error("not implemented");
      },
      async recordTransactionRequest() {
        throw new Error("not implemented");
      },
      async recordSubmission(input) {
        submissions.push(input);
      }
    };
    const settlementVerifier: PaymentSettlementVerifier = {
      async verifyNativeSolTransfer(input) {
        settlementInputs.push(input);

        return {
          confirmed: true
        };
      }
    };
    const app = await buildApi({
      paymentRepository,
      paymentEvidenceRepository,
      settlementVerifier
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/v1/webhooks/solana-indexer",
      headers: {
        authorization: "helius-secret"
      },
      payload: [
        {
          signature: validSolanaSignature,
          type: "TRANSFER",
          accountData: [{ account: storedPaymentIntent.referenceAddress }],
          nativeTransfers: [
            {
              toUserAccount: treasuryWallet,
              amount: storedPaymentIntent.amountMinor
            }
          ]
        }
      ]
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({
      provider: "helius",
      received: 1,
      processed: 1
    });
    expect(providerEvents).toMatchObject([
      {
        providerEventId: validSolanaSignature,
        eventType: "TRANSFER",
        signature: validSolanaSignature,
        referenceAddresses: expect.arrayContaining([storedPaymentIntent.referenceAddress])
      }
    ]);
    expect(settlementInputs).toEqual([
      {
        signature: validSolanaSignature,
        referenceAddress: storedPaymentIntent.referenceAddress,
        treasuryWallet,
        amountMinor: storedPaymentIntent.amountMinor
      }
    ]);
    expect(submissions).toMatchObject([
      {
        supabaseUserId: "00000000-0000-4000-8000-000000000001",
        paymentIntentId: storedPaymentIntent.id,
        signature: validSolanaSignature,
        settlement: { confirmed: true }
      }
    ]);
    expect(eventStates).toEqual([
      {
        providerEventId: validSolanaSignature,
        normalizedState: "processed"
      }
    ]);

    await app.close();
    vi.unstubAllEnvs();
  });

  it("rejects Solana indexer webhooks without the configured Helius auth header", async () => {
    vi.stubEnv("HELIUS_WEBHOOK_SECRET", "helius-secret");
    const app = await buildApi();
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/v1/webhooks/solana-indexer",
      headers: {
        authorization: "wrong-secret"
      },
      payload: [{ signature: validSolanaSignature }]
    });

    expect(response.statusCode).toBe(401);

    await app.close();
    vi.unstubAllEnvs();
  });

  it("acknowledges duplicate Solana indexer deliveries without replaying settlement", async () => {
    vi.stubEnv("HELIUS_WEBHOOK_SECRET", "helius-secret");
    const submissions: RecordPaymentSubmissionInput[] = [];
    const paymentEvidenceRepository: PaymentEvidenceRepository = {
      async recordSolanaProviderEvent() {
        return false;
      },
      async findIntentByReference() {
        throw new Error("duplicate should not resolve payment intent");
      },
      async updateSolanaProviderEvent() {
        throw new Error("duplicate should not update provider state");
      }
    };
    const paymentRepository: PaymentRepository = {
      async createOrReuseIntent() {
        throw new Error("not implemented");
      },
      async findIntent() {
        throw new Error("not implemented");
      },
      async recordTransactionRequest() {
        throw new Error("not implemented");
      },
      async recordSubmission(input) {
        submissions.push(input);
      }
    };
    const app = await buildApi({
      paymentRepository,
      paymentEvidenceRepository,
      settlementVerifier: fakeUnconfirmedSettlementVerifier
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/v1/webhooks/solana-indexer",
      headers: {
        authorization: "helius-secret"
      },
      payload: [{ signature: validSolanaSignature, accountData: [{ account: storedPaymentIntent.referenceAddress }] }]
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({
      provider: "helius",
      received: 1,
      processed: 0
    });
    expect(submissions).toEqual([]);

    await app.close();
    vi.unstubAllEnvs();
  });

  it("creates a Livepeer-backed live room without exposing host secrets in the response", async () => {
    const providerCreates: Array<{ roomId: string; title: string }> = [];
    const repositoryCreates: string[] = [];
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      sessionRepository: appReadySessionRepository,
      ageRepository: verifiedAgeRepository,
      walletRepository: walletRepositoryWithWallet,
      liveRepository: fakeLiveRepository({
        async onCreateRoom(input) {
          repositoryCreates.push(input.title);
          return liveRoomFixture({
            id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa10",
            title: input.title,
            providerStreamId: input.providerRoom.providerStreamId,
            providerPlaybackId: input.providerRoom.providerPlaybackId,
            hostIngestUrl: input.providerRoom.hostIngestUrl,
            hostStreamKey: input.providerRoom.hostStreamKey,
            requestHash: input.requestHash
          });
        },
        async onFindOwnedRoomByIdempotency() {
          return null;
        }
      }),
      liveProvider: {
        isConfigured: () => true,
        async createRoom(input) {
          providerCreates.push(input);
          return {
            provider: "livepeer",
            providerStreamId: "livepeer-stream-1",
            providerPlaybackId: "livepeer-playback-1",
            providerState: "created",
            hostIngestUrl: "rtmp://rtmp.livepeer.com/live/test",
            hostStreamKey: "test",
            playbackUrl: "https://livepeercdn.studio/hls/livepeer-playback-1/index.m3u8"
          };
        },
        async getRoomStatus() {
          throw new Error("not implemented");
        },
        async createPlaybackJwt() {
          return null;
        }
      }
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/v1/live/rooms",
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "live-room-create-1"
      },
      payload: {
        title: "Friday live room",
        teaserSeconds: 45,
        passPriceMinor: 75000000
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa10",
      title: "Friday live room",
      state: "waiting",
      playback: {
        state: "not_ready",
        url: null,
        provider: "livepeer"
      }
    });
    expect(JSON.stringify(response.json())).not.toContain("test");
    expect(providerCreates).toEqual([{ roomId: "pending", title: "Friday live room" }]);
    expect(repositoryCreates).toEqual(["Friday live room"]);

    await app.close();
  });

  it("returns only a masked host connection to the authorized room creator", async () => {
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      sessionRepository: appReadySessionRepository,
      ageRepository: verifiedAgeRepository,
      walletRepository: walletRepositoryWithWallet,
      liveRepository: fakeLiveRepository({
        async onFindOwnedRoom() {
          return liveRoomFixture({
            id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa11",
            hostIngestUrl: "rtmp://rtmp.livepeer.com/live/test",
            hostStreamKey: "test"
          });
        }
      })
    });
    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: "/v1/live/rooms/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa11/host-connection",
      headers: { authorization: "Bearer valid-token" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      provider: "livepeer",
      maskedIngestUrl: "rtmp://rtmp.livepeer.com/live/****",
      streamKeyHint: "****"
    });
    expect(JSON.stringify(response.json())).not.toContain("/test");

    await app.close();
  });

  it("returns signed Livepeer playback only for an active pass", async () => {
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      sessionRepository: appReadySessionRepository,
      ageRepository: verifiedAgeRepository,
      walletRepository: walletRepositoryWithWallet,
      liveRepository: fakeLiveRepository({
        async onFindRoom() {
          return liveRoomFixture({
            id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa15",
            state: "live",
            hasPass: true,
            providerPlaybackId: "livepeer-playback-15",
            playbackUrl: "https://livepeercdn.studio/hls/livepeer-playback-15/index.m3u8"
          });
        }
      }),
      liveProvider: {
        isConfigured: () => true,
        async createRoom() {
          throw new Error("not implemented");
        },
        async getRoomStatus() {
          throw new Error("not implemented");
        },
        async createPlaybackJwt(input) {
          expect(input).toEqual({
            playbackId: "livepeer-playback-15",
            supabaseUserId: "00000000-0000-4000-8000-000000000001"
          });
          return "livepeer.jwt.token";
        }
      }
    });
    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: "/v1/live/rooms/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa15",
      headers: { authorization: "Bearer valid-token" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().playback).toEqual({
      state: "full",
      url: "https://livepeercdn.studio/hls/livepeer-playback-15/index.m3u8?jwt=livepeer.jwt.token",
      provider: "livepeer",
      resourceType: "hls"
    });

    await app.close();
  });

  it("fails Livepeer playback closed when JWT signing is unavailable", async () => {
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      sessionRepository: appReadySessionRepository,
      ageRepository: verifiedAgeRepository,
      walletRepository: walletRepositoryWithWallet,
      liveRepository: fakeLiveRepository({
        async onFindRoom() {
          return liveRoomFixture({
            id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa16",
            state: "live",
            hasPass: true,
            providerPlaybackId: "livepeer-playback-16",
            playbackUrl: "https://livepeercdn.studio/hls/livepeer-playback-16/index.m3u8"
          });
        }
      }),
      liveProvider: {
        isConfigured: () => true,
        async createRoom() {
          throw new Error("not implemented");
        },
        async getRoomStatus() {
          throw new Error("not implemented");
        },
        async createPlaybackJwt() {
          return null;
        }
      }
    });
    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: "/v1/live/rooms/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa16",
      headers: { authorization: "Bearer valid-token" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().playback).toEqual({
      state: "blocked",
      url: null,
      provider: "livepeer"
    });

    await app.close();
  });

  it("creates a server-priced live pass payment intent and records the pass purchase request", async () => {
    vi.stubEnv("PAYMENT_PLATFORM_TREASURY_WALLET", treasuryWallet);
    const paymentCreates: StoredPaymentIntent[] = [];
    const passRequests: Array<{ paymentIntentId: string; durationMinutes: number }> = [];
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      sessionRepository: appReadySessionRepository,
      ageRepository: verifiedAgeRepository,
      walletRepository: walletRepositoryWithWallet,
      liveRepository: fakeLiveRepository({
        async onFindRoom() {
          return liveRoomFixture({
            id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa12",
            state: "live",
            hasPass: false,
            playbackUrl: "https://livepeercdn.studio/hls/playback-12/index.m3u8"
          });
        },
        async onRecordLivePassPurchaseRequest(input) {
          passRequests.push({
            paymentIntentId: input.paymentIntentId,
            durationMinutes: input.durationMinutes
          });
        }
      }),
      paymentRepository: {
        async createOrReuseIntent(input) {
          const intent: StoredPaymentIntent = {
            ...storedPaymentIntent,
            id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa50",
            productType: input.productType,
            targetId: input.targetId,
            amountMinor: input.amountMinor,
            referenceAddress: input.referenceAddress,
            expiresAt: input.expiresAt,
            requestHash: input.requestHash
          };
          paymentCreates.push(intent);
          return intent;
        },
        async findIntent() {
          throw new Error("not implemented");
        },
        async recordTransactionRequest() {
          throw new Error("not implemented");
        },
        async recordSubmission() {
          throw new Error("not implemented");
        }
      }
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/v1/live/rooms/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa12/pass-intents",
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "live-pass-intent-1"
      },
      payload: { durationMinutes: 60 }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa50",
      productType: "live_pass",
      targetId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa12",
      amountMinor: 50000000
    });
    expect(paymentCreates[0]?.productType).toBe("live_pass");
    expect(passRequests).toEqual([
      { paymentIntentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa50", durationMinutes: 60 }
    ]);

    await app.close();
    vi.unstubAllEnvs();
  });

  it("syncs Livepeer status into the backend live room projection", async () => {
    const syncedStatuses: LiveProviderRoomStatus[] = [];
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      sessionRepository: appReadySessionRepository,
      ageRepository: verifiedAgeRepository,
      walletRepository: walletRepositoryWithWallet,
      liveRepository: fakeLiveRepository({
        async onFindOwnedRoom() {
          return liveRoomFixture({
            id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa13",
            providerStreamId: "livepeer-stream-13",
            providerPlaybackId: "livepeer-playback-13"
          });
        },
        async onUpdateRoomStatus(input) {
          syncedStatuses.push(input.status);
        }
      }),
      liveProvider: {
        isConfigured: () => true,
        async createRoom() {
          throw new Error("not implemented");
        },
        async getRoomStatus(input) {
          return {
            providerStreamId: input.providerStreamId,
            providerPlaybackId: input.providerPlaybackId,
            providerState: "active",
            state: "live",
            playbackUrl: "https://livepeercdn.studio/hls/livepeer-playback-13/index.m3u8"
          };
        },
        async createPlaybackJwt() {
          return null;
        }
      }
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/v1/live/rooms/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa13/sync",
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "live-sync-1"
      }
    });

    expect(response.statusCode).toBe(202);
    expect(syncedStatuses).toEqual([
      {
        providerStreamId: "livepeer-stream-13",
        providerPlaybackId: "livepeer-playback-13",
        providerState: "active",
        state: "live",
        playbackUrl: "https://livepeercdn.studio/hls/livepeer-playback-13/index.m3u8"
      }
    ]);

    await app.close();
  });

  it("allows live chat only when the backend room projection has an active pass", async () => {
    const createdMessages: string[] = [];
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      sessionRepository: appReadySessionRepository,
      ageRepository: verifiedAgeRepository,
      walletRepository: walletRepositoryWithWallet,
      liveRepository: fakeLiveRepository({
        async onCreateChatMessage(input) {
          createdMessages.push(input.body);
          return {
            id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa90",
            roomId: input.roomId,
            author: homeFeedItem.creator,
            body: input.body,
            createdAt: "2026-06-04T23:30:00.000Z"
          };
        }
      })
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/v1/live/rooms/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa14/messages",
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "live-chat-1"
      },
      payload: { body: "Great stream" }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      roomId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa14",
      body: "Great stream"
    });
    expect(createdMessages).toEqual(["Great stream"]);

    await app.close();
  });

  it("lists participant conversations and messages", async () => {
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      sessionRepository: appReadySessionRepository,
      ageRepository: verifiedAgeRepository,
      walletRepository: walletRepositoryWithWallet,
      messageRepository: fakeMessageRepository()
    });
    await app.ready();

    const conversationsResponse = await app.inject({
      method: "GET",
      url: "/v1/messages/conversations",
      headers: { authorization: "Bearer valid-token" }
    });
    const messagesResponse = await app.inject({
      method: "GET",
      url: "/v1/messages/conversations/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaab10/messages",
      headers: { authorization: "Bearer valid-token" }
    });

    expect(conversationsResponse.statusCode).toBe(200);
    expect(conversationsResponse.json()).toMatchObject({
      items: [
        {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaab10",
          title: "Maki"
        }
      ]
    });
    expect(messagesResponse.statusCode).toBe(200);
    expect(messagesResponse.json()).toMatchObject({
      items: [
        {
          body: "Visible message",
          deliveryState: "visible"
        }
      ]
    });

    await app.close();
  });

  it("creates a normal conversation message through the backend", async () => {
    const createdBodies: string[] = [];
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      sessionRepository: appReadySessionRepository,
      ageRepository: verifiedAgeRepository,
      walletRepository: walletRepositoryWithWallet,
      messageRepository: fakeMessageRepository({
        async onCreateMessage(input) {
          createdBodies.push(input.body);
          return messageFixture({
            conversationId: input.conversationId,
            body: input.body
          });
        }
      })
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/v1/messages/conversations/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaab11/messages",
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "message-create-1"
      },
      payload: { body: "Hello from Veel" }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      conversationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaab11",
      body: "Hello from Veel",
      deliveryState: "visible"
    });
    expect(createdBodies).toEqual(["Hello from Veel"]);

    await app.close();
  });

  it("creates a server-priced paid message intent and stores the backend delivery draft", async () => {
    vi.stubEnv("PAYMENT_PLATFORM_TREASURY_WALLET", treasuryWallet);
    const draftRecords: Array<{ paymentIntentId: string; body: string }> = [];
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      sessionRepository: appReadySessionRepository,
      ageRepository: verifiedAgeRepository,
      walletRepository: walletRepositoryWithWallet,
      messageRepository: fakeMessageRepository({
        async onRecordPaidMessageDraft(input) {
          draftRecords.push({
            paymentIntentId: input.paymentIntentId,
            body: input.body
          });
        }
      }),
      paymentRepository: {
        async createOrReuseIntent(input) {
          return {
            ...storedPaymentIntent,
            id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaab50",
            productType: input.productType,
            targetId: input.targetId,
            amountMinor: input.amountMinor,
            referenceAddress: input.referenceAddress,
            expiresAt: input.expiresAt,
            requestHash: input.requestHash
          };
        },
        async findIntent() {
          throw new Error("not implemented");
        },
        async recordTransactionRequest() {
          throw new Error("not implemented");
        },
        async recordSubmission() {
          throw new Error("not implemented");
        }
      }
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/v1/messages/conversations/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaab12/paid-message-intents",
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "paid-message-intent-1"
      },
      payload: { body: "Paid hello" }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      state: "payment_required",
      conversationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaab12",
      paymentIntent: {
        productType: "paid_message",
        amountMinor: 10000000
      }
    });
    expect(draftRecords).toEqual([
      {
        paymentIntentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaab50",
        body: "Paid hello"
      }
    ]);

    await app.close();
    vi.unstubAllEnvs();
  });

  it("updates feed controls through the backend engagement boundary", async () => {
    const calls: Array<{ kind: string; input: unknown }> = [];
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      sessionRepository: appReadySessionRepository,
      ageRepository: verifiedAgeRepository,
      engagementRepository: fakeEngagementRepository({
        async onGetFeedPreferences(input) {
          calls.push({ kind: "read_preferences", input });
        },
        async onUpdateFeedPreferences(input) {
          calls.push({ kind: "preferences", input });
        },
        async onHideCreator(input) {
          calls.push({ kind: "hide_creator", input });
        },
        async onHideTopic(input) {
          calls.push({ kind: "hide_topic", input });
        }
      })
    });
    await app.ready();

    const readResponse = await app.inject({
      method: "GET",
      url: "/v1/feed/preferences",
      headers: {
        authorization: "Bearer valid-token"
      }
    });
    const preferencesResponse = await app.inject({
      method: "PATCH",
      url: "/v1/feed/preferences",
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "feed-prefs-1"
      },
      payload: {
        defaultMode: "following",
        nsfwPreference: "sfw"
      }
    });
    const hideCreatorResponse = await app.inject({
      method: "POST",
      url: "/v1/feed/hide-creator",
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "hide-creator-1"
      },
      payload: {
        creatorUserId: "00000000-0000-4000-8000-000000000011"
      }
    });
    const hideTopicResponse = await app.inject({
      method: "POST",
      url: "/v1/feed/hide-topic",
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "hide-topic-1"
      },
      payload: {
        topic: "studio"
      }
    });

    expect(readResponse.statusCode).toBe(200);
    expect(readResponse.json()).toMatchObject({
      defaultMode: "recommended",
      nsfwPreference: "recommended"
    });
    expect(preferencesResponse.statusCode).toBe(200);
    expect(hideCreatorResponse.statusCode).toBe(200);
    expect(hideTopicResponse.statusCode).toBe(200);
    expect(calls).toMatchObject([
      {
        kind: "read_preferences",
        input: {
          supabaseUserId: "00000000-0000-4000-8000-000000000001"
        }
      },
      {
        kind: "preferences",
        input: {
          supabaseUserId: "00000000-0000-4000-8000-000000000001",
          body: {
            defaultMode: "following",
            nsfwPreference: "sfw"
          }
        }
      },
      {
        kind: "hide_creator",
        input: {
          creatorUserId: "00000000-0000-4000-8000-000000000011",
          idempotencyKey: "hide-creator-1"
        }
      },
      {
        kind: "hide_topic",
        input: {
          topic: "studio",
          idempotencyKey: "hide-topic-1"
        }
      }
    ]);

    await app.close();
  });

  it("records content engagement, safety reports, and blocks through server-owned routes", async () => {
    const calls: Array<{ kind: string; input: unknown }> = [];
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      sessionRepository: appReadySessionRepository,
      ageRepository: verifiedAgeRepository,
      engagementRepository: fakeEngagementRepository({
        async onToggleLike(input) {
          calls.push({ kind: "like", input });
        },
        async onCreateComment(input) {
          calls.push({ kind: "comment", input });
        },
        async onCreateShare(input) {
          calls.push({ kind: "share", input });
        },
        async onCreateReport(input) {
          calls.push({ kind: "report", input });
        },
        async onBlockUser(input) {
          calls.push({ kind: "block", input });
        }
      })
    });
    await app.ready();

    const likeResponse = await app.inject({
      method: "POST",
      url: "/v1/engagement/00000000-0000-4000-8000-000000000040/like",
      headers: { authorization: "Bearer valid-token", "idempotency-key": "like-1" }
    });
    const commentResponse = await app.inject({
      method: "POST",
      url: "/v1/engagement/00000000-0000-4000-8000-000000000040/comments",
      headers: { authorization: "Bearer valid-token", "idempotency-key": "comment-1" },
      payload: { body: "Server-owned comment" }
    });
    const shareResponse = await app.inject({
      method: "POST",
      url: "/v1/shares",
      headers: { authorization: "Bearer valid-token", "idempotency-key": "share-1" },
      payload: {
        targetType: "content",
        targetId: "00000000-0000-4000-8000-000000000040",
        mode: "copy_link"
      }
    });
    const reportResponse = await app.inject({
      method: "POST",
      url: "/v1/reports",
      headers: { authorization: "Bearer valid-token", "idempotency-key": "report-1" },
      payload: {
        subjectType: "content",
        subjectId: "00000000-0000-4000-8000-000000000040",
        reason: "Safety review"
      }
    });
    const blockResponse = await app.inject({
      method: "POST",
      url: "/v1/blocks/00000000-0000-4000-8000-000000000011",
      headers: { authorization: "Bearer valid-token", "idempotency-key": "block-1" }
    });

    expect(likeResponse.statusCode).toBe(200);
    expect(commentResponse.statusCode).toBe(201);
    expect(shareResponse.statusCode).toBe(201);
    expect(reportResponse.statusCode).toBe(201);
    expect(blockResponse.statusCode).toBe(200);
    expect(calls).toMatchObject([
      { kind: "like", input: { contentId: "00000000-0000-4000-8000-000000000040", idempotencyKey: "like-1" } },
      { kind: "comment", input: { body: { body: "Server-owned comment" }, idempotencyKey: "comment-1" } },
      { kind: "share", input: { body: { targetType: "content", mode: "copy_link" }, idempotencyKey: "share-1" } },
      { kind: "report", input: { body: { subjectType: "content", reason: "Safety review" }, idempotencyKey: "report-1" } },
      { kind: "block", input: { blockedUserId: "00000000-0000-4000-8000-000000000011", idempotencyKey: "block-1" } }
    ]);

    await app.close();
  });

  it("blocks engagement before age verification", async () => {
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      sessionRepository: appReadySessionRepository,
      ageRepository: requiredAgeRepository,
      engagementRepository: fakeEngagementRepository()
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/v1/engagement/00000000-0000-4000-8000-000000000040/like",
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "like-denied-1"
      }
    });

    expect(response.statusCode).toBe(403);

    await app.close();
  });

  it("blocks payment intent creation before age verification", async () => {
    vi.stubEnv("PAYMENT_PLATFORM_TREASURY_WALLET", treasuryWallet);
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      sessionRepository: appReadySessionRepository,
      ageRepository: requiredAgeRepository,
      walletRepository: walletRepositoryWithWallet
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/v1/payments/intents",
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "payment-intent-2"
      },
      payload: {
        productType: "tip",
        targetId: "00000000-0000-4000-8000-000000000010",
        amountMinor: 10000000
      }
    });

    expect(response.statusCode).toBe(403);

    await app.close();
    vi.unstubAllEnvs();
  });

  it("creates delegated subscription intents and keeps activation behind backend verification", async () => {
    const calls: Array<{ kind: string; input: unknown }> = [];
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      sessionRepository: appReadySessionRepository,
      ageRepository: verifiedAgeRepository,
      walletRepository: walletRepositoryWithWallet,
      subscriptionRepository: fakeSubscriptionRepository({
        async onListPlans(input) {
          calls.push({ kind: "plans", input });

          return {
            items: [subscriptionPlanFixture()]
          };
        },
        async onListSubscriptions(input) {
          calls.push({ kind: "subscriptions", input });

          return {
            items: [
              subscriptionFixture({
                state: "active",
                currentPeriodEndsAt: "2026-07-04T00:00:00.000Z",
                nextCollectionAt: "2026-07-04T00:00:00.000Z"
              })
            ]
          };
        },
        async onCreateAuthorizationIntent(input) {
          calls.push({ kind: "intent", input });

          return subscriptionAuthorizationIntentFixture({
            subscription: subscriptionFixture({
              state: "authorization_pending"
            })
          });
        },
        async onSubmitAuthorization(input) {
          calls.push({ kind: "submit", input });

          return subscriptionFixture({
            state: "authorization_pending",
            authorityAddress: input.body.authorityAddress,
            delegationAddress: input.body.delegationAddress
          });
        }
      }),
      subscriptionAuthorizationVerifier: fakeSubscriptionAuthorizationVerifier(false)
    });
    await app.ready();

    const plansResponse = await app.inject({
      method: "GET",
      url: "/v1/subscriptions/plans",
      headers: { authorization: "Bearer valid-token" }
    });
    const subscriptionsResponse = await app.inject({
      method: "GET",
      url: "/v1/subscriptions",
      headers: { authorization: "Bearer valid-token" }
    });
    const intentResponse = await app.inject({
      method: "POST",
      url: "/v1/subscriptions/intents",
      headers: { authorization: "Bearer valid-token", "idempotency-key": "sub-intent-1" },
      payload: {
        planId: "platform_plus_monthly"
      }
    });
    const submitResponse = await app.inject({
      method: "POST",
      url: "/v1/subscriptions/authorizations/00000000-0000-4000-8000-000000000071/submissions",
      headers: { authorization: "Bearer valid-token", "idempotency-key": "sub-submit-1" },
      payload: {
        signature: validSolanaSignature,
        authorityAddress: "11111111111111111111111111111111",
        delegationAddress: "11111111111111111111111111111112",
        subscriberTokenAccount: "11111111111111111111111111111113"
      }
    });

    expect(plansResponse.statusCode).toBe(200);
    expect(plansResponse.json()).toMatchObject({
      items: [
        {
          id: "platform_plus_monthly",
          billingMode: "delegated_solana_subscription",
          providerState: "staging_required"
        }
      ]
    });
    expect(subscriptionsResponse.statusCode).toBe(200);
    expect(subscriptionsResponse.json()).toMatchObject({
      items: [
        {
          id: "00000000-0000-4000-8000-000000000070",
          renewalMode: "delegated_solana_subscription",
          state: "active",
          nextCollectionAt: "2026-07-04T00:00:00.000Z"
        }
      ]
    });
    expect(intentResponse.statusCode).toBe(201);
    expect(intentResponse.json()).toMatchObject({
      id: "00000000-0000-4000-8000-000000000071",
      authorizationMode: "delegated_solana_subscription",
      providerReadiness: {
        activeMode: "delegated_solana_subscription",
        delegatedSubscriptions: "staging_required"
      }
    });
    expect(submitResponse.statusCode).toBe(202);
    expect(submitResponse.json()).toMatchObject({
      state: "authorization_pending",
      renewalMode: "delegated_solana_subscription"
    });
    expect(calls).toMatchObject([
      { kind: "plans", input: { supabaseUserId: "00000000-0000-4000-8000-000000000001" } },
      {
        kind: "subscriptions",
        input: { supabaseUserId: "00000000-0000-4000-8000-000000000001" }
      },
      { kind: "intent", input: { idempotencyKey: "sub-intent-1", body: { planId: "platform_plus_monthly" } } },
      {
        kind: "submit",
        input: {
          authorizationIntentId: "00000000-0000-4000-8000-000000000071",
          idempotencyKey: "sub-submit-1",
          verification: { verified: false, failureCode: "delegation_verifier_not_configured" }
        }
      }
    ]);

    await app.close();
  });

  it("cancels subscriptions server-side without frontend state truth", async () => {
    const calls: Array<{ kind: string; input: unknown }> = [];
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      sessionRepository: appReadySessionRepository,
      ageRepository: verifiedAgeRepository,
      walletRepository: walletRepositoryWithWallet,
      subscriptionRepository: fakeSubscriptionRepository({
        async onCancel(input) {
          calls.push({ kind: "cancel", input });

          return subscriptionFixture({
            state: "cancelled",
            cancelledAt: "2026-06-05T00:00:00.000Z"
          });
        }
      })
    });
    await app.ready();

    const response = await app.inject({
      method: "PATCH",
      url: "/v1/subscriptions/00000000-0000-4000-8000-000000000070/cancel",
      headers: { authorization: "Bearer valid-token", "idempotency-key": "sub-cancel-1" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: "00000000-0000-4000-8000-000000000070",
      state: "cancelled",
      renewalMode: "delegated_solana_subscription"
    });
    expect(calls).toMatchObject([
      {
        kind: "cancel",
        input: {
          subscriptionId: "00000000-0000-4000-8000-000000000070",
          idempotencyKey: "sub-cancel-1"
        }
      }
    ]);

    await app.close();
  });
});

const fakeAuthVerifier: SupabaseAuthVerifier = {
  async verifyBearerToken(token: string): Promise<VerifiedSupabaseSession | null> {
    if (token !== "valid-token") {
      return null;
    }

    return {
      supabaseUserId: "00000000-0000-4000-8000-000000000001",
      email: "maki@example.test",
      role: "authenticated"
    };
  }
};

const verifiedAgeRepository: AgeRepository = {
  async findLatestAgeStatusBySupabaseUserId() {
    return {
      state: "verified",
      provider: "test"
    };
  },
  async createPendingAgeVerification() {
    throw new Error("not implemented");
  },
  async recordProviderWebhook() {
    throw new Error("not implemented");
  },
  async updateVerificationFromWebhook() {
    throw new Error("not implemented");
  }
};

const requiredAgeRepository: AgeRepository = {
  async findLatestAgeStatusBySupabaseUserId() {
    return {
      state: "required",
      provider: null
    };
  },
  async createPendingAgeVerification() {
    throw new Error("not implemented");
  },
  async recordProviderWebhook() {
    throw new Error("not implemented");
  },
  async updateVerificationFromWebhook() {
    throw new Error("not implemented");
  }
};

const fakeAgeProviderWaterfall: AgeProviderWaterfall = {
  async createSession(input) {
    expect(input.providerPreference).toBe("reusable_first");
    expect(input.idempotencyKey).toBe("age-session-1");
    expect(input.callbackUrl).toBe("http://localhost:3000/age/callback");
    expect(input.webhookBaseUrl).toBe("http://localhost:4000/v1/webhooks/age");

    return {
      provider: "yoti",
      providerReference: "age-session-provider-ref-1",
      launchUrl: "https://age.example.test/session/age-session-provider-ref-1",
      expiresAt: new Date("2026-06-03T22:15:00.000Z"),
      jurisdiction: "US",
      rule: "over_18"
    };
  }
};

function sumsubDigest(payload: string): string {
  return createHmac("sha256", "sumsub-test-secret").update(payload).digest("hex");
}

function bunnySignature(payload: string): string {
  return createHmac("sha256", "bunny-readonly-secret").update(payload).digest("hex");
}

function livepeerSignature(payload: string, timestamp: number): string {
  const signature = createHmac("sha256", "livepeer-webhook-secret").update(payload).digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

const homeFeedItem: ContentItem = {
  id: "00000000-0000-4000-8000-000000000040",
  creator: {
    id: "00000000-0000-4000-8000-000000000010",
    handle: "maki",
    displayName: "Maki",
    avatarUrl: null,
    badges: []
  },
  mediaType: "image",
  caption: "First Veel v2 feed card",
  posterUrl: "https://media.example.test/poster.jpg",
  playback: {
    state: "not_ready",
    url: null,
    provider: "none"
  },
  accessState: "free",
  nsfwLabel: "none",
  engagement: {
    liked: false,
    saved: false,
    likeCount: 0,
    commentCount: 0,
    shareCount: 0
  }
};

const treasuryWallet = "1".repeat(32);
const validSolanaSignature =
  "5Pj5fCupXLUePYn18JkY8SrRaWFiUctuDTRwvUy2MLgVFG1FsCeezrWwZsmxkL5YJQFmQpAcY7rc5pN6vrXJt7Qp";

const storedPaymentIntent: StoredPaymentIntent = {
  id: "00000000-0000-4000-8000-000000000050",
  productType: "tip",
  targetId: "00000000-0000-4000-8000-000000000010",
  amountMinor: 10000000,
  currency: "SOL",
  state: "pending",
  referenceAddress: `${"1".repeat(31)}2`,
  treasuryWallet,
  solanaCluster: "devnet",
  expiresAt: new Date("2026-06-04T23:15:00.000Z"),
  requestHash: "request-hash"
};

function liveRoomFixture(
  overrides: Partial<
    StoredLiveRoom & {
      hasPass: boolean;
      playbackUrl: string | null;
    }
  > = {}
): StoredLiveRoom {
  const hasPass = overrides.hasPass ?? true;
  const state = overrides.state ?? "waiting";
  const playbackUrl = overrides.playbackUrl ?? null;

  return {
    id: overrides.id ?? "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01",
    title: overrides.title ?? "Live room",
    creator: overrides.creator ?? homeFeedItem.creator,
    state,
    accessState: hasPass ? "pass_active" : "pass_required",
    playback:
      state === "live" && hasPass && playbackUrl
        ? {
            state: "full",
            url: playbackUrl,
            provider: "livepeer"
          }
        : {
            state: state === "live" && playbackUrl ? "blocked" : "not_ready",
            url: null,
            provider: "livepeer"
          },
    teaserSecondsRemaining: hasPass ? null : 60,
    passOptions:
      overrides.passOptions ??
      [30, 60, 180].map((durationMinutes) => ({
        durationMinutes: durationMinutes as 30 | 60 | 180,
        amountMinor: 50000000,
        currency: "SOL" as const
      })),
    chat: {
      enabled: state === "live",
      accessState: state === "live" ? (hasPass ? "allowed" : "pass_required") : "closed"
    },
    replayContentId: overrides.replayContentId ?? null,
    providerStreamId: overrides.providerStreamId ?? "livepeer-stream",
    providerPlaybackId: overrides.providerPlaybackId ?? "livepeer-playback",
    hostIngestUrl: overrides.hostIngestUrl ?? "rtmp://rtmp.livepeer.com/live/test",
    hostStreamKey: overrides.hostStreamKey ?? "test",
    ...(overrides.requestHash ? { requestHash: overrides.requestHash } : {})
  };
}

function fakeLiveRepository(
  overrides: Partial<{
    onCreateRoom: LiveRepository["createRoom"];
    onFindRoom: LiveRepository["findRoom"];
    onFindOwnedRoom: LiveRepository["findOwnedRoom"];
    onFindOwnedRoomByIdempotency: LiveRepository["findOwnedRoomByIdempotency"];
    onRecordLivePassPurchaseRequest: LiveRepository["recordLivePassPurchaseRequest"];
    onRecordLiveProviderWebhook: NonNullable<LiveRepository["recordLiveProviderWebhook"]>;
    onUpdateRoomStatus: LiveRepository["updateRoomStatus"];
    onUpdateRoomFromWebhook: NonNullable<LiveRepository["updateRoomFromWebhook"]>;
    onListChatMessages: LiveRepository["listChatMessages"];
    onCreateChatMessage: LiveRepository["createChatMessage"];
  }> = {}
): LiveRepository {
  return {
    async createRoom(input) {
      return overrides.onCreateRoom?.(input) ?? liveRoomFixture();
    },
    async findRoom(input) {
      return overrides.onFindRoom?.(input) ?? liveRoomFixture({ id: input.roomId });
    },
    async findOwnedRoom(input) {
      return overrides.onFindOwnedRoom?.(input) ?? liveRoomFixture({ id: input.roomId });
    },
    async findOwnedRoomByIdempotency(input) {
      return overrides.onFindOwnedRoomByIdempotency?.(input) ?? null;
    },
    async recordLivePassPurchaseRequest(input) {
      await overrides.onRecordLivePassPurchaseRequest?.(input);
    },
    async recordLiveProviderWebhook(input) {
      return overrides.onRecordLiveProviderWebhook?.(input) ?? true;
    },
    async updateRoomStatus(input) {
      await overrides.onUpdateRoomStatus?.(input);
    },
    async updateRoomFromWebhook(input) {
      return overrides.onUpdateRoomFromWebhook?.(input) ?? true;
    },
    async listChatMessages(input) {
      return (
        (await overrides.onListChatMessages?.(input)) ?? {
          items: []
        }
      );
    },
    async createChatMessage(input): Promise<LiveChatMessage | null> {
      return (
        (await overrides.onCreateChatMessage?.(input)) ?? {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa91",
          roomId: input.roomId,
          author: homeFeedItem.creator,
          body: input.body,
          createdAt: "2026-06-04T23:30:00.000Z"
        }
      );
    }
  };
}

function messageFixture(overrides: Partial<Message> = {}): Message {
  return {
    id: overrides.id ?? "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaab90",
    conversationId: overrides.conversationId ?? "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaab10",
    sender: overrides.sender ?? homeFeedItem.creator,
    body: overrides.body ?? "Visible message",
    deliveryState: overrides.deliveryState ?? "visible",
    paymentIntentId: overrides.paymentIntentId ?? null,
    createdAt: overrides.createdAt ?? "2026-06-04T23:45:00.000Z"
  };
}

function subscriptionPlanFixture(overrides: Partial<SubscriptionPlan> = {}): SubscriptionPlan {
  return {
    id: overrides.id ?? "platform_plus_monthly",
    scope: overrides.scope ?? "platform",
    label: overrides.label ?? "Veel Plus",
    amountMinor: overrides.amountMinor ?? 15000000,
    currency: overrides.currency ?? "USDC",
    periodDays: overrides.periodDays ?? 30,
    billingMode: overrides.billingMode ?? "delegated_solana_subscription",
    providerState: overrides.providerState ?? "staging_required",
    tokenMint: overrides.tokenMint ?? "USDC_MINT_CONFIG_REQUIRED",
    tokenProgram: overrides.tokenProgram ?? "spl_token"
  };
}

function subscriptionFixture(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: overrides.id ?? "00000000-0000-4000-8000-000000000070",
    scope: overrides.scope ?? "platform",
    planId: overrides.planId ?? "platform_plus_monthly",
    state: overrides.state ?? "authorization_pending",
    renewalMode: overrides.renewalMode ?? "delegated_solana_subscription",
    currentPeriodEndsAt: overrides.currentPeriodEndsAt ?? null,
    nextCollectionAt: overrides.nextCollectionAt ?? null,
    cancelledAt: overrides.cancelledAt ?? null,
    revokedAt: overrides.revokedAt ?? null,
    authorityAddress: overrides.authorityAddress ?? null,
    delegationAddress: overrides.delegationAddress ?? null
  };
}

function subscriptionAuthorizationIntentFixture(
  overrides: Partial<SubscriptionAuthorizationIntent> = {}
): SubscriptionAuthorizationIntent {
  return {
    id: overrides.id ?? "00000000-0000-4000-8000-000000000071",
    subscription: overrides.subscription ?? subscriptionFixture(),
    authorizationMode: "delegated_solana_subscription",
    setupReference: overrides.setupReference ?? "00000000-0000-4000-8000-000000000072",
    transactionRequestUrl: overrides.transactionRequestUrl ?? null,
    expiresAt: overrides.expiresAt ?? "2026-06-05T00:15:00.000Z",
    providerReadiness: overrides.providerReadiness ?? {
      activeMode: "delegated_solana_subscription",
      delegatedSubscriptions: "staging_required"
    }
  };
}

function fakeSubscriptionRepository(
  overrides: Partial<{
    onListPlans: SubscriptionRepository["listPlans"];
    onListSubscriptions: SubscriptionRepository["listSubscriptions"];
    onCreateAuthorizationIntent: SubscriptionRepository["createAuthorizationIntent"];
    onSubmitAuthorization: SubscriptionRepository["submitAuthorization"];
    onCancel: SubscriptionRepository["cancel"];
  }> = {}
): SubscriptionRepository {
  return {
    async listPlans(input) {
      return overrides.onListPlans?.(input) ?? { items: [subscriptionPlanFixture()] };
    },
    async listSubscriptions(input): Promise<SubscriptionPage> {
      return overrides.onListSubscriptions?.(input) ?? { items: [subscriptionFixture()] };
    },
    async createAuthorizationIntent(input) {
      return overrides.onCreateAuthorizationIntent?.(input) ?? subscriptionAuthorizationIntentFixture();
    },
    async findAuthorizationVerificationContext(input) {
      return {
        authorizationIntentId: input.authorizationIntentId,
        setupReference: "00000000-0000-4000-8000-000000000072",
        delegationProgramId: input.delegationProgramId,
        collectorAddress: null,
        tokenMint: "USDC_MINT_CONFIG_REQUIRED",
        tokenProgram: "spl_token",
        amountMinor: 15000000,
        periodDays: 30
      };
    },
    async submitAuthorization(input) {
      return overrides.onSubmitAuthorization?.(input) ?? subscriptionFixture();
    },
    async cancel(input) {
      return overrides.onCancel?.(input) ?? subscriptionFixture({ id: input.subscriptionId });
    }
  };
}

function fakeSubscriptionAuthorizationVerifier(verified: boolean): SubscriptionAuthorizationVerifier {
  return {
    async verifyAuthorization() {
      return verified
        ? { verified: true }
        : { verified: false, failureCode: "delegation_verifier_not_configured" };
    }
  };
}

function fakeRefundRepository(
  overrides: Partial<{
    onListRequests: RefundRepository["listRequests"];
    onCreateRequest: (
      input: Parameters<RefundRepository["createRequest"]>[0]
    ) =>
      | Awaited<ReturnType<RefundRepository["createRequest"]>>
      | undefined
      | void
      | Promise<Awaited<ReturnType<RefundRepository["createRequest"]>> | undefined | void>;
  }> = {}
): RefundRepository {
  return {
    async listRequests(input) {
      return (
        (await overrides.onListRequests?.(input)) ?? {
          items: [
            {
              id: "00000000-0000-4000-8000-000000000160",
              paymentIntentId: "00000000-0000-4000-8000-000000000050",
              entitlementId: "00000000-0000-4000-8000-000000000090",
              reporterUserId: "00000000-0000-4000-8000-000000000011",
              kind: "refund_request",
              requestedAction: "creator_refund",
              state: "opened",
              resolution: null,
              custodyBoundary: "no_platform_custody_no_payout_queue",
              createdAt: "2026-06-06T11:00:00.000Z",
              updatedAt: null,
              resolvedAt: null
            }
          ],
          nextCursor: null
        }
      );
    },
    async createRequest(input) {
      const overrideResult = await overrides.onCreateRequest?.(input);
      if (overrideResult !== undefined) {
        return overrideResult;
      }

      return {
        id: "00000000-0000-4000-8000-000000000160",
        paymentIntentId: input.body.paymentIntentId,
        entitlementId: "00000000-0000-4000-8000-000000000090",
        reporterUserId: "00000000-0000-4000-8000-000000000011",
        kind: input.body.kind,
        requestedAction: input.body.requestedAction,
        state: "opened",
        resolution: null,
        custodyBoundary: "no_platform_custody_no_payout_queue",
        createdAt: "2026-06-06T11:00:00.000Z",
        updatedAt: null,
        resolvedAt: null
      };
    }
  };
}

function fakeMessageRepository(
  overrides: Partial<{
    onListConversations: MessageRepository["listConversations"];
    onListMessages: MessageRepository["listMessages"];
    onCreateMessage: MessageRepository["createMessage"];
    onFindConversationPrice: MessageRepository["findConversationPrice"];
    onRecordPaidMessageDraft: MessageRepository["recordPaidMessageDraft"];
  }> = {}
): MessageRepository {
  return {
    async listConversations(input) {
      return (
        (await overrides.onListConversations?.(input)) ?? {
          items: [
            {
              id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaab10",
              type: "direct",
              title: "Maki",
              unreadCount: 1,
              lastMessage: {
                body: "Visible message",
                sender: homeFeedItem.creator,
                createdAt: "2026-06-04T23:45:00.000Z"
              }
            }
          ]
        }
      );
    },
    async listMessages(input) {
      return (
        (await overrides.onListMessages?.(input)) ?? {
          items: [messageFixture({ conversationId: input.conversationId })]
        }
      );
    },
    async createMessage(input) {
      return overrides.onCreateMessage?.(input) ?? messageFixture({ conversationId: input.conversationId });
    },
    async findConversationPrice(input) {
      return (
        (await overrides.onFindConversationPrice?.(input)) ?? {
          conversationId: input.conversationId,
          amountMinor: 10000000,
          currency: "SOL",
          recipientUserId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaab20"
        }
      );
    },
    async recordPaidMessageDraft(input) {
      await overrides.onRecordPaidMessageDraft?.(input);
    }
  };
}

const fakeUnconfirmedSettlementVerifier: PaymentSettlementVerifier = {
  async verifyNativeSolTransfer() {
    return {
      confirmed: false,
      failureCode: "not_found"
    };
  }
};

function fakeEngagementRepository(
  overrides: Partial<{
    onGetFeedPreferences: EngagementCallback<"getFeedPreferences">;
    onUpdateFeedPreferences: EngagementCallback<"updateFeedPreferences">;
    onResetFeedRecommendations: EngagementCallback<"resetFeedRecommendations">;
    onHideCreator: EngagementCallback<"hideCreator">;
    onHideTopic: EngagementCallback<"hideTopic">;
    onToggleLike: EngagementCallback<"toggleLike">;
    onToggleSave: EngagementCallback<"toggleSave">;
    onListComments: EngagementCallback<"listComments">;
    onCreateComment: EngagementCallback<"createComment">;
    onCreateShare: EngagementCallback<"createShare">;
    onCreateReport: EngagementCallback<"createReport">;
    onBlockUser: EngagementCallback<"blockUser">;
  }> = {}
): EngagementRepository {
  return {
    async getFeedPreferences(input) {
      await overrides.onGetFeedPreferences?.(input);
      return {
        defaultMode: "recommended",
        nsfwPreference: "recommended",
        hiddenCreatorIds: [],
        hiddenTopics: []
      };
    },
    async updateFeedPreferences(input) {
      await overrides.onUpdateFeedPreferences?.(input);
      return {
        defaultMode: input.body.defaultMode ?? "recommended",
        nsfwPreference: input.body.nsfwPreference ?? "recommended",
        hiddenCreatorIds: [],
        hiddenTopics: []
      };
    },
    async resetFeedRecommendations(input) {
      await overrides.onResetFeedRecommendations?.(input);
    },
    async hideCreator(input) {
      await overrides.onHideCreator?.(input);
      return {
        defaultMode: "recommended",
        nsfwPreference: "recommended",
        hiddenCreatorIds: [input.creatorUserId],
        hiddenTopics: []
      };
    },
    async hideTopic(input) {
      await overrides.onHideTopic?.(input);
      return {
        defaultMode: "recommended",
        nsfwPreference: "recommended",
        hiddenCreatorIds: [],
        hiddenTopics: [input.topic]
      };
    },
    async toggleLike(input) {
      await overrides.onToggleLike?.(input);
      return engagementStateFixture({ liked: true, likeCount: 1 });
    },
    async toggleSave(input) {
      await overrides.onToggleSave?.(input);
      return engagementStateFixture({ saved: true });
    },
    async listComments(input) {
      await overrides.onListComments?.(input);
      return { items: [], nextCursor: null };
    },
    async createComment(input) {
      await overrides.onCreateComment?.(input);
      return {
        id: "00000000-0000-4000-8000-0000000000c1",
        author: homeFeedItem.creator,
        body: input.body.body,
        moderationState: "visible",
        createdAt: "2026-06-05T12:00:00.000Z"
      };
    },
    async createShare(input) {
      await overrides.onCreateShare?.(input);
      return {
        id: "00000000-0000-4000-8000-0000000000c2",
        mode: input.body.mode,
        url: input.body.mode === "internal_message" ? null : "http://localhost:3000/share/content/00000000-0000-4000-8000-000000000040"
      };
    },
    async createReport(input) {
      await overrides.onCreateReport?.(input);
      return {
        id: "00000000-0000-4000-8000-0000000000c3",
        state: "queued",
        queue: input.body.subjectType === "content" ? "content" : "general"
      };
    },
    async blockUser(input) {
      await overrides.onBlockUser?.(input);
      return {
        blocked: true,
        blockedUserId: input.blockedUserId
      };
    }
  };
}

type EngagementCallback<Key extends keyof EngagementRepository> = (
  input: EngagementInput<Key>
) => Promise<void> | void;

type EngagementInput<Key extends keyof EngagementRepository> =
  NonNullable<EngagementRepository[Key]> extends (input: infer Input) => Promise<unknown> ? Input : never;

type EngagementStateFixture = ReturnType<EngagementRepository["toggleLike"]> extends Promise<infer T> ? T : never;

function engagementStateFixture(overrides: Partial<EngagementStateFixture> = {}): EngagementStateFixture {
  return {
    liked: overrides.liked ?? false,
    saved: overrides.saved ?? false,
    likeCount: overrides.likeCount ?? 0,
    commentCount: overrides.commentCount ?? 0,
    shareCount: overrides.shareCount ?? 0
  };
}

const appReadySessionRepository = sessionRepositoryWithProfile({
  async onFind() {
    return {
      id: "00000000-0000-4000-8000-000000000010",
      state: "active",
      handle: "maki",
      displayName: "Maki",
      avatarUrl: null
    };
  }
});

const walletRepositoryWithWallet: WalletRepository = {
  async hasWalletBySupabaseUserId() {
    return true;
  },
  async listWalletsBySupabaseUserId() {
    return [
      {
        id: "00000000-0000-4000-8000-000000000020",
        chain: "solana_devnet",
        address: "VeelWallet111111111111111111111111111111111",
        provider: "embedded_privy",
        isPrimary: true
      }
    ];
  },
  async createLinkChallenge() {
    throw new Error("not implemented");
  },
  async findLinkChallenge() {
    throw new Error("not implemented");
  },
  async consumeVerifiedExternalWalletLink() {
    throw new Error("not implemented");
  },
  async findWalletForSupabaseUser(input) {
    if (input.walletId !== "00000000-0000-4000-8000-000000000020") {
      return null;
    }

    return {
      id: "00000000-0000-4000-8000-000000000020",
      chain: "solana_devnet",
      address: "VeelWallet111111111111111111111111111111111",
      provider: "embedded_privy",
      isPrimary: true
    };
  },
  async setPrimaryWallet() {
    throw new Error("not implemented");
  },
  async findOnrampSessionByIdempotencyKey() {
    return null;
  },
  async recordOnrampSession() {
    throw new Error("not implemented");
  }
};

const walletRepositoryWithoutWallet: WalletRepository = {
  async hasWalletBySupabaseUserId() {
    return false;
  },
  async listWalletsBySupabaseUserId() {
    return [];
  },
  async createLinkChallenge() {
    throw new Error("not implemented");
  },
  async findLinkChallenge() {
    throw new Error("not implemented");
  },
  async consumeVerifiedExternalWalletLink() {
    throw new Error("not implemented");
  },
  async findWalletForSupabaseUser() {
    return null;
  },
  async setPrimaryWallet() {
    throw new Error("not implemented");
  },
  async findOnrampSessionByIdempotencyKey() {
    return null;
  },
  async recordOnrampSession() {
    throw new Error("not implemented");
  }
};

function fakeAiRepository(): AiRepository {
  const sessions = new Map<string, AiSession>();
  const toolCalls = new Map<string, AiToolCall>();

  return {
    async createOrReuseSession(input) {
      const existing = [...sessions.values()].find(
        (session) => session.scope === input.scope && session.id === input.idempotencyKey
      );
      if (existing) return existing;

      const session: AiSession = {
        id: input.idempotencyKey,
        scope: input.scope,
        state: "active",
        allowedTools: input.allowedTools,
        createdAt: "2026-06-04T23:59:00.000Z",
        expiresAt: input.expiresAt.toISOString()
      };
      sessions.set(session.id, session);
      return session;
    },
    async findSessionForSupabaseUser(input) {
      return sessions.get(input.sessionId) ?? null;
    },
    async createOrReuseToolCall(input) {
      const key = `${input.session.id}:${input.idempotencyKey}`;
      const existing = toolCalls.get(key);
      if (existing) return existing;

      const toolCall: AiToolCall = {
        id: input.idempotencyKey,
        sessionId: input.session.id,
        toolName: input.toolName,
        state: input.state,
        confirmationState: input.confirmationState,
        inputSummary: input.inputSummary,
        outputSummary: input.outputSummary,
        result: input.outputRedacted,
        affectedResource: input.affectedResource,
        createdAt: "2026-06-04T23:59:10.000Z"
      };
      toolCalls.set(key, toolCall);
      return toolCall;
    }
  };
}

const unimplementedComplianceAdminMethods = {
  async listComplianceLedger() {
    throw new Error("not implemented");
  },
  async listDac7Reports() {
    throw new Error("not implemented");
  },
  async listCarfReports() {
    throw new Error("not implemented");
  },
  async listVatDeterminations() {
    throw new Error("not implemented");
  },
  async listReceipts() {
    throw new Error("not implemented");
  },
  async listInvoices() {
    throw new Error("not implemented");
  },
  async listReferralPrograms() {
    throw new Error("not implemented");
  },
  async listPartnerCampaigns() {
    throw new Error("not implemented");
  },
  async listTierWaivers() {
    throw new Error("not implemented");
  },
  async listOrganizations() {
    throw new Error("not implemented");
  }
} satisfies Pick<
  AdminRepository,
  | "listComplianceLedger"
  | "listDac7Reports"
  | "listCarfReports"
  | "listVatDeterminations"
  | "listReceipts"
  | "listInvoices"
  | "listReferralPrograms"
  | "listPartnerCampaigns"
  | "listTierWaivers"
  | "listOrganizations"
>;

const fakeAdminRepository: AdminRepository = {
  async hasAdminAccess(supabaseUserId) {
    expect(supabaseUserId).toBe("00000000-0000-4000-8000-000000000001");
    return true;
  },
  async getOpsSummary() {
    return {
      providerHealth: "ok",
      queueHealth: "ok",
      openReports: 0,
      paymentCounts: { total: 1, pending: 0, submitted: 0, confirmed: 1, failed: 0 },
      unlockCounts: { total: 1, pending: 0, submitted: 0, confirmed: 1, failed: 0 },
      providerEventCounts: { total: 1, pending: 0, submitted: 0, confirmed: 1, failed: 0 }
    };
  },
  async getNotificationHealth() {
    return {
      unreadCount: 2,
      readCount: 5,
      archivedCount: 1,
      activeDeviceCount: 1,
      revokedDeviceCount: 1,
      pushEnabledPreferenceCount: 1,
      queuedDeliveryCount: 2,
      leasedDeliveryCount: 0,
      deliveredDeliveryCount: 7,
      failedDeliveryCount: 1,
      skippedDeliveryCount: 0,
      revokedDeliveryCount: 0,
      latestNotificationAt: "2026-06-06T10:00:00.000Z",
      latestDeviceSeenAt: "2026-06-06T10:01:00.000Z",
      latestDeliveryAt: "2026-06-06T10:02:00.000Z"
    };
  },
  async listPaymentIntents(input) {
    expect(input.query).toBe("1111");
    return {
      items: [
        {
          id: "00000000-0000-4000-8000-000000000050",
          productType: "content_unlock",
          amountMinor: 10000000,
          currency: "SOL",
          state: "confirmed",
          userId: "00000000-0000-4000-8000-000000000011",
          targetId: "00000000-0000-4000-8000-000000000040",
          referenceAddress: "11111111111111111111111111111112",
          submittedSignature: "4".repeat(88),
          confirmedSignature: "5".repeat(88),
          settlementAttemptCount: 1,
          entitlementId: "00000000-0000-4000-8000-000000000090",
          createdAt: "2026-06-04T20:00:00.000Z",
          confirmedAt: "2026-06-04T20:01:00.000Z"
        }
      ],
      nextCursor: null
    };
  },
  async listUnlocks() {
    return {
      items: [
        {
          id: "00000000-0000-4000-8000-000000000090",
          userId: "00000000-0000-4000-8000-000000000011",
          targetType: "content",
          targetId: "00000000-0000-4000-8000-000000000040",
          productType: "content_unlock",
          paymentIntentId: "00000000-0000-4000-8000-000000000050",
          state: "active",
          grantedAt: "2026-06-04T20:01:00.000Z",
          expiresAt: null
        }
      ],
      nextCursor: null
    };
  },
  async listProviderEvents() {
    return {
      items: [
        {
          id: "00000000-0000-4000-8000-0000000000a0",
          provider: "solana_rpc",
          eventType: "payment.settlement",
          state: "processed",
          receivedAt: "2026-06-04T20:01:00.000Z",
          processedAt: "2026-06-04T20:01:01.000Z"
        }
      ],
      nextCursor: null
    };
  },
  async listSupportCases() {
    return {
      items: [
        {
          id: "00000000-0000-4000-8000-000000000150",
          organizationId: "00000000-0000-4000-8000-000000000140",
          requesterUserId: "00000000-0000-4000-8000-000000000011",
          assignedStaffUserId: null,
          category: "organization",
          state: "open",
          priority: "enterprise_review",
          subjectType: "organization",
          subjectId: "00000000-0000-4000-8000-000000000140",
          createdAt: "2026-06-06T09:00:00.000Z",
          updatedAt: null,
          closedAt: null
        }
      ],
      nextCursor: null
    };
  },
  async updateSupportCase(input) {
    return {
      id: input.supportCaseId,
      organizationId: "00000000-0000-4000-8000-000000000140",
      requesterUserId: "00000000-0000-4000-8000-000000000011",
      assignedStaffUserId: "00000000-0000-4000-8000-000000000001",
      category: "organization",
      state: input.body.state,
      priority: "enterprise_review",
      subjectType: "organization",
      subjectId: "00000000-0000-4000-8000-000000000140",
      createdAt: "2026-06-06T09:00:00.000Z",
      updatedAt: "2026-06-06T10:00:00.000Z",
      closedAt: input.body.state === "resolved" || input.body.state === "closed" ? "2026-06-06T10:00:00.000Z" : null
    };
  },
  async listSupportPolicies() {
    return {
      items: [
        {
          id: "00000000-0000-4000-8000-000000000151",
          organizationId: "00000000-0000-4000-8000-000000000140",
          supportState: "enterprise_review",
          slaTier: "enterprise_review",
          state: "review_required",
          policyReason: "KYB pending",
          moneyBoundary: "software_sla_only_no_social_priority",
          createdAt: "2026-06-06T09:00:00.000Z",
          updatedAt: "2026-06-06T09:00:00.000Z"
        }
      ],
      nextCursor: null
    };
  },
  async updateSupportPolicy(input) {
    return {
      id: input.supportPolicyId,
      organizationId: "00000000-0000-4000-8000-000000000140",
      supportState: input.body.supportState,
      slaTier: input.body.slaTier,
      state: input.body.state,
      policyReason: input.body.reason,
      moneyBoundary: "software_sla_only_no_social_priority",
      createdAt: "2026-06-06T09:00:00.000Z",
      updatedAt: "2026-06-06T10:30:00.000Z"
    };
  },
  async listRefundDisputes() {
    return {
      items: [
        {
          id: "00000000-0000-4000-8000-000000000160",
          paymentIntentId: "00000000-0000-4000-8000-000000000050",
          entitlementId: "00000000-0000-4000-8000-000000000090",
          reporterUserId: "00000000-0000-4000-8000-000000000011",
          kind: "access_issue",
          requestedAction: "replacement_access",
          state: "opened",
          resolution: null,
          custodyBoundary: "no_platform_custody_no_payout_queue",
          createdAt: "2026-06-06T11:00:00.000Z",
          updatedAt: null,
          resolvedAt: null
        }
      ],
      nextCursor: null
    };
  },
  async updateRefundDispute(input) {
    return {
      id: input.refundDisputeId,
      paymentIntentId: "00000000-0000-4000-8000-000000000050",
      entitlementId: "00000000-0000-4000-8000-000000000090",
      reporterUserId: "00000000-0000-4000-8000-000000000011",
      kind: "access_issue",
      requestedAction: "replacement_access",
      state: input.body.state,
      resolution: input.body.resolution,
      custodyBoundary: "no_platform_custody_no_payout_queue",
      createdAt: "2026-06-06T11:00:00.000Z",
      updatedAt: "2026-06-06T11:30:00.000Z",
      resolvedAt:
        input.body.state === "rejected" ||
        input.body.state === "withdrawn" ||
        input.body.state === "resolved" ||
        input.body.state === "closed"
          ? "2026-06-06T11:30:00.000Z"
          : null
    };
  },
  async getDatingSafety() {
    return {
      openReports: 0,
      activeMatches: 1,
      staleMatches: 0
    };
  },
  async listComplianceLedger() {
    return {
      items: [
        {
          id: "00000000-0000-4000-8000-0000000000b0",
          eventType: "payment_settled",
          productType: "event_access_pass",
          settlementModel: "user_to_creator_split",
          sellerUserId: "00000000-0000-4000-8000-000000000010",
          buyerUserId: "00000000-0000-4000-8000-000000000011",
          paymentIntentId: "00000000-0000-4000-8000-000000000050",
          entitlementId: "00000000-0000-4000-8000-000000000091",
          receiptId: "00000000-0000-4000-8000-0000000000c0",
          invoiceId: null,
          grossAmountMinor: 10000000,
          platformFeeMinor: 1000000,
          creatorNetAmountMinor: 9000000,
          taxAmountMinor: null,
          currency: "SOL",
          fiatCurrency: "USD",
          fxRate: null,
          sellerCountry: "CH",
          buyerCountry: "DE",
          sellerOfRecord: "creator",
          vatStatus: "pending",
          dac7Reportable: true,
          carfReportable: false,
          immutableHash: "hash",
          createdAt: "2026-06-05T10:00:00.000Z"
        }
      ],
      nextCursor: null
    };
  },
  async listDac7Reports() {
    return {
      items: [
        {
          id: "00000000-0000-4000-8000-0000000000d0",
          reportType: "dac7",
          reportingYear: 2026,
          state: "draft",
          lineCount: 0,
          jurisdiction: "EU",
          exportId: null,
          carfReportingRequired: null,
          createdAt: "2026-06-05T10:00:00.000Z",
          exportedAt: null
        }
      ],
      nextCursor: null
    };
  },
  async listCarfReports() {
    return {
      items: [
        {
          id: "00000000-0000-4000-8000-0000000000d1",
          reportType: "carf",
          reportingYear: 2026,
          state: "draft",
          lineCount: 0,
          jurisdiction: "EU",
          exportId: null,
          carfReportingRequired: false,
          createdAt: "2026-06-05T10:00:00.000Z",
          exportedAt: null
        }
      ],
      nextCursor: null
    };
  },
  async listVatDeterminations() {
    return {
      items: [
        {
          id: "00000000-0000-4000-8000-0000000000e0",
          productType: "event_access_pass",
          sellerOfRecord: "creator",
          buyerCountry: "DE",
          sellerCountry: "CH",
          buyerVatId: null,
          viesStatus: "not_checked",
          placeOfSupply: null,
          vatStatus: "pending",
          vatRateBps: null,
          vatAmountMinor: null,
          reviewState: "clear",
          createdAt: "2026-06-05T10:00:00.000Z"
        }
      ],
      nextCursor: null
    };
  },
  async listReceipts() {
    return {
      items: [
        {
          id: "00000000-0000-4000-8000-0000000000c0",
          receiptNumber: "R-2026-0001",
          productType: "event_access_pass",
          buyerUserId: "00000000-0000-4000-8000-000000000011",
          sellerUserId: "00000000-0000-4000-8000-000000000010",
          paymentIntentId: "00000000-0000-4000-8000-000000000050",
          grossAmountMinor: 10000000,
          currency: "SOL",
          state: "issued",
          issuedAt: "2026-06-05T10:00:00.000Z"
        }
      ],
      nextCursor: null
    };
  },
  async listInvoices() {
    return {
      items: [
        {
          id: "00000000-0000-4000-8000-0000000000f0",
          invoiceNumber: "V-2026-0001",
          sellerOfRecord: "veel",
          buyerUserId: "00000000-0000-4000-8000-000000000011",
          sellerUserId: null,
          totalAmountMinor: 8990000,
          vatAmountMinor: 0,
          currency: "USDC",
          state: "issued",
          issuedAt: "2026-06-05T10:00:00.000Z"
        }
      ],
      nextCursor: null
    };
  },
  async listReferralPrograms() {
    return {
      items: [
        {
          id: "00000000-0000-4000-8000-000000000110",
          name: "Invite Referral",
          state: "active",
          priority: "invite",
          commissionSource: "veel_platform_commission_net_of_refunds_and_tax",
          createdAt: "2026-06-05T10:00:00.000Z"
        }
      ],
      nextCursor: null
    };
  },
  async listPartnerCampaigns() {
    return {
      items: [
        {
          id: "00000000-0000-4000-8000-000000000120",
          name: "Partner launch",
          partnerName: "Partner",
          state: "active",
          contractId: null,
          createdAt: "2026-06-05T10:00:00.000Z"
        }
      ],
      nextCursor: null
    };
  },
  async listTierWaivers() {
    return {
      items: [
        {
          id: "00000000-0000-4000-8000-000000000130",
          subjectType: "partner_campaign",
          subjectId: "00000000-0000-4000-8000-000000000120",
          tierKey: "veel_studio",
          state: "active",
          startsAt: "2026-06-05T10:00:00.000Z",
          endsAt: null
        }
      ],
      nextCursor: null
    };
  },
  async listOrganizations() {
    return {
      items: [
        {
          id: "00000000-0000-4000-8000-000000000140",
          name: "Veel Enterprise",
          state: "pending_kyb",
          plan: "enterprise",
          kybState: "pending",
          createdAt: "2026-06-05T10:00:00.000Z"
        }
      ],
      nextCursor: null
    };
  },
  async updateOrganizationKyb(input) {
    return {
      id: input.organizationId,
      name: "Veel Enterprise",
      state: input.body.kybState === "verified" ? "active" : "pending_kyb",
      plan: "enterprise",
      kybState: input.body.kybState,
      createdAt: "2026-06-05T10:00:00.000Z"
    };
  },
  async listOrganizationMembers() {
    return {
      items: [
        {
          id: "00000000-0000-4000-8000-000000000141",
          organizationId: "00000000-0000-4000-8000-000000000140",
          userId: "00000000-0000-4000-8000-000000000001",
          role: "owner",
          state: "active",
          invitedByUserId: null,
          joinedAt: "2026-06-05T10:00:00.000Z",
          createdAt: "2026-06-05T10:00:00.000Z",
          updatedAt: "2026-06-05T10:00:00.000Z"
        }
      ],
      nextCursor: null
    };
  },
  async updateOrganizationMember(input) {
    return {
      id: input.membershipId,
      organizationId: input.organizationId,
      userId: "00000000-0000-4000-8000-000000000001",
      role: input.body.role,
      state: input.body.state,
      invitedByUserId: null,
      joinedAt: input.body.state === "active" ? "2026-06-05T10:00:00.000Z" : null,
      createdAt: "2026-06-05T10:00:00.000Z",
      updatedAt: "2026-06-06T12:30:00.000Z"
    };
  }
};

function datingProfileFixture(overrides: Partial<Awaited<ReturnType<DatingRepository["activate"]>>> = {}) {
  return {
    enabled: overrides.enabled ?? true,
    consentVersion: overrides.consentVersion ?? "dating-consent-2026-06-04",
    activeMatchLimit: overrides.activeMatchLimit ?? 10,
    visibleOnMedia: overrides.visibleOnMedia ?? true,
    safetyState: overrides.safetyState ?? ("clear" as const),
    createdAt: overrides.createdAt ?? "2026-06-04T22:30:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-06-04T22:30:00.000Z"
  };
}

function datingFeedItemFixture() {
  return {
    contentId: "00000000-0000-4000-8000-000000000040",
    creatorUserId: "00000000-0000-4000-8000-000000000011",
    handle: "maki",
    displayName: "Maki",
    avatarUrl: null,
    title: "Dating mode profile card",
    mediaKind: "image" as const,
    posterUrl: "https://media.example.test/dating.jpg",
    createdAt: "2026-06-04T22:31:00.000Z"
  };
}

function datingMatchFixture() {
  return {
    id: "00000000-0000-4000-8000-0000000000d2",
    userAId: "00000000-0000-4000-8000-000000000001",
    userBId: "00000000-0000-4000-8000-000000000011",
    sourceContentId: "00000000-0000-4000-8000-000000000040",
    conversationId: "00000000-0000-4000-8000-0000000000d3",
    state: "active" as const,
    staleAt: "2026-06-11T22:31:00.000Z",
    expiresAt: "2026-07-04T22:31:00.000Z",
    createdAt: "2026-06-04T22:31:00.000Z"
  };
}

function eventFixture(
  overrides: Partial<{
    id: string;
    state: "draft" | "published" | "sold_out" | "cancelled" | "completed";
    ticketTypeId: string;
    priceMinor: number | null;
  }> = {}
) {
  const ticketTypeId = overrides.ticketTypeId ?? "00000000-0000-4000-8000-0000000000e2";
  const priceMinor: number | null = overrides.priceMinor === undefined ? 10000000 : overrides.priceMinor;

  return {
    id: overrides.id ?? "00000000-0000-4000-8000-0000000000e1",
    title: "Studio meetup",
    description: null,
    startsAt: "2026-07-01T20:00:00.000Z",
    endsAt: null,
    accessRule: "public_sale" as const,
    location: { type: "physical" as const, label: "Belgrade studio" },
    state: overrides.state ?? "published",
    ticketTypes: [ticketTypeFixture({ id: ticketTypeId, priceMinor })]
  };
}

function ticketTypeFixture(
  overrides: Partial<{
    id: string;
    priceMinor: number | null;
  }> = {}
) {
  const priceMinor: number | null = overrides.priceMinor === undefined ? 10000000 : overrides.priceMinor;

  return {
    id: overrides.id ?? "00000000-0000-4000-8000-0000000000e2",
    label: "General admission",
    priceMinor,
    currency: "SOL" as const,
    capacity: 25,
    remaining: 25,
    state: "active" as const,
    saleStartsAt: null,
    saleEndsAt: null,
    perUserLimit: 1
  };
}

function ticketFixture(
  overrides: Partial<{
    eventId: string;
    ticketTypeId: string;
  }> = {}
) {
  return {
    id: "00000000-0000-4000-8000-0000000000f1",
    eventId: overrides.eventId ?? "00000000-0000-4000-8000-0000000000e1",
    ticketTypeId: overrides.ticketTypeId ?? "00000000-0000-4000-8000-0000000000e2",
    holderUserId: "00000000-0000-4000-8000-000000000001",
    paymentIntentId: null,
    state: "active" as const,
    qrToken: "veel_ticket_fixture",
    checkedInAt: null,
    createdAt: "2026-07-01T20:00:00.000Z"
  };
}

function notificationFixture(overrides: Partial<Notification> = {}): Notification {
  return {
    id: overrides.id ?? "00000000-0000-4000-8000-000000000090",
    kind: overrides.kind ?? "message",
    title: overrides.title ?? "New message",
    body: overrides.body ?? null,
    actionUrl: overrides.actionUrl ?? "/messages",
    state: overrides.state ?? "unread",
    relatedResource: overrides.relatedResource ?? null,
    createdAt: overrides.createdAt ?? "2026-06-06T09:00:00.000Z",
    readAt: overrides.readAt ?? null
  };
}

function notificationPreferencesFixture(
  overrides: Partial<NotificationPreferences> = {}
): NotificationPreferences {
  return {
    messagesEnabled: overrides.messagesEnabled ?? true,
    engagementEnabled: overrides.engagementEnabled ?? true,
    liveEnabled: overrides.liveEnabled ?? true,
    paymentsEnabled: overrides.paymentsEnabled ?? true,
    membershipsEnabled: overrides.membershipsEnabled ?? true,
    eventAccessEnabled: overrides.eventAccessEnabled ?? true,
    mutualsEnabled: overrides.mutualsEnabled ?? false,
    safetyEnabled: overrides.safetyEnabled ?? true,
    walletEnabled: overrides.walletEnabled ?? true,
    creatorSetupEnabled: overrides.creatorSetupEnabled ?? true,
    studioSetupEnabled: overrides.studioSetupEnabled ?? true,
    pushEnabled: overrides.pushEnabled ?? true,
    updatedAt: overrides.updatedAt ?? "2026-06-06T09:00:00.000Z"
  };
}

function notificationDeviceFixture(overrides: Partial<NotificationDevice> = {}): NotificationDevice {
  return {
    id: overrides.id ?? "00000000-0000-4000-8000-000000000091",
    provider: overrides.provider ?? "web_push",
    platform: overrides.platform ?? "desktop",
    state: overrides.state ?? "active",
    createdAt: overrides.createdAt ?? "2026-06-06T09:00:00.000Z",
    lastSeenAt: overrides.lastSeenAt ?? "2026-06-06T09:00:00.000Z"
  };
}

function fakeNotificationRepository(
  overrides: Partial<{
    onListNotifications: (
      input: Parameters<NotificationRepository["listNotifications"]>[0]
    ) => Awaited<ReturnType<NotificationRepository["listNotifications"]>>;
    onMarkRead: (
      input: Parameters<NotificationRepository["markRead"]>[0]
    ) => Awaited<ReturnType<NotificationRepository["markRead"]>>;
    onGetPreferences: (
      input: Parameters<NotificationRepository["getPreferences"]>[0]
    ) => Awaited<ReturnType<NotificationRepository["getPreferences"]>>;
    onUpdatePreferences: (
      input: Parameters<NotificationRepository["updatePreferences"]>[0]
    ) => Awaited<ReturnType<NotificationRepository["updatePreferences"]>>;
    onRegisterDevice: (
      input: Parameters<NotificationRepository["registerDevice"]>[0]
    ) => Awaited<ReturnType<NotificationRepository["registerDevice"]>>;
    onDeleteDevice: (
      input: Parameters<NotificationRepository["deleteDevice"]>[0]
    ) => Awaited<ReturnType<NotificationRepository["deleteDevice"]>>;
  }> = {}
): NotificationRepository {
  return {
    async listNotifications(input) {
      return overrides.onListNotifications?.(input) ?? { items: [notificationFixture()], nextCursor: null };
    },
    async markRead(input) {
      return overrides.onMarkRead?.(input) ?? notificationFixture({ id: input.notificationId, state: "read" });
    },
    async getPreferences(input) {
      return overrides.onGetPreferences?.(input) ?? notificationPreferencesFixture();
    },
    async updatePreferences(input) {
      return overrides.onUpdatePreferences?.(input) ?? notificationPreferencesFixture(input.body);
    },
    async registerDevice(input) {
      return overrides.onRegisterDevice?.(input) ?? notificationDeviceFixture({ platform: input.body.platform });
    },
    async deleteDevice(input) {
      return overrides.onDeleteDevice?.(input) ?? Boolean(input.notificationDeviceId);
    }
  };
}

function organizationDashboardFixture(
  overrides: Partial<OrganizationDashboard> = {}
): OrganizationDashboard {
  return {
    organization: overrides.organization ?? {
      id: "00000000-0000-4000-8000-0000000000a1",
      organizationId: "00000000-0000-4000-8000-0000000000a0",
      name: "Veel Enterprise",
      state: "active",
      plan: "enterprise",
      kybState: "verified",
      role: "owner",
      membershipState: "active",
      createdAt: "2026-06-06T10:00:00.000Z",
      joinedAt: "2026-06-06T10:01:00.000Z"
    },
    governance: overrides.governance ?? {
      kybState: "verified",
      memberCount: 3,
      activeMemberCount: 3,
      tierWaiverState: "none",
      supportState: "priority"
    },
    capabilities: overrides.capabilities ?? {
      rbacEnabled: true,
      teamPublishingEnabled: true,
      consolidatedReportingEnabled: true,
      complianceExportsEnabled: true
    },
    rolePermissions: overrides.rolePermissions ?? [
      {
        key: "manage_members",
        label: "Manage members",
        allowed: true,
        reason: "allowed"
      },
      {
        key: "publish_team_content",
        label: "Publish team content",
        allowed: true,
        reason: "allowed"
      },
      {
        key: "view_consolidated_reporting",
        label: "View consolidated reporting",
        allowed: true,
        reason: "allowed"
      },
      {
        key: "export_compliance",
        label: "Export compliance",
        allowed: true,
        reason: "allowed"
      },
      {
        key: "manage_support",
        label: "Manage support",
        allowed: true,
        reason: "allowed"
      }
    ],
    financeBoundary: overrides.financeBoundary ?? "no_custody_no_payout_queue",
    notices: overrides.notices ?? []
  };
}

function fakeOrganizationRepository(
  overrides: Partial<{
    onListMyDashboards: (
      input: Parameters<OrganizationRepository["listMyDashboards"]>[0]
    ) => OrganizationDashboardPage;
  }> = {}
): OrganizationRepository {
  return {
    async listMyDashboards(input) {
      return overrides.onListMyDashboards?.(input) ?? {
        items: [organizationDashboardFixture()],
        nextCursor: null
      };
    }
  };
}

function sessionRepositoryWithProfile(options: {
  onEnsure?: (supabaseUserId: string) => Promise<void> | void;
  onFind: SessionRepository["findProfileBySupabaseUserId"];
}): SessionRepository {
  return {
    async ensureUserForSupabaseId(supabaseUserId) {
      await options.onEnsure?.(supabaseUserId);
    },
    findProfileBySupabaseUserId: options.onFind
  };
}

const fakeProfileRepository: ProfileRepository = {
  async upsertMyProfile(supabaseUserId, input) {
    expect(supabaseUserId).toBe("00000000-0000-4000-8000-000000000001");
    expect(input).toMatchObject({
      handle: "maki",
      displayName: "Maki",
      bio: "Building Veel v2"
    });

    return {
      id: "00000000-0000-4000-8000-000000000010",
      handle: input.handle,
      displayName: input.displayName,
      avatarUrl: null,
      badges: []
    };
  },
  async findCreatorProfileByHandle(handle) {
    expect(handle).toBe("maki");

    return {
      user: {
        id: "00000000-0000-4000-8000-000000000010",
        handle: "maki",
        displayName: "Maki",
        avatarUrl: null,
        badges: []
      },
      bio: "Building Veel v2",
      locationLabel: "Belgrade",
      stats: {
        contentCount: 2,
        liveRoomCount: 1,
        confirmedPaymentCount: 3,
        followerCount: 0
      },
      monetisation: {
        tipsEnabled: true,
        contentUnlocksEnabled: true,
        livePassesEnabled: true,
        paidMessagesEnabled: true,
        subscriptionsEnabled: false
      },
      recentContent: []
    };
  },
  async getMyCreatorDashboard(supabaseUserId) {
    expect(supabaseUserId).toBe("00000000-0000-4000-8000-000000000001");

    return {
      creator: {
        id: "00000000-0000-4000-8000-000000000010",
        handle: "maki",
        displayName: "Maki",
        avatarUrl: null,
        badges: []
      },
      readiness: {
        state: "active",
        earningState: "ready",
        kycState: "not_required",
        taxProfileState: "not_required",
        recipientWalletState: "missing",
        blockedReasons: ["earnings_recipient_wallet_required"]
      },
      earnings: {
        currency: "SOL",
        creatorEarningsMinor: 85000000,
        platformFeesMinor: 15000000,
        referralCommissionsMinor: 5000000,
        confirmedPaymentCount: 3
      },
      products: [
        {
          productType: "tip",
          enabled: true,
          confirmedPaymentCount: 2,
          amountMinor: 70000000,
          currency: "SOL"
        }
      ],
      recentActivity: []
    };
  },
  async getMyCreatorOnboarding(supabaseUserId) {
    expect(supabaseUserId).toBe("00000000-0000-4000-8000-000000000001");

    return {
      state: "action_required",
      canStartEarning: false,
      nextAction: "/wallet",
      steps: [
        {
          key: "profile",
          label: "Profile",
          state: "complete",
          required: true,
          actionHref: null
        },
        {
          key: "age",
          label: "Age verification",
          state: "complete",
          required: true,
          actionHref: null
        },
        {
          key: "wallet",
          label: "Wallet",
          state: "action_required",
          required: true,
          actionHref: "/wallet"
        },
        {
          key: "kyc",
          label: "Creator verification",
          state: "not_required",
          required: false,
          actionHref: null
        },
        {
          key: "tax_profile",
          label: "Tax profile",
          state: "not_required",
          required: false,
          actionHref: null
        },
        {
          key: "recipient_wallet",
          label: "Earnings wallet",
          state: "action_required",
          required: true,
          actionHref: "/wallet"
        },
        {
          key: "products",
          label: "Products",
          state: "complete",
          required: true,
          actionHref: null
        }
      ]
    };
  }
};
