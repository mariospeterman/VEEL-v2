import { describe, expect, it, vi } from "vitest";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { buildApi } from "../src/app";
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

    expect(response.statusCode).toBe(201);
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

    expect(response.statusCode).toBe(201);
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
  }
};
