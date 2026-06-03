import { describe, expect, it } from "vitest";
import { buildApi } from "../src/app";
import type { AgeRepository } from "../src/modules/age/types";
import type {
  SupabaseAuthVerifier,
  VerifiedSupabaseSession
} from "../src/modules/session/types";

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
      sessionRepository: {
        async findProfileBySupabaseUserId(supabaseUserId) {
          expect(supabaseUserId).toBe("00000000-0000-4000-8000-000000000001");

          return {
            id: "00000000-0000-4000-8000-000000000010",
            state: "active",
            handle: "maki",
            displayName: "Maki",
            avatarUrl: null
          };
        }
      }
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
      sessionRepository: {
        async findProfileBySupabaseUserId() {
          return {
            id: "00000000-0000-4000-8000-000000000010",
            state: "active",
            handle: "maki",
            displayName: "Maki",
            avatarUrl: null
          };
        }
      }
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

  it("keeps authenticated users gated until the Veel profile exists", async () => {
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      ageRepository: requiredAgeRepository,
      sessionRepository: {
        async findProfileBySupabaseUserId() {
          return null;
        }
      }
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
