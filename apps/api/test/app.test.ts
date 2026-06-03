import { describe, expect, it } from "vitest";
import { buildApi } from "../src/app";
import type { AgeRepository } from "../src/modules/age/types";
import type { ProfileRepository } from "../src/modules/profile/types";
import type {
  SessionRepository,
  SupabaseAuthVerifier,
  VerifiedSupabaseSession
} from "../src/modules/session/types";
import type { WalletRepository } from "../src/modules/wallet/types";

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
  }
};

const requiredAgeRepository: AgeRepository = {
  async findLatestAgeStatusBySupabaseUserId() {
    return {
      state: "required",
      provider: null
    };
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
  }
};

const walletRepositoryWithoutWallet: WalletRepository = {
  async hasWalletBySupabaseUserId() {
    return false;
  },
  async listWalletsBySupabaseUserId() {
    return [];
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
