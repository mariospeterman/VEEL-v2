import { describe, expect, it, vi } from "vitest";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { buildApi } from "../src/app";
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
import type { ProfileRepository } from "../src/modules/profile/types";
import type { ReferralRepository } from "../src/modules/referral/types";
import type {
  SessionRepository,
  SupabaseAuthVerifier,
  VerifiedSupabaseSession
} from "../src/modules/session/types";
import type {
  StoredWalletLinkChallenge,
  WalletRepository,
  WalletResource
} from "../src/modules/wallet/types";
import type {
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
import type { EventRepository } from "../src/modules/event/types";

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
        AGE_VERIFICATION_ALLOW_MOCK_PROVIDER: false,
        SUMSUB_API_BASE_URL: "https://api.sumsub.com",
        YOTI_API_BASE_URL: "https://age.yoti.com/api/v1",
        YOTI_LAUNCH_BASE_URL: "https://age.yoti.com",
        VERIFF_API_BASE_URL: "https://stationapi.veriff.com",
        PERSONA_API_BASE_URL: "https://api.withpersona.com",
        BUNNY_STREAM_API_KEY: "bunny-secret",
        BUNNY_STREAM_LIBRARY_ID: "library-id"
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
    const referralRepository: ReferralRepository = {
      async createOrReuseToken() {
        throw new Error("not implemented");
      },
      async listActivity(input) {
        expect(input).toEqual({
          supabaseUserId: "00000000-0000-4000-8000-000000000001",
          limit: 20
        });

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
        async listPaymentIntents() {
          throw new Error("not implemented");
        },
        async listUnlocks() {
          throw new Error("not implemented");
        },
        async listProviderEvents() {
          throw new Error("not implemented");
        }
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

  it("returns admin payment, unlock, and provider ops projections", async () => {
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      adminRepository: fakeAdminRepository
    });
    await app.ready();

    const [summary, payments, unlocks, providerEvents] = await Promise.all([
      app.inject({
        method: "GET",
        url: "/v1/admin/ops/summary",
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
    onUpdateRoomStatus: LiveRepository["updateRoomStatus"];
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
    async updateRoomStatus(input) {
      await overrides.onUpdateRoomStatus?.(input);
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
  }
};

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
  }
};

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
  }
};
