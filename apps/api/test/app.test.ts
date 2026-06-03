import { describe, expect, it } from "vitest";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { buildApi } from "../src/app";
import type { ContentItem, ContentRepository } from "../src/modules/content/types";
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
      async listHomeFeed(input) {
        expect(input).toEqual({
          mode: "recommended",
          cursor: undefined,
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
