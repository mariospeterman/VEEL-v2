import { exportJWK, generateKeyPair, jwtVerify } from "jose";
import { parseServerEnv } from "@veel/config";
import { describe, expect, it } from "vitest";
import { buildApi } from "../src/app";
import { createPostgresAgeRepository } from "../src/modules/age/age-repository";
import { createRealtimeTokenIssuer, RealtimeTokenConfigurationError } from "../src/modules/realtime/realtime-token";
import { createPostgresSessionRepository } from "../src/modules/session/session-repository";
import { createPostgresWalletRepository } from "../src/modules/wallet/wallet-repository";

const userId = "00000000-0000-4000-8000-000000000301";

describe("canonical-session Realtime tokens", () => {
  it("mints a short-lived ES256 token with Supabase RLS claims", async () => {
    const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
    const privateJwk = await exportJWK(privateKey);
    const issuer = createRealtimeTokenIssuer(
      parseServerEnv({
        NODE_ENV: "test",
        REALTIME_JWT_PRIVATE_JWK: JSON.stringify(privateJwk),
        REALTIME_JWT_KEY_ID: "staging-key",
        REALTIME_JWT_ISSUER: "https://example.supabase.co/auth/v1",
        REALTIME_JWT_TTL_SECONDS: "120"
      } as NodeJS.ProcessEnv)
    );

    const issued = await issuer.issueToken({ userId });
    const verified = await jwtVerify(issued.token, publicKey, {
      algorithms: ["ES256"],
      audience: "authenticated",
      issuer: "https://example.supabase.co/auth/v1",
      subject: userId
    });

    expect(verified.protectedHeader).toMatchObject({ alg: "ES256", kid: "staging-key" });
    expect(verified.payload.role).toBe("authenticated");
    expect(verified.payload.wevid_session).toBe(true);
    expect(Date.parse(issued.expiresAt)).toBeGreaterThan(Date.now());
    expect(issued.accountTopic).toBe(`account:${userId}`);
    expect((verified.payload.exp ?? 0) - (verified.payload.iat ?? 0)).toBe(120);
  });

  it("fails closed when the imported signing key is absent", async () => {
    const issuer = createRealtimeTokenIssuer(parseServerEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv));
    await expect(issuer.issueToken({ userId })).rejects.toBeInstanceOf(
      RealtimeTokenConfigurationError
    );
  });

  it("requires a canonical application session at the token route", async () => {
    const app = await buildApi({
      authVerifier: { async verifyToken() { return null; } },
      realtimeTokenIssuer: {
        async issueToken() {
          throw new Error("must not mint");
        }
      }
    });

    const response = await app.inject({ method: "POST", url: "/v1/realtime/token" });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("passes only the canonical user id to the configured issuer", async () => {
    const seen: string[] = [];
    const app = await buildApi({
      authVerifier: {
        async verifyToken() {
          return {
            userId,
            supabaseUserId: userId,
            sessionId: "00000000-0000-4000-8000-000000000302",
            authenticatedAt: new Date(),
            authenticationMethod: "wallet"
          };
        }
      },
      sessionRepository: readySessionRepository(),
      ageRepository: verifiedAgeRepository(),
      walletRepository: readyWalletRepository(),
      realtimeTokenIssuer: {
        async issueToken(input) {
          seen.push(input.userId);
          return { token: "signed-token", expiresAt: "2030-01-01T00:00:00.000Z", accountTopic: `account:${userId}` };
        }
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/realtime/token",
      headers: {
        authorization: "Bearer wevid_session_test",
        "idempotency-key": "realtime-token-test"
      }
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ token: "signed-token", expiresAt: "2030-01-01T00:00:00.000Z", accountTopic: `account:${userId}` });
    expect(seen).toEqual([userId]);
    await app.close();
  });

  it("denies token minting when protected-app readiness is no longer valid", async () => {
    let issued = false;
    const app = await buildApi({
      authVerifier: {
        async verifyToken() {
          return {
            userId,
            supabaseUserId: userId,
            sessionId: "00000000-0000-4000-8000-000000000303",
            authenticatedAt: new Date(),
            authenticationMethod: "wallet"
          };
        }
      },
      sessionRepository: readySessionRepository(),
      ageRepository: {
        ...createPostgresAgeRepository(),
        async findLatestAgeStatusBySupabaseUserId() {
          return { state: "failed" as const, provider: "test" };
        }
      },
      walletRepository: readyWalletRepository(),
      realtimeTokenIssuer: {
        async issueToken() {
          issued = true;
          return { token: "must-not-mint", expiresAt: "2030-01-01T00:00:00.000Z", accountTopic: `account:${userId}` };
        }
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/realtime/token",
      headers: {
        authorization: "Bearer wevid_session_test",
        "idempotency-key": "realtime-token-denied-test"
      }
    });
    expect(response.statusCode).toBe(403);
    expect(issued).toBe(false);
    await app.close();
  });
});

function readySessionRepository() {
  return {
    ...createPostgresSessionRepository(),
    async findProfileBySupabaseUserId() {
      return { id: userId, state: "active", handle: "ready", displayName: "Ready User" };
    }
  };
}

function verifiedAgeRepository() {
  return {
    ...createPostgresAgeRepository(),
    async findLatestAgeStatusBySupabaseUserId() {
      return { state: "verified" as const, provider: "test" };
    }
  };
}

function readyWalletRepository() {
  return {
    ...createPostgresWalletRepository(),
    async hasWalletBySupabaseUserId() {
      return true;
    }
  };
}
