import { createHash, createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { buildApi } from "../src/app";
import { AdminRepositoryStateConflictError } from "../src/modules/admin/admin-repository";
import type { AdminRepository } from "../src/modules/admin/types";
import type { ActivityRepository } from "../src/modules/activity/types";
import { createBunnyStreamUploadAdapter } from "../src/modules/content/media-upload-adapter";
import { StaleFeedCursorError } from "../src/modules/content/content-feed-cursor";
import { ContentDraftQuotaExceededError } from "../src/modules/content/content-repository";
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
import {
  WalletRecoveryCredentialRequiredError,
  WalletRecoveryLinkConflictError,
  type WalletAuthRepository
} from "../src/modules/auth/wallet-auth-repository";
import type { ProfileRepository } from "../src/modules/profile/types";
import type { ReferralRepository } from "../src/modules/referral/types";
import type { RefundRepository } from "../src/modules/refund/types";
import type {
  SessionRepository,
  ApplicationSessionVerifier,
  VerifiedApplicationSession
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
import { LiveProviderConfigurationError } from "../src/modules/live/livepeer-adapter";
import { MessageIdempotencyConflictError } from "../src/modules/message/message-repository";
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
import type { MutualsRepository } from "../src/modules/mutuals/types";
import type { DiscoverRepository } from "../src/modules/discover/types";
import type { EngagementRepository } from "../src/modules/engagement/types";
import type {
  PlatformAccess,
  PlatformPlaybackSession,
  Subscription,
  SubscriptionAuthorizationIntent,
  SubscriptionAuthorizationVerifier,
  SubscriptionPage,
  SubscriptionPlan,
  SubscriptionRepository
} from "../src/modules/subscription/types";
import type {
  CapabilityResolution,
  VerificationProviderSession,
  VerificationProviderWaterfall,
  VerificationRepository
} from "../src/modules/verification/types";

const checkoutPaymentRepositoryMethods = {
  async findCheckoutIntent() {
    return null;
  },
  async recordCheckoutPayer() {
    return null;
  }
} satisfies Pick<PaymentRepository, "findCheckoutIntent" | "recordCheckoutPayer">;

describe("buildApi", () => {
  beforeEach(() => {
    vi.stubEnv("API_TRUST_PROXY", "");
  });

  it("boots the Fastify skeleton and loads the OpenAPI document", async () => {
    const app = await buildApi();
    await app.ready();

    expect(app.supabaseBoundary.hasServiceRoleKey).toBe(false);
    expect(app.swagger()).toMatchObject({
      openapi: "3.1.0",
      info: {
        title: "WeVid API"
      }
    });

    await app.close();
  });

  it("sets API security headers without enabling development HSTS", async () => {
    const app = await buildApi();
    await app.ready();

    const response = await app.inject({ method: "GET", url: "/healthz" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-frame-options"]).toBe("SAMEORIGIN");
    expect(response.headers["strict-transport-security"]).toBeUndefined();

    await app.close();
  });

  it("rate limits repeated age-session mutations", async () => {
    const app = await buildApi();
    await app.ready();

    for (let requestNumber = 0; requestNumber < 8; requestNumber += 1) {
      const response = await app.inject({
        method: "POST",
        url: "/v1/age/sessions",
        headers: { "idempotency-key": `age-rate-limit-${requestNumber}` },
        payload: { providerPreference: "reusable_first" }
      });
      expect(response.statusCode).toBe(401);
    }

    const limited = await app.inject({
      method: "POST",
      url: "/v1/age/sessions",
      headers: { "idempotency-key": "age-rate-limit-final" },
      payload: { providerPreference: "reusable_first" }
    });
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toEqual({
      code: "rate_limited",
      message: "Too many requests"
    });

    await app.close();
  });

  it("rate limits auth, verification, message, and payment mutation abuse", async () => {
    vi.stubEnv("LOG_LEVEL", "silent");
    const app = await buildApi();
    await app.ready();

    const cases = [
      {
        count: 21,
        request: (index: number) => ({
          method: "POST" as const,
          url: "/v1/auth/wallet/challenges",
          payload: {
            chain: "solana_devnet",
            provider: "phantom",
            address: "1".repeat(32)
          },
          headers: { "x-test-request": String(index) }
        })
      },
      {
        count: 9,
        request: (index: number) => ({
          method: "POST" as const,
          url: "/v1/verification/sessions",
          headers: { "idempotency-key": `verification-abuse-${index}` }
        })
      },
      {
        count: 31,
        request: () => ({
          method: "POST" as const,
          url: "/v1/messages/conversations/00000000-0000-4000-8000-000000000001/messages"
        })
      },
      {
        count: 13,
        request: (index: number) => ({
          method: "POST" as const,
          url: "/v1/payments/intents",
          headers: { "idempotency-key": `payment-abuse-${index}` }
        })
      }
    ];

    for (const testCase of cases) {
      let response;
      for (let index = 0; index < testCase.count; index += 1) {
        response = await app.inject(testCase.request(index));
      }
      expect(response?.statusCode).toBe(429);
      expect(response?.json()).toEqual({ code: "rate_limited", message: "Too many requests" });
    }

    await app.close();
    vi.unstubAllEnvs();
  });

  it("uses trusted forwarded client IPs as distinct limiter keys", async () => {
    vi.stubEnv("API_TRUST_PROXY", "127.0.0.1");
    vi.stubEnv("LOG_LEVEL", "silent");
    const app = await buildApi();
    await app.ready();

    for (let index = 0; index < 8; index += 1) {
      await app.inject({
        method: "POST",
        url: "/v1/age/sessions",
        headers: {
          "idempotency-key": `trusted-proxy-a-${index}`,
          "x-forwarded-for": "203.0.113.10"
        },
        payload: { providerPreference: "reusable_first" }
      });
    }

    const distinctClient = await app.inject({
      method: "POST",
      url: "/v1/age/sessions",
      headers: {
        "idempotency-key": "trusted-proxy-client-b",
        "x-forwarded-for": "203.0.113.11"
      },
      payload: { providerPreference: "reusable_first" }
    });
    expect(distinctClient.statusCode).toBe(401);

    const limitedClient = await app.inject({
      method: "POST",
      url: "/v1/age/sessions",
      headers: {
        "idempotency-key": "trusted-proxy-client-a-final",
        "x-forwarded-for": "203.0.113.10"
      },
      payload: { providerPreference: "reusable_first" }
    });
    expect(limitedClient.statusCode).toBe(429);

    await app.close();
    vi.unstubAllEnvs();
  });

  it("fails closed when the distributed limiter store is unavailable", async () => {
    vi.stubEnv("API_RATE_LIMIT_STORE_DRIVER", "external");
    vi.stubEnv("LOG_LEVEL", "silent");
    const app = await buildApi({ rateLimitStore: FailingRateLimitStore });
    await app.ready();

    const response = await app.inject({ method: "GET", url: "/v1/session" });
    expect(response.statusCode).toBe(500);

    await app.close();
    vi.unstubAllEnvs();
  });

  it("refuses process-memory rate limiting in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("API_RATE_LIMIT_STORE_DRIVER", "process_memory");

    try {
      await expect(buildApi()).rejects.toThrow("Production requires a distributed API rate-limit store");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("enforces OpenAPI header and path parameter constraints at runtime", async () => {
    const app = await buildApi();
    await app.ready();

    const shortIdempotencyKey = await app.inject({
      method: "POST",
      url: "/v1/age/sessions",
      headers: { "idempotency-key": "short" },
      payload: { providerPreference: "reusable_first" }
    });
    expect(shortIdempotencyKey.statusCode).toBe(400);

    const invalidHandle = await app.inject({
      method: "GET",
      url: "/v1/profiles/handles/!!!/availability"
    });
    expect(invalidHandle.statusCode).toBe(400);

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

  it("treats malformed session-cookie encoding as unauthorized", async () => {
    const app = await buildApi();
    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: "/v1/session",
      headers: { cookie: "wevid_session=%" }
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: "unauthorized" });
    await app.close();
  });

  it("allows browser profile mutations through CORS preflight", async () => {
    const app = await buildApi();
    await app.ready();

    const response = await app.inject({
      method: "OPTIONS",
      url: "/v1/profiles/me",
      headers: {
        origin: "http://localhost:3000",
        "access-control-request-method": "PATCH"
      }
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-methods"]).toContain("PATCH");

    await app.close();
  });

  it("allows browser unfollow mutations through CORS preflight", async () => {
    const app = await buildApi();
    await app.ready();

    const response = await app.inject({
      method: "OPTIONS",
      url: "/v1/follows/00000000-0000-4000-8000-000000000011",
      headers: {
        origin: "http://localhost:3000",
        "access-control-request-method": "DELETE",
        "access-control-request-headers": "authorization,content-type,idempotency-key"
      }
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-methods"]).toContain("DELETE");

    await app.close();
  });

  it("allows local browser profile mutations when WEB_URL points at a tunnel", async () => {
    vi.stubEnv("WEB_URL", "https://web-tunnel.example.test");
    const app = await buildApi();
    await app.ready();

    const response = await app.inject({
      method: "OPTIONS",
      url: "/v1/profiles/me/starter",
      headers: {
        origin: "http://127.0.0.1:3008",
        "access-control-request-method": "POST",
        "access-control-request-headers": "authorization,content-type,idempotency-key,accept"
      }
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe("http://127.0.0.1:3008");
    expect(response.headers["access-control-allow-methods"]).toContain("POST");

    await app.close();
    vi.unstubAllEnvs();
  });

  it("returns a contract-safe session for a verified application session with a WeVid profile", async () => {
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

  it("accepts HttpOnly wallet session cookies for protected API access", async () => {
    const app = await buildApi({
      authVerifier: {
        async verifyToken(token) {
          return token === "veel_wallet_cookie_session"
            ? {
                userId: "00000000-0000-4000-8000-000000000001",
                supabaseUserId: "00000000-0000-4000-8000-000000000001",
                sessionId: "00000000-0000-4000-8000-000000000099",
                authenticatedAt: new Date(),
                authenticationMethod: "wallet" as const
              }
            : null;
        }
      },
      ageRepository: verifiedAgeRepository,
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
        cookie: "wevid_session=veel_wallet_cookie_session"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      authenticated: true,
      appAccessState: {
        allowed: true,
        reason: "ready"
      }
    });

    await app.close();
  });

  it("prefers the HttpOnly application cookie over an Authorization header", async () => {
    const verifiedTokens: string[] = [];
    const app = await buildApi({
      authVerifier: {
        async verifyToken(token) {
          verifiedTokens.push(token);
          return token === "cookie-session"
            ? {
                userId: "00000000-0000-4000-8000-000000000001",
                supabaseUserId: "00000000-0000-4000-8000-000000000001",
                sessionId: "00000000-0000-4000-8000-000000000099",
                authenticatedAt: new Date(),
                authenticationMethod: "wallet" as const
              }
            : null;
        }
      },
      ageRepository: verifiedAgeRepository,
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
        authorization: "Bearer ignored-header-session",
        cookie: "wevid_session=cookie-session"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(verifiedTokens).toEqual(["cookie-session"]);
    await app.close();
  });

  it("keeps repeated current-session reads on read-only repository methods", async () => {
    let profileReads = 0;
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      ageRepository: verifiedAgeRepository,
      walletRepository: walletRepositoryWithWallet,
      sessionRepository: sessionRepositoryWithProfile({
        async onFind() {
          profileReads += 1;
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

    for (let requestNumber = 0; requestNumber < 5; requestNumber += 1) {
      const response = await app.inject({
        method: "GET",
        url: "/v1/session",
        headers: { authorization: "Bearer valid-token" }
      });
      expect(response.statusCode).toBe(200);
    }

    expect(profileReads).toBe(5);
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

  it("creates a short-lived recovery link intent from a recent application session", async () => {
    const intents: unknown[] = [];
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      walletAuthRepository: fakeWalletAuthRepository({
        async createRecoveryLinkIntent(input) {
          intents.push(input);
          return { token: "wevid_recovery_link_test", expiresAt: new Date("2026-06-01T00:10:00.000Z") };
        }
      })
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/recovery/link-intents",
      headers: {
        cookie: "wevid_session=valid-token",
        "idempotency-key": "recovery-link-cookie-1"
      },
      payload: {}
    });

    expect(response.statusCode).toBe(201);
    expect(intents).toMatchObject([{ sessionToken: "valid-token" }]);
    expect(response.headers["set-cookie"]).toContain("HttpOnly");

    await app.close();
  });

  it("rejects recovery link intent without an application session", async () => {
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      walletAuthRepository: fakeWalletAuthRepository()
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/recovery/link-intents",
      headers: {
        "idempotency-key": "recovery-link-missing-wallet"
      },
      payload: {}
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      code: "unauthorized"
    });

    await app.close();
  });

  it("rejects recovery linking when application authentication is stale", async () => {
    let intentCreated = false;
    const app = await buildApi({
      authVerifier: {
        async verifyToken() {
          return {
            userId: "00000000-0000-4000-8000-000000000001",
            supabaseUserId: "00000000-0000-4000-8000-000000000001",
            sessionId: "00000000-0000-4000-8000-000000000099",
            authenticatedAt: new Date(Date.now() - 16 * 60 * 1000),
            authenticationMethod: "wallet" as const
          };
        }
      },
      walletAuthRepository: fakeWalletAuthRepository({
        async createRecoveryLinkIntent() {
          intentCreated = true;
          throw new Error("must not be called");
        }
      })
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/recovery/link-intents",
      headers: {
        cookie: "wevid_session=stale-session",
        "idempotency-key": "recovery-link-stale-session"
      },
      payload: {}
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: "recent_authentication_required" });
    expect(intentCreated).toBe(false);
    await app.close();
  });

  it("rejects recovery exchange when the provider identity belongs to another account", async () => {
    const app = await buildApi({
      recoveryIdentityVerifier: {
        async verifyToken() {
          return { provider: "supabase", providerSubject: "00000000-0000-4000-8000-000000000002", email: "maki@example.test" };
        }
      },
      walletAuthRepository: fakeWalletAuthRepository({
        async exchangeRecoveryIdentity() {
          throw new WalletRecoveryLinkConflictError();
        }
      })
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/recovery/exchange",
      headers: {
        authorization: "Bearer recovery-token",
        cookie: "veel_recovery_link_intent=recovery-intent",
        "idempotency-key": "recovery-link-conflict"
      },
      payload: {}
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      code: "conflict"
    });

    await app.close();
  });

  it("rejects removing the only durable recovery credential", async () => {
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      walletAuthRepository: fakeWalletAuthRepository({
        async unlinkRecoveryIdentity() {
          throw new WalletRecoveryCredentialRequiredError();
        }
      })
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/recovery/unlink",
      headers: {
        cookie: "wevid_session=valid-token",
        "idempotency-key": "recovery-unlink-last-credential"
      },
      payload: {}
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      code: "conflict",
      message: "Link a wallet before removing your only recovery method"
    });

    await app.close();
  });

  it("revokes the HttpOnly wallet session and expires its cookie", async () => {
    const revoked: string[] = [];
    const app = await buildApi({
      walletAuthRepository: fakeWalletAuthRepository({
        async revokeSessionToken(token) {
          revoked.push(token);
        }
      })
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/wallet/logout",
      headers: {
        cookie: "wevid_session=veel_wallet_test_session",
        "idempotency-key": "wallet-logout-1"
      }
    });

    expect(response.statusCode).toBe(204);
    expect(revoked).toEqual(["veel_wallet_test_session"]);
    expect(String(response.headers["set-cookie"])).toContain("wevid_session=");
    expect(String(response.headers["set-cookie"])).toContain("HttpOnly");
    expect(String(response.headers["set-cookie"])).toContain("Max-Age=0");

    await app.close();
  });

  it("requires recent authentication and revokes every application session explicitly", async () => {
    const revocations: Array<{ userId: string; actorUserId: string; reason: string }> = [];
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      walletAuthRepository: fakeWalletAuthRepository({
        async revokeAllSessions(input) {
          revocations.push(input);
          return 2;
        }
      })
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/sessions/logout-all",
      headers: {
        cookie: "wevid_session=valid-token",
        "idempotency-key": "logout-all-1"
      }
    });

    expect(response.statusCode).toBe(204);
    expect(revocations).toEqual([{
      userId: "00000000-0000-4000-8000-000000000001",
      actorUserId: "00000000-0000-4000-8000-000000000001",
      reason: "user_logout_all"
    }]);
    expect(String(response.headers["set-cookie"])).toContain("wevid_session=");
    expect(String(response.headers["set-cookie"])).toContain("Max-Age=0");

    await app.close();
  });

  it("rejects logout-all when authentication is no longer recent", async () => {
    let called = false;
    const app = await buildApi({
      authVerifier: {
        async verifyToken() {
          return {
            ...await fakeAuthVerifier.verifyToken("valid-token") as VerifiedApplicationSession,
            authenticatedAt: new Date(Date.now() - 16 * 60 * 1000)
          };
        }
      },
      walletAuthRepository: fakeWalletAuthRepository({
        async revokeAllSessions() {
          called = true;
          return 0;
        }
      })
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/sessions/logout-all",
      headers: {
        cookie: "wevid_session=valid-token",
        "idempotency-key": "logout-all-stale"
      }
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: "recent_authentication_required" });
    expect(called).toBe(false);
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
        async applyProviderWebhook() {
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

  it("starts a configured Yoti age session through the real provider adapter", async () => {
    vi.stubEnv("AGE_VERIFICATION_DRIVER", "yoti_digital_id");
    vi.stubEnv("YOTI_SDK_ID", "yoti-sdk-id");
    vi.stubEnv("YOTI_API_TOKEN", "yoti-api-token");
    vi.stubEnv("YOTI_API_BASE_URL", "https://age.yoti.example/api/v1");
    vi.stubEnv("YOTI_LAUNCH_BASE_URL", "https://age.yoti.example");
    vi.setSystemTime(new Date("2026-06-03T22:00:00.000Z"));
    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        fetchCalls.push(init ? { url, init } : { url });
        return new Response(JSON.stringify({ session_id: "yoti-session-1" }), {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        });
      })
    );
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
        async applyProviderWebhook() {
          throw new Error("not implemented");
        },
        async updateVerificationFromWebhook() {
          throw new Error("not implemented");
        }
      }
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/v1/age/sessions",
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "age-yoti-test-1"
      },
      payload: {
        providerPreference: "reusable_first"
      }
    });

    expect(response.statusCode, JSON.stringify(response.json())).toBe(201);
    expect(response.json()).toEqual({
      id: "yoti-session-1",
      provider: "yoti",
      launchUrl: "https://age.yoti.example?sessionId=yoti-session-1&sdkId=yoti-sdk-id",
      expiresAt: "2026-06-03T22:15:00.000Z"
    });
    expect(fetchCalls[0]?.url).toBe("https://age.yoti.example/api/v1/sessions");
    expect(fetchCalls[0]?.init?.method).toBe("POST");
    expect(JSON.parse(String(fetchCalls[0]?.init?.body))).toMatchObject({
      reference_id: "age-yoti-test-1",
      notification_url: "http://localhost:4000/v1/webhooks/age/yoti"
    });
    expect(createdPendingVerifications).toMatchObject([
      {
        provider: "yoti",
        providerReference: "yoti-session-1",
        rule: "over_18"
      }
    ]);

    await app.close();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("starts a configured Didit age session through the real provider adapter", async () => {
    vi.stubEnv("DIDIT_API_KEY", "didit-api-key");
    vi.stubEnv("DIDIT_AGE_WORKFLOW_ID", "didit-age-workflow");
    vi.stubEnv("DIDIT_API_BASE_URL", "https://verification.didit.example");
    vi.setSystemTime(new Date("2026-06-03T22:00:00.000Z"));
    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        fetchCalls.push(init ? { url, init } : { url });
        return new Response(
          JSON.stringify({
            session_id: "didit-age-session-1",
            url: "https://verification.didit.example/session/didit-age-session-1"
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json"
            }
          }
        );
      })
    );
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
        async applyProviderWebhook() {
          throw new Error("not implemented");
        },
        async updateVerificationFromWebhook() {
          throw new Error("not implemented");
        }
      }
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/v1/age/sessions",
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "age-didit-test-1"
      },
      payload: {
        providerPreference: "didit"
      }
    });

    expect(response.statusCode, JSON.stringify(response.json())).toBe(201);
    expect(response.json()).toEqual({
      id: "didit-age-session-1",
      provider: "didit",
      launchUrl: "https://verification.didit.example/session/didit-age-session-1",
      expiresAt: "2026-06-04T22:00:00.000Z"
    });
    expect(fetchCalls[0]?.url).toBe("https://verification.didit.example/v3/session/");
    expect(fetchCalls[0]?.init?.method).toBe("POST");
    expect(fetchCalls[0]?.init?.headers).toMatchObject({
      "x-api-key": "didit-api-key"
    });
    expect(JSON.parse(String(fetchCalls[0]?.init?.body))).toMatchObject({
      workflow_id: "didit-age-workflow",
      callback: "http://localhost:3000/age/callback",
      callback_method: "completer",
      vendor_data: "user:00000000-0000-4000-8000-000000000001",
      metadata: {
        purpose: "age_access",
        rule: "over_18"
      }
    });
    expect(createdPendingVerifications).toMatchObject([
      {
        provider: "didit",
        providerReference: "didit-age-session-1",
        rule: "over_18"
      }
    ]);

    await app.close();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("creates Persona and Veriff sessions through the real provider waterfall when explicitly selected", async () => {
    vi.setSystemTime(new Date("2026-06-03T22:00:00.000Z"));
    const personaFetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: {
            id: "persona-inquiry-1",
            attributes: {
              "expires-at": "2026-06-04T22:00:00.000Z"
            }
          },
          meta: {
            "one-time-link": "https://withpersona.example/i/persona-inquiry-1"
          }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", personaFetch);
    vi.stubEnv("AGE_VERIFICATION_DRIVER", "persona");
    vi.stubEnv("PERSONA_API_KEY", "persona-api-key");
    vi.stubEnv("PERSONA_TEMPLATE_ID", "persona-template-id");
    vi.stubEnv("PERSONA_API_BASE_URL", "https://withpersona.example");

    const personaApp = await buildApi({
      authVerifier: fakeAuthVerifier,
      sessionRepository: sessionRepositoryWithProfile({
        async onFind() {
          return null;
        }
      }),
      ageRepository: pendingAgeSessionRepository
    });
    await personaApp.ready();
    const personaResponse = await personaApp.inject({
      method: "POST",
      url: "/v1/age/sessions",
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "age-persona-1"
      },
      payload: {
        providerPreference: "persona"
      }
    });

    expect(personaResponse.statusCode, JSON.stringify(personaResponse.json())).toBe(201);
    expect(personaResponse.json()).toMatchObject({
      id: "persona-inquiry-1",
      provider: "persona",
      launchUrl: "https://withpersona.example/i/persona-inquiry-1"
    });
    await personaApp.close();
    vi.unstubAllEnvs();

    const veriffFetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          verification: {
            id: "veriff-session-1",
            url: "https://station.veriff.example/v/veriff-session-1"
          }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", veriffFetch);
    vi.stubEnv("AGE_VERIFICATION_DRIVER", "veriff");
    vi.stubEnv("VERIFF_API_KEY", "veriff-api-key");
    vi.stubEnv("VERIFF_API_BASE_URL", "https://stationapi.veriff.example");

    const veriffApp = await buildApi({
      authVerifier: fakeAuthVerifier,
      sessionRepository: sessionRepositoryWithProfile({
        async onFind() {
          return null;
        }
      }),
      ageRepository: pendingAgeSessionRepository
    });
    await veriffApp.ready();
    const veriffResponse = await veriffApp.inject({
      method: "POST",
      url: "/v1/age/sessions",
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "age-veriff-1"
      },
      payload: {
        providerPreference: "veriff"
      }
    });

    expect(veriffResponse.statusCode, JSON.stringify(veriffResponse.json())).toBe(201);
    expect(veriffResponse.json()).toMatchObject({
      id: "veriff-session-1",
      provider: "veriff",
      launchUrl: "https://station.veriff.example/v/veriff-session-1"
    });

    await veriffApp.close();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("accepts a signed Sumsub age webhook and applies normalized verification state", async () => {
    vi.stubEnv("SUMSUB_WEBHOOK_SECRET", "sumsub-test-secret");
    const recordedEvents: unknown[] = [];
    const appliedEvents: unknown[] = [];
    const ageRepository: AgeRepository = {
      ...requiredAgeRepository,
      async applyProviderWebhook(input) {
        recordedEvents.push(input);
        appliedEvents.push(input);
        return "applied";
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
        state: "verified"
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

  it("routes a signed Didit age workflow event through the shared verification webhook", async () => {
    vi.stubEnv("DIDIT_WEBHOOK_SECRET", "didit-webhook-secret");
    const appliedEvents: unknown[] = [];
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      verificationRepository: {
        ...verificationRepositoryStub(),
        async applyProviderWebhook(input) {
          appliedEvents.push(input);
          return "applied";
        }
      }
    });
    await app.ready();
    const payload = {
      event_id: "didit-age-event-1",
      webhook_type: "status.updated",
      session_id: "didit-age-session-1",
      status: "Approved",
      timestamp: Math.floor(Date.now() / 1000)
    };
    const rawPayload = JSON.stringify(payload);

    const response = await app.inject({
      method: "POST",
      url: "/v1/webhooks/verification/didit",
      headers: {
        "content-type": "application/json",
        "x-signature-v2": diditV2Signature(payload),
        "x-timestamp": String(payload.timestamp)
      },
      payload: rawPayload
    });

    expect(response.statusCode, JSON.stringify(response.json())).toBe(202);
    expect(appliedEvents).toMatchObject([
      {
        provider: "didit",
        providerEventId: "didit-age-event-1",
        providerReference: "didit-age-session-1",
        eventType: "status.updated",
        status: "valid"
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
      async applyProviderWebhook() {
        return "duplicate";
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

  it("starts and completes a local mock age session only when mock providers are enabled", async () => {
    vi.stubEnv("AGE_VERIFICATION_ALLOW_MOCK_PROVIDER", "true");
    vi.setSystemTime(new Date("2026-06-03T22:00:00.000Z"));
    const createdPendingVerifications: CreatePendingAgeVerificationInput[] = [];
    const appliedEvents: unknown[] = [];
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
        async applyProviderWebhook() {
          throw new Error("not implemented");
        },
        async updateVerificationFromWebhook(input) {
          appliedEvents.push(input);
          return true;
        }
      }
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/v1/age/sessions",
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "mock-age-test-1"
      },
      payload: {
        providerPreference: "reusable_first"
      }
    });

    expect(response.statusCode, JSON.stringify(response.json())).toBe(201);
    expect(response.json()).toMatchObject({
      provider: "didit",
      expiresAt: "2026-06-03T22:15:00.000Z"
    });
    expect(response.json().id).toContain("mock-verification:age_access:");
    expect(createdPendingVerifications).toMatchObject([
      {
        provider: "didit",
        providerReference: expect.stringContaining("mock-verification:age_access:"),
        rule: "over_18"
      }
    ]);
    expect(appliedEvents).toMatchObject([
      {
        provider: "didit",
        providerReference: expect.stringContaining("mock-verification:age_access:"),
        state: "verified"
      }
    ]);

    await app.close();
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("does not enable mock age providers in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("API_RATE_LIMIT_STORE_DRIVER", "external");
    vi.stubEnv("AGE_VERIFICATION_ALLOW_MOCK_PROVIDER", "true");
    const app = await buildApi({
      rateLimitStore: TestRateLimitStore,
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
        "idempotency-key": "mock-age-prod"
      },
      payload: {
        providerPreference: "reusable_first"
      }
    });

    expect(response.statusCode).toBe(503);

    await app.close();
    vi.unstubAllEnvs();
  });

  it("starts a creator KYC verification session through the provider waterfall", async () => {
    vi.setSystemTime(new Date("2026-06-03T22:00:00.000Z"));
    const createdSessions: unknown[] = [];
    const providerSession: VerificationProviderSession = {
      provider: "sumsub",
      providerReference: "user:00000000-0000-4000-8000-000000000001",
      providerApplicantId: "sumsub-applicant-1",
      launchUrl: "https://sumsub.example/sdk?token=token-1",
      expiresAt: new Date("2026-06-03T22:10:00.000Z"),
      method: "gov_id_selfie",
      assuranceLevel: "documentary"
    };
    const verificationProviderWaterfall: VerificationProviderWaterfall = {
      async createSession(input) {
        expect(input).toMatchObject({
          supabaseUserId: "00000000-0000-4000-8000-000000000001",
          purpose: "creator_kyc",
          providerPreference: "provider_first",
          idempotencyKey: "creator-kyc-1"
        });
        return providerSession;
      }
    };
    const verificationRepository: VerificationRepository = {
      ...verificationRepositoryStub(),
      async createPendingSession(input) {
        createdSessions.push(input);
        return "11111111-1111-4111-8111-111111111111";
      }
    };
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      verificationProviderWaterfall,
      verificationRepository
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/v1/verification/sessions",
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "creator-kyc-1"
      },
      payload: {
        purpose: "creator_kyc"
      }
    });

    expect(response.statusCode, JSON.stringify(response.json())).toBe(201);
    expect(response.json()).toEqual({
      id: "11111111-1111-4111-8111-111111111111",
      provider: "sumsub",
      providerReference: "user:00000000-0000-4000-8000-000000000001",
      launchUrl: "https://sumsub.example/sdk?token=token-1",
      expiresAt: "2026-06-03T22:10:00.000Z",
      purpose: "creator_kyc"
    });
    expect(createdSessions).toMatchObject([
      {
        supabaseUserId: "00000000-0000-4000-8000-000000000001",
        purpose: "creator_kyc",
        providerSession
      }
    ]);

    await app.close();
    vi.useRealTimers();
  });

  it("starts and completes local mock creator KYC when mock providers are enabled", async () => {
    vi.stubEnv("AGE_VERIFICATION_ALLOW_MOCK_PROVIDER", "true");
    vi.setSystemTime(new Date("2026-06-03T22:00:00.000Z"));
    const createdSessions: unknown[] = [];
    const appliedEvents: unknown[] = [];
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      verificationRepository: {
        ...verificationRepositoryStub(),
        async createPendingSession(input) {
          createdSessions.push(input);
          return "11111111-1111-4111-8111-111111111113";
        },
        async updateVerificationFromWebhook(input) {
          appliedEvents.push(input);
          return true;
        }
      }
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/v1/verification/sessions",
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "mock-creator-kyc-1"
      },
      payload: {
        purpose: "creator_kyc"
      }
    });

    expect(response.statusCode, JSON.stringify(response.json())).toBe(201);
    expect(response.json()).toMatchObject({
      id: "11111111-1111-4111-8111-111111111113",
      provider: "didit",
      expiresAt: "2026-06-03T22:15:00.000Z",
      purpose: "creator_kyc"
    });
    expect(response.json().providerReference).toContain("mock-verification:creator_kyc");
    expect(createdSessions).toMatchObject([
      {
        purpose: "creator_kyc",
        providerSession: {
          provider: "didit",
          providerReference: expect.stringContaining("mock-verification:creator_kyc"),
          method: "gov_id_selfie",
          assuranceLevel: "documentary",
          reusable: true
        }
      }
    ]);
    expect(appliedEvents).toMatchObject([
      {
        provider: "didit",
        providerReference: expect.stringContaining("mock-verification:creator_kyc"),
        eventType: "mock.auto_approved",
        status: "valid"
      }
    ]);

    await app.close();
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("requires explicit adult publisher terms in the contextual create workflow", async () => {
    vi.stubEnv("AGE_VERIFICATION_ALLOW_MOCK_PROVIDER", "true");
    const app = await buildApi({ authVerifier: fakeAuthVerifier });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/v1/verification/sessions",
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "adult-without-terms"
      },
      payload: {
        purpose: "adult_publisher_eligibility",
        source: "create"
      }
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ code: "validation_failed" });
    await app.close();
    vi.unstubAllEnvs();
  });

  it("starts one adult publisher identity flow from the contextual create workflow", async () => {
    vi.stubEnv("AGE_VERIFICATION_ALLOW_MOCK_PROVIDER", "true");
    const createdSessions: unknown[] = [];
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      verificationRepository: {
        ...verificationRepositoryStub(),
        async createPendingSession(input) {
          createdSessions.push(input);
          return "11111111-1111-4111-8111-111111111115";
        }
      }
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/v1/verification/sessions",
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "adult-create-1"
      },
      payload: {
        purpose: "adult_publisher_eligibility",
        source: "create",
        adultPublisherTermsAccepted: true
      }
    });

    expect(response.statusCode, JSON.stringify(response.json())).toBe(201);
    expect(response.json()).toMatchObject({
      purpose: "adult_publisher_eligibility",
      provider: "didit"
    });
    expect(response.json().launchUrl).toContain("/app/create?verification=return");
    expect(createdSessions).toMatchObject([
      {
        purpose: "adult_publisher_eligibility",
        policyVersion: "adult-publisher-2026-08-v1",
        termsAcceptedAt: expect.any(Date)
      }
    ]);

    await app.close();
    vi.unstubAllEnvs();
  });

  it("starts and completes local mock organization KYB when mock providers are enabled", async () => {
    vi.stubEnv("AGE_VERIFICATION_ALLOW_MOCK_PROVIDER", "true");
    vi.setSystemTime(new Date("2026-06-03T22:00:00.000Z"));
    const createdSessions: unknown[] = [];
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      verificationRepository: {
        ...verificationRepositoryStub(),
        async createPendingSession(input) {
          createdSessions.push(input);
          return "11111111-1111-4111-8111-111111111114";
        }
      }
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/v1/verification/sessions",
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "mock-org-kyb-1"
      },
      payload: {
        purpose: "org_kyb",
        organizationId: "22222222-2222-4222-8222-222222222222"
      }
    });

    expect(response.statusCode, JSON.stringify(response.json())).toBe(201);
    expect(response.json()).toMatchObject({
      id: "11111111-1111-4111-8111-111111111114",
      provider: "didit",
      expiresAt: "2026-06-03T22:15:00.000Z",
      purpose: "org_kyb"
    });
    expect(response.json().providerReference).toContain("mock-verification:org_kyb");
    expect(createdSessions).toMatchObject([
      {
        purpose: "org_kyb",
        organizationId: "22222222-2222-4222-8222-222222222222",
        providerSession: {
          method: "kyb_registry",
          assuranceLevel: "business_verified"
        }
      }
    ]);

    await app.close();
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("starts Didit creator KYC with the current provider session API shape", async () => {
    vi.stubEnv("DIDIT_API_KEY", "didit-api-key");
    vi.stubEnv("DIDIT_KYC_WORKFLOW_ID", "didit-creator-workflow");
    vi.stubEnv("DIDIT_API_BASE_URL", "https://verification.didit.example");
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(
        JSON.stringify({
          session_id: "didit-session-1",
          url: "https://verification.didit.example/session/didit-session-1"
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);
    const createdSessions: unknown[] = [];
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      verificationRepository: {
        ...verificationRepositoryStub(),
        async createPendingSession(input) {
          createdSessions.push(input);
          return "11111111-1111-4111-8111-111111111112";
        }
      }
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/v1/verification/sessions",
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "didit-creator-1"
      },
      payload: {
        purpose: "creator_kyc",
        providerPreference: "didit"
      }
    });

    expect(response.statusCode, JSON.stringify(response.json())).toBe(201);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://verification.didit.example/v3/session/",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "x-api-key": "didit-api-key"
        })
      })
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      workflow_id: "didit-creator-workflow",
      callback: "http://localhost:3000/app/profile?verification=earnings",
      callback_method: "completer",
      vendor_data: "user:00000000-0000-4000-8000-000000000001",
      metadata: { purpose: "creator_kyc" }
    });
    expect(createdSessions).toMatchObject([
      {
        purpose: "creator_kyc",
        providerSession: {
          provider: "didit",
          providerReference: "didit-session-1",
          reusable: false
        }
      }
    ]);

    await app.close();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("starts Persona organization KYB with the organization template", async () => {
    vi.stubEnv("PERSONA_API_KEY", "persona-api-key");
    vi.stubEnv("PERSONA_ORG_KYB_TEMPLATE_ID", "persona-org-kyb-template");
    vi.stubEnv("PERSONA_API_BASE_URL", "https://withpersona.example");
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(
        JSON.stringify({
          data: {
            id: "persona-org-inquiry-1",
            attributes: {
              "expires-at": "2026-06-04T22:00:00.000Z"
            }
          },
          meta: {
            "one-time-link": "https://withpersona.example/i/persona-org-inquiry-1"
          }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);
    const createdSessions: unknown[] = [];
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      verificationRepository: {
        ...verificationRepositoryStub(),
        async createPendingSession(input) {
          createdSessions.push(input);
          return "11111111-1111-4111-8111-111111111113";
        }
      }
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/v1/verification/sessions",
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "persona-org-kyb-1"
      },
      payload: {
        purpose: "org_kyb",
        providerPreference: "persona",
        organizationId: "00000000-0000-4000-8000-000000000090"
      }
    });

    expect(response.statusCode, JSON.stringify(response.json())).toBe(201);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      data: {
        attributes: {
          "inquiry-template-id": "persona-org-kyb-template",
          "reference-id": "org:00000000-0000-4000-8000-000000000090",
          note: "WeVid organization KYB"
        }
      },
      meta: {
        "redirect-uri": "http://localhost:3000/app/profile?verification=organization"
      }
    });
    expect(createdSessions).toMatchObject([
      {
        purpose: "org_kyb",
        organizationId: "00000000-0000-4000-8000-000000000090",
        providerSession: {
          provider: "persona",
          method: "kyb_registry",
          assuranceLevel: "business_verified"
        }
      }
    ]);

    await app.close();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("accepts a signed Sumsub creator verification webhook and applies normalized state", async () => {
    vi.stubEnv("SUMSUB_WEBHOOK_SECRET", "sumsub-test-secret");
    const recordedEvents: unknown[] = [];
    const appliedEvents: unknown[] = [];
    const verificationRepository: VerificationRepository = {
      ...verificationRepositoryStub(),
      async applyProviderWebhook(input) {
        recordedEvents.push(input);
        appliedEvents.push(input);
        return "applied";
      }
    };
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      verificationRepository
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
      url: "/v1/webhooks/verification/sumsub",
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
        eventType: "applicantReviewed"
      }
    ]);
    expect(appliedEvents).toMatchObject([
      {
        provider: "sumsub",
        providerEventId: "sumsub-event",
        providerReference: "sumsub-applicant",
        status: "valid"
      }
    ]);

    await app.close();
    vi.unstubAllEnvs();
  });

  it("accepts a Didit verification webhook signed with X-Signature-V2", async () => {
    vi.stubEnv("DIDIT_WEBHOOK_SECRET", "didit-webhook-secret");
    const appliedEvents: unknown[] = [];
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      verificationRepository: {
        ...verificationRepositoryStub(),
        async applyProviderWebhook(input) {
          appliedEvents.push(input);
          return "applied";
        }
      }
    });
    await app.ready();
    const payload = {
      event_id: "didit-event-1",
      webhook_type: "status.updated",
      session_id: "didit-session-1",
      status: "Approved",
      timestamp: Math.floor(Date.now() / 1000)
    };
    const rawPayload = JSON.stringify(payload);

    const response = await app.inject({
      method: "POST",
      url: "/v1/webhooks/verification/didit",
      headers: {
        "content-type": "application/json",
        "x-signature-v2": diditV2Signature(payload),
        "x-timestamp": String(payload.timestamp)
      },
      payload: rawPayload
    });

    expect(response.statusCode, JSON.stringify(response.json())).toBe(202);
    expect(appliedEvents).toMatchObject([
      {
        provider: "didit",
        providerReference: "didit-session-1",
        eventType: "status.updated",
        status: "valid"
      }
    ]);

    await app.close();
    vi.unstubAllEnvs();
  });

  it("rejects a correctly signed but stale Didit webhook", async () => {
    vi.stubEnv("DIDIT_WEBHOOK_SECRET", "didit-webhook-secret");
    const app = await buildApi({ authVerifier: fakeAuthVerifier });
    await app.ready();
    const staleTimestamp = Math.floor(Date.now() / 1000) - 301;
    const payload = {
      event_id: "didit-stale-event",
      webhook_type: "status.updated",
      session_id: "didit-session-1",
      status: "Approved",
      timestamp: staleTimestamp
    };

    const response = await app.inject({
      method: "POST",
      url: "/v1/webhooks/verification/didit",
      headers: {
        "content-type": "application/json",
        "x-signature-v2": diditV2Signature(payload),
        "x-timestamp": String(staleTimestamp)
      },
      payload: JSON.stringify(payload)
    });

    expect(response.statusCode).toBe(401);
    await app.close();
    vi.unstubAllEnvs();
  });

  it("accepts a Persona webhook signed with Persona-Signature", async () => {
    vi.stubEnv("PERSONA_WEBHOOK_SECRET", "persona-webhook-secret");
    const appliedEvents: unknown[] = [];
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      verificationRepository: {
        ...verificationRepositoryStub(),
        async applyProviderWebhook(input) {
          appliedEvents.push(input);
          return "applied";
        }
      }
    });
    await app.ready();
    const payload = {
      data: {
        id: "evt-persona-1",
        type: "event",
        attributes: {
          name: "inquiry.approved",
          payload: {
            data: {
              id: "inq-persona-1",
              type: "inquiry",
              attributes: {
                status: "approved",
                "completed-at": "2026-06-06T01:00:00Z"
              }
            }
          }
        }
      }
    };
    const rawPayload = JSON.stringify(payload);
    const timestamp = "1780707600";

    const response = await app.inject({
      method: "POST",
      url: "/v1/webhooks/verification/persona",
      headers: {
        "content-type": "application/json",
        "persona-signature": personaSignature(timestamp, rawPayload)
      },
      payload: rawPayload
    });

    expect(response.statusCode, JSON.stringify(response.json())).toBe(202);
    expect(appliedEvents).toMatchObject([
      {
        provider: "persona",
        providerEventId: "evt-persona-1",
        providerReference: "inq-persona-1",
        eventType: "inquiry.approved",
        status: "valid"
      }
    ]);

    await app.close();
    vi.unstubAllEnvs();
  });

  it("updates the current profile without read-time user bootstrapping", async () => {
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
        avatarUrl: "https://media.example.test/avatar.jpg",
        links: [{ label: "Website", url: "https://veel.example.test/maki" }],
        bio: "Building Veel v2"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(ensuredSupabaseUserIds).toEqual([]);
    expect(response.json()).toEqual({
      id: "00000000-0000-4000-8000-000000000010",
      handle: "maki",
      displayName: "Maki",
      avatarUrl: "https://media.example.test/avatar.jpg",
      badges: []
    });

    await app.close();
  });

  it("does not expose a starter-profile shortcut", async () => {
    const upserts: unknown[] = [];
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      sessionRepository: sessionRepositoryWithProfile({
        async onFind() {
          return null;
        }
      }),
      profileRepository: {
        ...fakeProfileRepository,
        async upsertMyProfile(supabaseUserId, input) {
          upserts.push({ supabaseUserId, input });
          return {
            id: "00000000-0000-4000-8000-000000000010",
            handle: input.handle,
            displayName: input.displayName ?? input.handle,
            avatarUrl: null,
            badges: []
          };
        }
      }
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/v1/profiles/me/starter",
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "profile-starter-1"
      },
      payload: {}
    });

    expect(response.statusCode).toBe(404);
    expect(upserts).toEqual([]);

    await app.close();
  });

  it("rejects profile avatar uploads above 5 MB", async () => {
    const app = await buildApi({
      authVerifier: fakeAuthVerifier
    });
    await app.ready();

    const overLimitBase64 = "A".repeat(Math.ceil(((5_000_000 + 10) * 4) / 3));
    const response = await app.inject({
      method: "POST",
      url: "/v1/profiles/me/avatar",
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "profile-avatar-limit-1"
      },
      payload: {
        contentType: "image/png",
        dataBase64: overLimitBase64,
        fileName: "avatar.png"
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      code: "validation_failed"
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
        supportEnabled: true,
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
        readinessScore: 80,
        canMonetize: false,
        nextAction: "/wallet",
        policyBoundary: "creator_records_only_no_balances_payout_queue_or_social_priority",
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
      readinessScore: 60,
      nextAction: "/wallet",
      policyBoundary: "creator_records_only_no_balances_payout_queue_or_social_priority",
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
    expect(response.body).not.toMatch(/creatorBalance|withdrawalRequest|payoutQueue|escrowAccount|privateKey|secret/i);

    await app.close();
  });

  it("updates the canonical creator earnings boundary with one idempotent request", async () => {
    let updateCalled = false;
    const profileRepository: ProfileRepository = {
      ...fakeProfileRepository,
      async updateMyCreatorOnboarding(input) {
        expect(input).toMatchObject({
          supabaseUserId: "00000000-0000-4000-8000-000000000001",
          idempotencyKey: "earnings-setup-1",
          expectedWalletChain: "solana_devnet",
          request: {
            recipientWalletId: "00000000-0000-4000-8000-000000000070",
            earningsTermsVersion: "wevid-creator-earnings-v1",
            earningsTermsAccepted: true,
            products: {
              support: true,
              contentUnlocks: true,
              eventAccessAndLive: true,
              paidMessages: false,
              memberships: true
            }
          }
        });
        expect(input.requestHash).toMatch(/^[a-f0-9]{64}$/);
        updateCalled = true;
        return {
          state: "ready",
          canStartEarning: true,
          readinessScore: 100,
          nextAction: null,
          policyBoundary: "creator_records_only_no_balances_payout_queue_or_social_priority",
          configuration: {
            recipientWalletId: "00000000-0000-4000-8000-000000000070",
            earningsTermsVersion: "wevid-creator-earnings-v1",
            products: {
              support: true,
              contentUnlocks: true,
              eventAccessAndLive: true,
              paidMessages: false,
              memberships: true
            }
          },
          steps: []
        };
      }
    };
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      sessionRepository: appReadySessionRepository,
      profileRepository
    });
    await app.ready();

    const response = await app.inject({
      method: "PATCH",
      url: "/v1/profiles/me/creator-onboarding",
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "earnings-setup-1"
      },
      payload: {
        recipientWalletId: "00000000-0000-4000-8000-000000000070",
        earningsTermsVersion: "wevid-creator-earnings-v1",
        earningsTermsAccepted: true,
        products: {
          support: true,
          contentUnlocks: true,
          eventAccessAndLive: true,
          paidMessages: false,
          memberships: true
        }
      }
    });

    expect(response.statusCode).toBe(200);
    expect(updateCalled).toBe(true);
    expect(response.json()).toMatchObject({ state: "ready", canStartEarning: true });

    updateCalled = false;
    const rejectedTerms = await app.inject({
      method: "PATCH",
      url: "/v1/profiles/me/creator-onboarding",
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "earnings-setup-rejected-terms"
      },
      payload: {
        recipientWalletId: "00000000-0000-4000-8000-000000000070",
        earningsTermsVersion: "wevid-creator-earnings-v1",
        earningsTermsAccepted: false,
        products: {
          support: true,
          contentUnlocks: true,
          eventAccessAndLive: true,
          paidMessages: false,
          memberships: true
        }
      }
    });
    expect(rejectedTerms.statusCode).toBe(400);
    expect(updateCalled).toBe(false);
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
          walletId: "00000000-0000-4000-8000-000000000020",
          sessionToken: "valid-token"
        });

        return {
          wallet: {
            id: input.walletId,
            chain: "solana_devnet",
            address: "VeelWallet111111111111111111111111111111111",
            provider: "embedded_privy",
            isPrimary: true
          },
          session: {
            accessToken: "wevid_session_rotated",
            expiresAt: new Date(Date.now() + 60_000)
          }
        };
      }
    };
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      walletAuthRepository: rotatingWalletAuthRepository(),
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
        return {
          wallet: linkedWallet,
          session: {
            accessToken: "wevid_session_rotated",
            expiresAt: new Date(Date.now() + 60_000)
          }
        };
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
      walletAuthRepository: rotatingWalletAuthRepository(),
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
        return {
          id: "00000000-0000-4000-8000-000000000040",
          mediaType: "vod",
          caption: "studio cut",
          nsfwLabel: "none"
        };
      },
      async listHomeFeed(input) {
        expect(input).toEqual({
          supabaseUserId: "00000000-0000-4000-8000-000000000001",
          mode: "recommended",
          surface: "home",
          limit: 20
        });

        return {
          items: [homeFeedItem],
          nextCursor: null,
          mode: "recommended",
          surface: "home",
          rankingVersion: "deterministic_v1",
          generatedAt: "2026-06-05T12:00:00.000Z"
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
      verificationRepository: creatorVerifiedVerificationRepository(),
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
      nextCursor: null,
      mode: "recommended",
      surface: "home",
      rankingVersion: "deterministic_v1",
      generatedAt: "2026-06-05T12:00:00.000Z"
    });

    await app.close();
  });

  it("requires a first-page refresh when mutable feed ranking inputs changed", async () => {
    const contentRepository: ContentRepository = {
      async createDraft() { throw new Error("not implemented"); },
      async createMediaAsset() { throw new Error("not implemented"); },
      async findContentDetail() { throw new Error("not implemented"); },
      async findContentUnlockOffer() { throw new Error("not implemented"); },
      async findOwnedContentForUpload() { throw new Error("not implemented"); },
      async listHomeFeed() { throw new StaleFeedCursorError(); }
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
      verificationRepository: creatorVerifiedVerificationRepository(),
      walletRepository: walletRepositoryWithWallet,
      contentRepository
    });
    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: "/v1/content/feed?cursor=opaque-cursor",
      headers: { authorization: "Bearer valid-token" }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      code: "feed_cursor_stale",
      message: "Feed ranking changed; restart from the first page"
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
        return {
          id: "00000000-0000-4000-8000-000000000040",
          mediaType: "vod",
          caption: "studio cut",
          nsfwLabel: "none"
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
      verificationRepository: creatorVerifiedVerificationRepository(),
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
      verificationRepository: creatorVerifiedVerificationRepository(),
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

  it("attaches public-media accounting and blocks signed playback when allowance is exhausted", async () => {
    const publicVod: ContentItem = {
      ...homeFeedItem,
      creator: {
        ...homeFeedItem.creator,
        id: "00000000-0000-4000-8000-000000000011"
      },
      mediaType: "vod",
      accessState: "free",
      playback: {
        state: "full",
        url: "https://vz-example.b-cdn.net/11111111-1111-4111-8111-111111111111/playlist.m3u8",
        provider: "bunny"
      }
    };
    const contentRepository = contentRepositoryWithDetail(publicVod);
    const mediaUploadProvider: MediaUploadProviderAdapter = {
      provider: "bunny",
      isConfigured: () => true,
      async createUploadSession() {
        throw new Error("not implemented");
      },
      createPlaybackResource() {
        return {
          state: "full",
          url: "https://iframe.mediadelivery.net/embed/123/11111111-1111-4111-8111-111111111111?token=signed&expires=1770000900",
          provider: "bunny",
          resourceType: "embed"
        };
      }
    };
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      sessionRepository: appReadySessionRepository,
      ageRepository: verifiedAgeRepository,
      walletRepository: walletRepositoryWithWallet,
      contentRepository,
      mediaUploadProvider,
      subscriptionRepository: fakeSubscriptionRepository({
        async onGetPlatformPlaybackDecision() {
          return { countsTowardAllowance: true, limitReached: false };
        }
      })
    });
    await app.ready();

    const accounted = await app.inject({
      method: "GET",
      url: "/v1/content/00000000-0000-4000-8000-000000000040",
      headers: { authorization: "Bearer valid-token" }
    });
    expect(accounted.statusCode).toBe(200);
    expect(accounted.json().playback.usage).toEqual({
      policy: "public_media_allowance",
      targetType: "content",
      targetId: publicVod.id,
      heartbeatIntervalSeconds: 15
    });

    await app.close();

    const exhaustedApp = await buildApi({
      authVerifier: fakeAuthVerifier,
      sessionRepository: appReadySessionRepository,
      ageRepository: verifiedAgeRepository,
      walletRepository: walletRepositoryWithWallet,
      contentRepository,
      mediaUploadProvider,
      subscriptionRepository: fakeSubscriptionRepository({
        async onGetPlatformPlaybackDecision() {
          return { countsTowardAllowance: true, limitReached: true };
        }
      })
    });
    await exhaustedApp.ready();
    const exhausted = await exhaustedApp.inject({
      method: "GET",
      url: "/v1/content/00000000-0000-4000-8000-000000000040",
      headers: { authorization: "Bearer valid-token" }
    });
    expect(exhausted.json().playback).toMatchObject({
      state: "blocked",
      url: null,
      blockReason: "allowance_exhausted"
    });
    await exhaustedApp.close();
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
      verificationRepository: creatorVerifiedVerificationRepository(),
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
      verificationRepository: creatorVerifiedVerificationRepository(),
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
      verificationRepository: creatorVerifiedVerificationRepository(),
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
      liveRooms: [{ title: "Live room", accessState: "event_access_required" }],
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
        expect(input).toMatchObject({
          supabaseUserId: "00000000-0000-4000-8000-000000000001",
          idempotencyKey: "content-draft-1",
          mediaType: "vod",
          caption: "studio cut",
          visibility: "private",
          nsfwLabel: "none",
          representationMode: "self_only",
          contentSafetyPolicyAccepted: true,
          dailyDraftQuota: 20
        });
        expect(input.requestHash).toMatch(/^[a-f0-9]{64}$/);
        expect(input.quotaWindowStart).toBeInstanceOf(Date);

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
      verificationRepository: creatorVerifiedVerificationRepository(),
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
        nsfwLabel: "none",
        representationMode: "self_only",
        contentSafetyPolicyAccepted: true
      }
    });

    expect(response.statusCode, JSON.stringify(response.json())).toBe(201);
    expect(response.json()).toEqual(homeFeedItem);

    await app.close();
  });

  it("blocks content draft creation when the daily server quota is reached", async () => {
    const contentRepository: ContentRepository = {
      async createDraft(input) {
        expect(input).toMatchObject({
          idempotencyKey: "content-draft-quota-1",
          dailyDraftQuota: 20
        });
        expect(input.quotaWindowStart).toBeInstanceOf(Date);
        throw new ContentDraftQuotaExceededError();
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
      verificationRepository: creatorVerifiedVerificationRepository(),
      contentRepository
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/v1/content",
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "content-draft-quota-1"
      },
      payload: {
        mediaType: "vod",
        caption: "studio cut",
        visibility: "private",
        nsfwLabel: "none",
        representationMode: "self_only",
        contentSafetyPolicyAccepted: true
      }
    });

    expect(response.statusCode).toBe(429);
    expect(response.json()).toMatchObject({
      code: "rate_limited",
      message: "Daily content draft quota has been reached"
    });

    await app.close();
  });

  it("uses the active admin content abuse policy for draft quota enforcement", async () => {
    const contentRepository: ContentRepository = {
      async createDraft(input) {
        expect(input).toMatchObject({
          idempotencyKey: "content-draft-policy-1",
          dailyDraftQuota: 2
        });
        expect(input.quotaWindowStart).toBeInstanceOf(Date);
        throw new ContentDraftQuotaExceededError();
      },
      async createMediaAsset() {
        throw new Error("not implemented");
      },
      async getContentCreationAbusePolicy() {
        return {
          dailyContentDraftQuota: 2,
          dailyMediaUploadQuota: 30,
          rollingWindowHours: 12
        };
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
      verificationRepository: creatorVerifiedVerificationRepository(),
      contentRepository
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/v1/content",
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "content-draft-policy-1"
      },
      payload: {
        mediaType: "vod",
        caption: "studio cut",
        visibility: "private",
        nsfwLabel: "none",
        representationMode: "self_only",
        contentSafetyPolicyAccepted: true
      }
    });

    expect(response.statusCode).toBe(429);
    expect(response.json()).toMatchObject({
      code: "rate_limited",
      message: "Daily content draft quota has been reached"
    });

    await app.close();
  });

  it("updates owned content metadata and preview controls without publishing", async () => {
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
      async updateOwnedContent(input) {
        expect(input).toEqual({
          supabaseUserId: "00000000-0000-4000-8000-000000000001",
          contentId: "00000000-0000-4000-8000-000000000040",
          idempotencyKey: "content-update-1",
          caption: "updated #studio",
          captionProvided: true,
          visibility: "followers",
          nsfwLabel: "adult",
          representationMode: "self_only",
          contentSafetyPolicyAccepted: true,
          teaserStartMs: 1000,
          teaserStartMsProvided: true,
          teaserEndMs: 5000,
          teaserEndMsProvided: true,
          thumbnailFrameMs: 1200,
          thumbnailFrameMsProvided: true,
          eventDraft: undefined,
          eventDraftProvided: false
        });

        return {
          ...homeFeedItem,
          caption: "updated #studio",
          nsfwLabel: "adult"
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
      verificationRepository: creatorVerifiedVerificationRepository(),
      contentRepository
    });
    await app.ready();

    const response = await app.inject({
      method: "PATCH",
      url: "/v1/content/00000000-0000-4000-8000-000000000040",
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "content-update-1"
      },
      payload: {
        caption: "updated #studio",
        visibility: "followers",
        nsfwLabel: "adult",
        representationMode: "self_only",
        contentSafetyPolicyAccepted: true,
        teaserStartMs: 1000,
        teaserEndMs: 5000,
        thumbnailFrameMs: 1200
      }
    });

    expect(response.statusCode, JSON.stringify(response.json())).toBe(200);
    expect(response.json()).toMatchObject({
      id: "00000000-0000-4000-8000-000000000040",
      caption: "updated #studio",
      nsfwLabel: "adult"
    });

    await app.close();
  });

  it("rechecks adult-publisher capability before a representation-only edit in any editable state", async () => {
    const updateOwnedContent = vi.fn();
    const contentRepository: ContentRepository = {
      ...contentRepositoryWithDetail(homeFeedItem),
      async findOwnedContentForUpdate(input) {
        expect(input).toEqual({
          supabaseUserId: "00000000-0000-4000-8000-000000000001",
          contentId: "00000000-0000-4000-8000-000000000040"
        });
        return {
          id: input.contentId,
          mediaType: "vod",
          caption: "Published adult item",
          nsfwLabel: "adult"
        };
      },
      updateOwnedContent
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
      verificationRepository: verificationRepositoryStub(),
      contentRepository
    });
    await app.ready();

    const response = await app.inject({
      method: "PATCH",
      url: "/v1/content/00000000-0000-4000-8000-000000000040",
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "adult-representation-update-1"
      },
      payload: {
        representationMode: "self_only",
        contentSafetyPolicyAccepted: true
      }
    });

    expect(response.statusCode).toBe(403);
    expect(updateOwnedContent).not.toHaveBeenCalled();
    await app.close();
  });

  it("lists owner-visible publication states without exposing provider details", async () => {
    const contentRepository: ContentRepository = {
      ...contentRepositoryWithDetail(homeFeedItem),
      async listOwnedContent(input) {
        expect(input).toEqual({
          supabaseUserId: "00000000-0000-4000-8000-000000000001",
          limit: 24
        });
        return {
          items: [{
            id: "00000000-0000-4000-8000-000000000040",
            mediaType: "vod",
            caption: "studio cut",
            posterUrl: null,
            visibility: "public",
            publicationState: "in_review",
            reviewState: "review_required",
            reviewMessage: null,
            createdAt: "2026-08-15T12:00:00.000Z",
            updatedAt: "2026-08-15T12:01:00.000Z"
          }],
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
      url: "/v1/content/mine",
      headers: { authorization: "Bearer valid-token" }
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      items: [{ publicationState: "in_review", reviewState: "review_required" }]
    });
    expect(response.body).not.toContain("provider");
    await app.close();
  });

  it("submits an owned moderation appeal with a replay key", async () => {
    const contentRepository: ContentRepository = {
      ...contentRepositoryWithDetail(homeFeedItem),
      async createModerationAppeal(input) {
        expect(input).toEqual({
          supabaseUserId: "00000000-0000-4000-8000-000000000001",
          contentId: "00000000-0000-4000-8000-000000000040",
          idempotencyKey: "content-appeal-1",
          reason: "The rights declaration is complete."
        });
        return {
          id: "00000000-0000-4000-8000-000000000041",
          contentId: input.contentId,
          state: "submitted",
          reason: input.reason,
          createdAt: "2026-08-15T12:02:00.000Z"
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
      method: "POST",
      url: "/v1/content/00000000-0000-4000-8000-000000000040/moderation-appeals",
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "content-appeal-1"
      },
      payload: { reason: "The rights declaration is complete." }
    });

    expect(response.statusCode, response.body).toBe(201);
    expect(response.json()).toMatchObject({ state: "submitted" });
    await app.close();
  });

  it("validates event draft content updates through the Event Access draft rules", async () => {
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
      walletRepository: walletRepositoryWithWallet
    });
    await app.ready();

    const response = await app.inject({
      method: "PATCH",
      url: "/v1/content/00000000-0000-4000-8000-000000000040",
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "content-update-event-1"
      },
      payload: {
        eventDraft: {
          title: "Studio event",
          startsAt: "2026-08-01T20:00:00.000Z",
          accessRule: "paid",
          location: { type: "venue", label: "Studio" },
          accessPassTypes: []
        }
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      code: "validation_failed",
      message: "accessRule is required"
    });

    await app.close();
  });

  it("links a valid Event Access draft from owned content metadata", async () => {
    const eventDraft = {
      title: "Studio event",
      startsAt: "2026-08-01T20:00:00.000Z",
      accessRule: "public_sale" as const,
      location: { type: "digital_live_stream" as const, label: "Veel Live" },
      accessPassTypes: [
        {
          label: "General access",
          priceMinor: 10_000,
          currency: "SOL" as const,
          capacity: 50,
          perUserLimit: 1
        }
      ]
    };
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
      async updateOwnedContent(input) {
        expect(input).toEqual({
          supabaseUserId: "00000000-0000-4000-8000-000000000001",
          contentId: "00000000-0000-4000-8000-000000000040",
          idempotencyKey: "content-update-event-2",
          caption: undefined,
          captionProvided: false,
          visibility: undefined,
          nsfwLabel: undefined,
          representationMode: undefined,
          contentSafetyPolicyAccepted: false,
          teaserStartMs: undefined,
          teaserStartMsProvided: false,
          teaserEndMs: undefined,
          teaserEndMsProvided: false,
          thumbnailFrameMs: undefined,
          thumbnailFrameMsProvided: false,
          eventDraft,
          eventDraftProvided: true
        });

        return homeFeedItem;
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
      method: "PATCH",
      url: "/v1/content/00000000-0000-4000-8000-000000000040",
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "content-update-event-2"
      },
      payload: {
        eventDraft
      }
    });

    expect(response.statusCode, JSON.stringify(response.json())).toBe(200);
    expect(response.json()).toMatchObject({
      id: "00000000-0000-4000-8000-000000000040"
    });

    await app.close();
  });

  it("submits provider-ready content for moderation through an explicit publish action", async () => {
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
          caption: "studio cut",
          nsfwLabel: "none"
        };
      },
      async listHomeFeed() {
        throw new Error("not implemented");
      },
      async publishOwnedContent(input) {
        expect(input).toEqual({
          supabaseUserId: "00000000-0000-4000-8000-000000000001",
          contentId: "00000000-0000-4000-8000-000000000040",
          idempotencyKey: "content-publish-1"
        });

        return homeFeedItem;
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
      verificationRepository: creatorVerifiedVerificationRepository(),
      contentRepository
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/v1/content/00000000-0000-4000-8000-000000000040/publish",
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "content-publish-1"
      },
      payload: {
        confirmation: "submit_for_review"
      }
    });

    expect(response.statusCode, JSON.stringify(response.json())).toBe(200);
    expect(response.json()).toEqual(homeFeedItem);

    await app.close();
  });

  it("fails content publish closed until provider media is ready", async () => {
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
          caption: "studio cut",
          nsfwLabel: "none"
        };
      },
      async listHomeFeed() {
        throw new Error("not implemented");
      },
      async publishOwnedContent() {
        const { ContentPublishConflictError } = await import("../src/modules/content/content-repository");
        throw new ContentPublishConflictError("provider_not_ready");
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
      verificationRepository: creatorVerifiedVerificationRepository(),
      contentRepository
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/v1/content/00000000-0000-4000-8000-000000000040/publish",
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "content-publish-2"
      },
      payload: {
        confirmation: "submit_for_review"
      }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      code: "conflict",
      message: "Content cannot be published until provider media is ready"
    });

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
        return { id: "00000000-0000-4000-8000-000000000041" };
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
          caption: "studio cut",
          nsfwLabel: "none"
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
      verificationRepository: creatorVerifiedVerificationRepository(),
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
      mediaAssetId: "00000000-0000-4000-8000-000000000041",
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

  it("blocks media uploads when the daily server quota is reached before calling Bunny", async () => {
    let providerCalled = false;
    const contentRepository: ContentRepository = {
      async createDraft() {
        throw new Error("not implemented");
      },
      async createMediaAsset() {
        throw new Error("provider should not create an asset when quota is reached");
      },
      async countMediaAssetsCreatedSince(input) {
        expect(input.supabaseUserId).toBe("00000000-0000-4000-8000-000000000001");
        expect(input.since).toBeInstanceOf(Date);
        return 30;
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
          caption: "studio cut",
          nsfwLabel: "none"
        };
      },
      async listHomeFeed() {
        throw new Error("not implemented");
      }
    };
    const mediaUploadProvider: MediaUploadProviderAdapter = {
      provider: "bunny",
      isConfigured() {
        providerCalled = true;
        return true;
      },
      async createUploadSession() {
        providerCalled = true;
        throw new Error("Bunny should not be called when quota is reached");
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
      verificationRepository: creatorVerifiedVerificationRepository(),
      contentRepository,
      mediaUploadProvider
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/v1/media/uploads",
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "media-upload-quota-1"
      },
      payload: {
        contentId: "00000000-0000-4000-8000-000000000040",
        fileName: "studio.mp4",
        mimeType: "video/mp4"
      }
    });

    expect(response.statusCode).toBe(429);
    expect(response.json()).toMatchObject({
      code: "rate_limited",
      message: "Daily media upload quota has been reached"
    });
    expect(providerCalled).toBe(false);

    await app.close();
  });

  it("uses the active admin content abuse policy for media upload quota enforcement", async () => {
    let providerCalled = false;
    const contentRepository: ContentRepository = {
      async createDraft() {
        throw new Error("not implemented");
      },
      async createMediaAsset() {
        throw new Error("provider should not create an asset when policy quota is reached");
      },
      async countMediaAssetsCreatedSince(input) {
        expect(input.supabaseUserId).toBe("00000000-0000-4000-8000-000000000001");
        expect(input.since).toBeInstanceOf(Date);
        return 1;
      },
      async getContentCreationAbusePolicy() {
        return {
          dailyContentDraftQuota: 20,
          dailyMediaUploadQuota: 1,
          rollingWindowHours: 6
        };
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
          caption: "studio cut",
          nsfwLabel: "none"
        };
      },
      async listHomeFeed() {
        throw new Error("not implemented");
      }
    };
    const mediaUploadProvider: MediaUploadProviderAdapter = {
      provider: "bunny",
      isConfigured() {
        providerCalled = true;
        return true;
      },
      async createUploadSession() {
        providerCalled = true;
        throw new Error("Bunny should not be called when policy quota is reached");
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
      verificationRepository: creatorVerifiedVerificationRepository(),
      contentRepository,
      mediaUploadProvider
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/v1/media/uploads",
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "media-upload-policy-1"
      },
      payload: {
        contentId: "00000000-0000-4000-8000-000000000040",
        fileName: "studio.mp4",
        mimeType: "video/mp4"
      }
    });

    expect(response.statusCode).toBe(429);
    expect(response.json()).toMatchObject({
      code: "rate_limited",
      message: "Daily media upload quota has been reached"
    });
    expect(providerCalled).toBe(false);

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
          caption: "studio cut",
          nsfwLabel: "none"
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
        API_RATE_LIMIT_STORE_DRIVER: "process_memory",
        PROFILE_AVATAR_BUCKET: "profile-avatars",
        SOLANA_CLUSTER: "devnet",
        SOLANA_NETWORK: "solana:devnet",
        SOLANA_RPC_URL: "https://api.devnet.solana.com",
        PAYMENT_DEFAULT_ASSET: "SOL",
        PAYMENT_USDC_DECIMALS: 6,
        PAYMENT_SOLANA_FINALITY: "finalized",
        PAYMENT_MIN_SUPPORT_SOL_LAMPORTS: 1_000_000,
        PAYMENT_MIN_SUPPORT_USDC_ATOMIC: 500_000,
        PAYMENT_PLATFORM_FEE_BPS: 1000,
        PAYMENT_REFERRAL_SHARE_OF_PLATFORM_FEE_BPS: 2000,
        SOLANA_SUBSCRIPTION_DELEGATION_PROGRAM_ID: "De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44",
        SUBSCRIPTIONS_ENABLED: false,
        SUBSCRIPTIONS_PROVIDER: "disabled",
        SUBSCRIPTIONS_SOLANA_PROGRAM_ID: "De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44",
        SUBSCRIPTIONS_SOLANA_NETWORK: "devnet",
        SUBSCRIPTIONS_REQUIRE_ONCHAIN_VERIFICATION: true,
        HELIUS_CLUSTER: "devnet",
        ONRAMP_PROVIDER: "disabled",
        ONRAMP_PURCHASE_CURRENCY: "SOL",
        WALLET_AUTH_SESSION_TTL_SECONDS: 604800,
        COINBASE_CDP_API_BASE_URL: "https://api.cdp.coinbase.com",
        COINBASE_ONRAMP_DESTINATION_NETWORK: "solana",
        AGE_VERIFICATION_ALLOW_MOCK_PROVIDER: false,
        AGE_VERIFICATION_PROVIDER_SELECTION_ENABLED: true,
        AGE_VERIFICATION_PREFER_REUSABLE_CREDENTIALS: true,
        AGE_VERIFICATION_REUSABLE_PROVIDERS: "didit_reusable,yoti_digital_id,eudi_wallet,scytales",
        AGE_VERIFICATION_FALLBACK_PROVIDERS: "didit_age_estimation,persona_document",
        AGE_VERIFICATION_FALLBACK_ORDER: "reusable_credential,age_estimation,free_document,portable_credential,database_non_doc,document",
        AGE_VERIFICATION_REVERIFY_MODE: "risk_or_expiry",
        AGE_VERIFICATION_REVERIFY_DAYS: 365,
        SUMSUB_API_BASE_URL: "https://api.sumsub.com",
        DIDIT_API_BASE_URL: "https://verification.didit.me",
        YOTI_API_BASE_URL: "https://age.yoti.com/api/v1",
        YOTI_LAUNCH_BASE_URL: "https://age.yoti.com",
        VERIFF_API_BASE_URL: "https://stationapi.veriff.com",
        PERSONA_API_BASE_URL: "https://api.withpersona.com",
        TRANSACTIONAL_EMAIL_PROVIDER: "disabled",
        WORKER_TICK_INTERVAL_MS: 60_000,
        WORKER_BATCH_LIMIT: 25,
        MCP_ENABLED: false,
        MCP_AUTH_MODE: "oauth",
        MCP_ALLOWED_CLIENTS: "",
        MCP_REQUIRE_OAUTH: true,
        MCP_ALLOW_STATIC_TOKENS_DEV: false,
        MCP_TOOL_CALL_RATE_LIMIT_PER_MINUTE: 30,
        MCP_CONNECTION_TOKEN_TTL_SECONDS: 86400,
        MCP_OAUTH_AUTH_CODE_TTL_SECONDS: 600,
        MCP_OAUTH_ACCESS_TOKEN_TTL_SECONDS: 3600,
        MCP_AUDIT_RETENTION_DAYS: 365,
        MCP_OAUTH_PUBLIC_CLIENT: true,
        BUNNY_STREAM_API_KEY: "bunny-secret",
        BUNNY_STREAM_LIBRARY_ID: "library-id",
        BUNNY_STREAM_PLAYBACK_TOKEN_TTL_SECONDS: 900,
        BUNNY_SHIELD_UPLOAD_COVERAGE: "not_configured",
        LIVEPEER_API_BASE_URL: "https://livepeer.studio/api",
        LIVEPEER_HTTP_TIMEOUT_MS: 10_000,
        LIVEPEER_ADULT_LIVE_ENABLED: false,
        MEDIA_MODERATION_MODE: "disabled_fail_closed",
        REALTIME_JWT_TTL_SECONDS: 300
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
      API_RATE_LIMIT_STORE_DRIVER: "process_memory",
      PROFILE_AVATAR_BUCKET: "profile-avatars",
      SOLANA_CLUSTER: "devnet",
      SOLANA_NETWORK: "solana:devnet",
      SOLANA_RPC_URL: "https://api.devnet.solana.com",
      PAYMENT_DEFAULT_ASSET: "SOL",
      PAYMENT_USDC_DECIMALS: 6,
      PAYMENT_SOLANA_FINALITY: "finalized",
      PAYMENT_MIN_SUPPORT_SOL_LAMPORTS: 1_000_000,
      PAYMENT_MIN_SUPPORT_USDC_ATOMIC: 500_000,
      PAYMENT_PLATFORM_FEE_BPS: 1000,
      PAYMENT_REFERRAL_SHARE_OF_PLATFORM_FEE_BPS: 2000,
      SOLANA_SUBSCRIPTION_DELEGATION_PROGRAM_ID: "De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44",
      SUBSCRIPTIONS_ENABLED: false,
      SUBSCRIPTIONS_PROVIDER: "disabled",
      SUBSCRIPTIONS_SOLANA_PROGRAM_ID: "De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44",
      SUBSCRIPTIONS_SOLANA_NETWORK: "devnet",
      SUBSCRIPTIONS_REQUIRE_ONCHAIN_VERIFICATION: true,
      HELIUS_CLUSTER: "devnet",
      ONRAMP_PROVIDER: "disabled",
      ONRAMP_PURCHASE_CURRENCY: "SOL",
      WALLET_AUTH_SESSION_TTL_SECONDS: 604800,
      COINBASE_CDP_API_BASE_URL: "https://api.cdp.coinbase.com",
      COINBASE_ONRAMP_DESTINATION_NETWORK: "solana",
      AGE_VERIFICATION_ALLOW_MOCK_PROVIDER: false,
      AGE_VERIFICATION_PROVIDER_SELECTION_ENABLED: true,
      AGE_VERIFICATION_PREFER_REUSABLE_CREDENTIALS: true,
      AGE_VERIFICATION_REUSABLE_PROVIDERS: "didit_reusable,yoti_digital_id,eudi_wallet,scytales",
      AGE_VERIFICATION_FALLBACK_PROVIDERS: "didit_age_estimation,persona_document",
      AGE_VERIFICATION_FALLBACK_ORDER: "reusable_credential,age_estimation,free_document,portable_credential,database_non_doc,document",
      AGE_VERIFICATION_REVERIFY_MODE: "risk_or_expiry",
      AGE_VERIFICATION_REVERIFY_DAYS: 365,
      SUMSUB_API_BASE_URL: "https://api.sumsub.com",
      DIDIT_API_BASE_URL: "https://verification.didit.me",
      YOTI_API_BASE_URL: "https://age.yoti.com/api/v1",
      YOTI_LAUNCH_BASE_URL: "https://age.yoti.com",
      VERIFF_API_BASE_URL: "https://stationapi.veriff.com",
      PERSONA_API_BASE_URL: "https://api.withpersona.com",
      TRANSACTIONAL_EMAIL_PROVIDER: "disabled",
      WORKER_TICK_INTERVAL_MS: 60_000,
      WORKER_BATCH_LIMIT: 25,
      MCP_ENABLED: false,
      MCP_AUTH_MODE: "oauth",
      MCP_ALLOWED_CLIENTS: "",
      MCP_REQUIRE_OAUTH: true,
      MCP_ALLOW_STATIC_TOKENS_DEV: false,
      MCP_TOOL_CALL_RATE_LIMIT_PER_MINUTE: 30,
      MCP_CONNECTION_TOKEN_TTL_SECONDS: 86400,
      MCP_OAUTH_AUTH_CODE_TTL_SECONDS: 600,
      MCP_OAUTH_ACCESS_TOKEN_TTL_SECONDS: 3600,
      MCP_AUDIT_RETENTION_DAYS: 365,
      MCP_OAUTH_PUBLIC_CLIENT: true,
      BUNNY_STREAM_API_KEY: "bunny-secret",
      BUNNY_STREAM_LIBRARY_ID: "759",
      BUNNY_STREAM_EMBED_TOKEN_KEY: "embed-token-secret",
      BUNNY_STREAM_PLAYBACK_TOKEN_TTL_SECONDS: 900,
      BUNNY_SHIELD_UPLOAD_COVERAGE: "not_configured",
      LIVEPEER_API_BASE_URL: "https://livepeer.studio/api",
      LIVEPEER_HTTP_TIMEOUT_MS: 10_000,
      LIVEPEER_ADULT_LIVE_ENABLED: false,
      MEDIA_MODERATION_MODE: "disabled_fail_closed",
      REALTIME_JWT_TTL_SECONDS: 300
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
      ...checkoutPaymentRepositoryMethods,
      async createOrReuseIntent(input) {
        expect(input).toMatchObject({
          supabaseUserId: "00000000-0000-4000-8000-000000000001",
          idempotencyKey: "payment-intent-1",
          productType: "support",
          targetId: "00000000-0000-4000-8000-000000000010",
          amountMinor: 10000000,
          currency: "SOL",
          solanaCluster: "devnet",
          treasuryWallet
        });

        return {
          ...storedPaymentIntent,
          productType: input.productType,
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
        productType: "support",
        targetId: "00000000-0000-4000-8000-000000000010",
        amountMinor: 10000000
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      id: storedPaymentIntent.id,
      productType: "support",
      amountMinor: 10000000,
      currency: "SOL",
      state: "pending",
      settlementKind: "creator_split",
      creatorSideProceedsMinor: storedPaymentIntent.creatorSideProceedsMinor,
      creatorAmountMinor: storedPaymentIntent.creatorAmountMinor,
      enterpriseManagementAmountMinor: storedPaymentIntent.enterpriseManagementAmountMinor,
      platformFeeGrossMinor: storedPaymentIntent.platformFeeGrossMinor,
      platformFeeAmountMinor: storedPaymentIntent.platformFeeAmountMinor,
      referralAmountMinor: storedPaymentIntent.referralAmountMinor,
      refundPolicy: storedPaymentIntent.refundPolicy
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
              receiptId: "00000000-0000-4000-8000-000000000060",
              receiptNumber: "VEEL-0000000000004000",
              receiptState: "issued",
              inAppConfirmationState: "sent",
              emailConfirmationState: "provider_not_configured",
              withdrawalRightStatus: "waived_after_immediate_access",
              supportReviewAvailable: true,
              latestRefundRequestState: null,
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
      async listAccessPasses() {
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
          title: "Support",
          state: "confirmed",
          productType: "support",
          amountMinor: 10000000,
          currency: "SOL",
          receiptNumber: "VEEL-0000000000004000",
          inAppConfirmationState: "sent",
          emailConfirmationState: "provider_not_configured",
          withdrawalRightStatus: "waived_after_immediate_access",
          supportReviewAvailable: true
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
      async listAccessPasses() {
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

  it("creates an event with backend-owned accessPass inventory", async () => {
    const eventRepository: EventRepository = {
      async createEvent(input) {
        expect(input).toMatchObject({
          supabaseUserId: "00000000-0000-4000-8000-000000000001",
          idempotencyKey: "event-key"
        });
        expect(input.body.accessPassTypes[0]).toMatchObject({
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
      async findAccessPassOffer() {
        throw new Error("not implemented");
      },
      async recordAccessPassPurchaseRequest() {
        throw new Error("not implemented");
      },
      async grantFreeAccessPass() {
        throw new Error("not implemented");
      },
      async createAccessPassRequest() {
        throw new Error("not implemented");
      },
      async checkInAccessPass() {
        throw new Error("not implemented");
      },
      async listAccessPasses() {
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
        accessPassTypes: [
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
      accessPassTypes: [{ label: "General admission", remaining: 25 }]
    });

    await app.close();
  });

  it("creates a server-priced paid Event Access Pass intent", async () => {
    const eventId = "00000000-0000-4000-8000-0000000000e1";
    const accessPassTypeId = "00000000-0000-4000-8000-0000000000e2";
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
      async findAccessPassOffer(input) {
        expect(input).toMatchObject({ eventId, accessPassTypeId });
        return {
          event: eventFixture({ id: eventId, state: "published", accessPassTypeId }),
          accessPassType: accessPassTypeFixture({ id: accessPassTypeId, priceMinor: 10000000 }),
          alreadyIssuedAccessPass: null
        };
      },
      async recordAccessPassPurchaseRequest(input) {
        expect(input).toMatchObject({
          eventId,
          accessPassTypeId,
          paymentIntentId: "00000000-0000-4000-8000-000000000050",
          amountMinor: 10000000,
          currency: "SOL"
        });
        return true;
      },
      async grantFreeAccessPass() {
        throw new Error("not implemented");
      },
      async createAccessPassRequest() {
        throw new Error("not implemented");
      },
      async checkInAccessPass() {
        throw new Error("not implemented");
      },
      async listAccessPasses() {
        throw new Error("not implemented");
      }
    };
    const paymentRepository: PaymentRepository = {
      ...checkoutPaymentRepositoryMethods,
      async createOrReuseIntent(input) {
        expect(input).toMatchObject({
          productType: "event_access_pass",
          targetId: eventId,
          amountMinor: 10000000,
          currency: "SOL"
        });

        return {
          ...storedPaymentIntent,
          productType: "event_access_pass",
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
      url: `/v1/events/${eventId}/access-passes/intents`,
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "access-pass-key"
      },
      payload: { accessPassTypeId: accessPassTypeId }
    });
    const legacyResponse = await app.inject({
      method: "POST",
      url: `/v1/events/${eventId}/tickets/intents`,
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "legacy-accessPass-key"
      },
      payload: { accessPassTypeId }
    });

    expect(response.statusCode, JSON.stringify(response.json())).toBe(201);
    expect(response.json()).toMatchObject({
      state: "payment_required",
      paymentIntent: {
        productType: "event_access_pass",
        amountMinor: 10000000,
        currency: "SOL"
      }
    });
    expect(legacyResponse.statusCode).toBe(404);

    await app.close();
  });

  it("grants a free Event Access Pass and supports activity/check-in projections", async () => {
    const eventId = "00000000-0000-4000-8000-0000000000e1";
    const accessPassTypeId = "00000000-0000-4000-8000-0000000000e2";
    const accessPass = accessPassFixture({ eventId, accessPassTypeId });
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
      async findAccessPassOffer() {
        return {
          event: eventFixture({ id: eventId, state: "published", accessPassTypeId, priceMinor: null }),
          accessPassType: accessPassTypeFixture({ id: accessPassTypeId, priceMinor: null }),
          alreadyIssuedAccessPass: null
        };
      },
      async recordAccessPassPurchaseRequest() {
        throw new Error("not implemented");
      },
      async grantFreeAccessPass() {
        return accessPass;
      },
      async createAccessPassRequest() {
        throw new Error("not implemented");
      },
      async checkInAccessPass(input) {
        expect(input).toMatchObject({ accessPassId: accessPass.id, qrToken: accessPass.qrToken });
        return { ...accessPass, state: "checked_in", checkedInAt: "2026-07-01T20:10:00.000Z" };
      },
      async listAccessPasses() {
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
      async listAccessPasses(input) {
        expect(input).toMatchObject({
          supabaseUserId: "00000000-0000-4000-8000-000000000001",
          limit: 20
        });
        return { items: [accessPass], nextCursor: null };
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
      url: `/v1/events/${eventId}/access-passes/intents`,
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "free-access-pass-key"
      },
      payload: { accessPassTypeId: accessPassTypeId }
    });
    const activityResponse = await app.inject({
      method: "GET",
      url: "/v1/activity/access-passes",
      headers: { authorization: "Bearer valid-token" }
    });
    const checkInResponse = await app.inject({
      method: "POST",
      url: `/v1/access-passes/${accessPass.id}/check-in`,
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "check-in-key"
      },
      payload: { qrToken: accessPass.qrToken }
    });
    const legacyActivityResponse = await app.inject({
      method: "GET",
      url: "/v1/activity/tickets",
      headers: { authorization: "Bearer valid-token" }
    });
    const legacyCheckInResponse = await app.inject({
      method: "POST",
      url: `/v1/tickets/${accessPass.id}/check-in`,
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "legacy-check-in-key"
      },
      payload: { qrToken: accessPass.qrToken }
    });

    expect(grantResponse.statusCode).toBe(201);
    expect(grantResponse.json()).toMatchObject({ state: "free_granted", accessPass });
    expect(legacyActivityResponse.statusCode).toBe(404);
    expect(legacyCheckInResponse.statusCode).toBe(404);
    expect(activityResponse.statusCode).toBe(200);
    expect(activityResponse.json()).toMatchObject({ items: [accessPass], nextCursor: null });
    expect(checkInResponse.statusCode).toBe(200);
    expect(checkInResponse.json()).toMatchObject({ state: "checked_in" });

    await app.close();
  });

  it("activates Mutuals mode and returns the explicit Mutuals feed", async () => {
    const mutualsRepository: MutualsRepository = {
      async activate(input) {
        expect(input).toMatchObject({
          supabaseUserId: "00000000-0000-4000-8000-000000000001",
          consentVersion: "mutuals-consent-2026-06-04"
        });
        return mutualsProfileFixture({ enabled: true });
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
          items: [mutualsFeedItemFixture()],
          nextCursor: null
        };
      },
      async createInterest() {
        throw new Error("not implemented");
      },
      async listMutuals() {
        throw new Error("not implemented");
      },
      async archiveMutual() {
        throw new Error("not implemented");
      }
    };
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      sessionRepository: appReadySessionRepository,
      ageRepository: verifiedAgeRepository,
      mutualsRepository
    });
    await app.ready();

    const activateResponse = await app.inject({
      method: "POST",
      url: "/v1/mutuals/activate",
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "mutuals-activate-key"
      },
      payload: { consentVersion: "mutuals-consent-2026-06-04" }
    });
    const feedResponse = await app.inject({
      method: "GET",
      url: "/v1/mutuals/feed",
      headers: { authorization: "Bearer valid-token" }
    });

    expect(activateResponse.statusCode).toBe(200);
    expect(activateResponse.json()).toMatchObject({
      enabled: true,
      consentVersion: "mutuals-consent-2026-06-04",
      activeMatchLimit: 10
    });
    expect(feedResponse.statusCode).toBe(200);
    expect(feedResponse.json()).toMatchObject({
      items: [
        {
          handle: "maki",
          title: "Mutuals profile card",
          mediaKind: "image"
        }
      ],
      nextCursor: null
    });

    await app.close();
  });

  it("creates a Mutual from backend-owned interest state", async () => {
    const match = mutualFixture();
    const mutualsRepository: MutualsRepository = {
      async activate() {
        throw new Error("not implemented");
      },
      async updatePreferences() {
        throw new Error("not implemented");
      },
      async listFeed() {
        throw new Error("not implemented");
      },
      async createInterest(input) {
        expect(input).toMatchObject({
          supabaseUserId: "00000000-0000-4000-8000-000000000001",
          idempotencyKey: "mutuals-interest-key",
          body: {
            targetUserId: "00000000-0000-4000-8000-000000000011",
            contentId: "00000000-0000-4000-8000-000000000040",
            action: "yes"
          }
        });
        return {
          interestId: "00000000-0000-4000-8000-0000000000d1",
          mutualCreated: true,
          mutualId: match.id,
          mutual: match
        };
      },
      async listMutuals(input) {
        expect(input).toMatchObject({
          supabaseUserId: "00000000-0000-4000-8000-000000000001",
          limit: 20
        });
        return { items: [match], nextCursor: null };
      },
      async archiveMutual(input) {
        expect(input).toMatchObject({ mutualId: match.id });
        return { ...match, state: "archived" };
      }
    };
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      sessionRepository: appReadySessionRepository,
      ageRepository: verifiedAgeRepository,
      mutualsRepository
    });
    await app.ready();

    const swipeResponse = await app.inject({
      method: "POST",
      url: "/v1/mutuals/interests",
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "mutuals-interest-key"
      },
      payload: {
        targetUserId: "00000000-0000-4000-8000-000000000011",
        contentId: "00000000-0000-4000-8000-000000000040",
        action: "yes"
      }
    });
    const matchesResponse = await app.inject({
      method: "GET",
      url: "/v1/mutuals",
      headers: { authorization: "Bearer valid-token" }
    });
    const archiveResponse = await app.inject({
      method: "PATCH",
      url: `/v1/mutuals/${match.id}/archive`,
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "mutuals-archive-key"
      }
    });

    expect(swipeResponse.statusCode).toBe(200);
    expect(swipeResponse.json()).toMatchObject({
      mutualCreated: true,
      mutualId: match.id,
      mutual: { conversationId: match.conversationId }
    });
    expect(matchesResponse.statusCode).toBe(200);
    expect(matchesResponse.json()).toMatchObject({ items: [match], nextCursor: null });
    expect(archiveResponse.statusCode).toBe(200);
    expect(archiveResponse.json()).toMatchObject({ state: "archived" });

    await app.close();
  });

  it("does not expose deprecated dating aliases after the Mutuals rename", async () => {
    const mutualsRepository: MutualsRepository = {
      async activate() {
        throw new Error("not implemented");
      },
      async updatePreferences() {
        throw new Error("not implemented");
      },
      async listFeed() {
        return {
          items: [mutualsFeedItemFixture()],
          nextCursor: null
        };
      },
      async createInterest() {
        throw new Error("not implemented");
      },
      async listMutuals() {
        return { items: [mutualFixture()], nextCursor: null };
      },
      async archiveMutual() {
        throw new Error("not implemented");
      }
    };
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      sessionRepository: appReadySessionRepository,
      ageRepository: verifiedAgeRepository,
      mutualsRepository
    });
    await app.ready();

    const legacyFeedResponse = await app.inject({
      method: "GET",
      url: "/v1/dating/feed",
      headers: { authorization: "Bearer valid-token" }
    });
    const legacyMatchesResponse = await app.inject({
      method: "GET",
      url: "/v1/dating/matches",
      headers: { authorization: "Bearer valid-token" }
    });

    expect(legacyFeedResponse.statusCode).toBe(404);
    expect(legacyMatchesResponse.statusCode).toBe(404);

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
        async retryDeadLetterJob() {
          throw new Error("not implemented");
        },
        async listUsers() {
          throw new Error("not implemented");
        },
        async getUser() {
          throw new Error("not implemented");
        },
        async listContent() {
          throw new Error("not implemented");
        },
        async updateContentModeration() {
          throw new Error("not implemented");
        },
        async listReports() {
          throw new Error("not implemented");
        },
        async updateReport() {
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
        async enqueueProviderEventReplay() {
          throw new Error("not implemented");
        },
        async listAuditEvents() {
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
        async listDataRequests() {
          throw new Error("not implemented");
        },
        async updateDataRequest() {
          throw new Error("not implemented");
        },
        async listFeatureFlags() {
          throw new Error("not implemented");
        },
        async updateFeatureFlag() {
          throw new Error("not implemented");
        },
        async listEvents() {
          throw new Error("not implemented");
        },
        async listAccessPasses() {
          throw new Error("not implemented");
        },
        async listLiveRooms() {
          throw new Error("not implemented");
        },
        async listMediaAssets() {
          throw new Error("not implemented");
        },
        async listAgeChecks() {
          throw new Error("not implemented");
        },
        async listIdentityChecks() {
          throw new Error("not implemented");
        },
        async listAiSessions() {
          throw new Error("not implemented");
        },
        async listAiToolCalls() {
          throw new Error("not implemented");
        },
        async getMutualsSafety() {
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
        async retryDeadLetterJob() {
          throw new Error("not implemented");
        },
        async listUsers() {
          throw new Error("not implemented");
        },
        async getUser() {
          throw new Error("not implemented");
        },
        async listContent() {
          throw new Error("not implemented");
        },
        async updateContentModeration() {
          throw new Error("not implemented");
        },
        async listReports() {
          throw new Error("not implemented");
        },
        async updateReport() {
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
        async enqueueProviderEventReplay() {
          throw new Error("not implemented");
        },
        async listAuditEvents() {
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
        async listDataRequests() {
          throw new Error("not implemented");
        },
        async updateDataRequest() {
          throw new Error("not implemented");
        },
        async listFeatureFlags() {
          throw new Error("not implemented");
        },
        async updateFeatureFlag() {
          throw new Error("not implemented");
        },
        async listEvents() {
          throw new Error("not implemented");
        },
        async listAccessPasses() {
          throw new Error("not implemented");
        },
        async listLiveRooms() {
          throw new Error("not implemented");
        },
        async listMediaAssets() {
          throw new Error("not implemented");
        },
        async listAgeChecks() {
          throw new Error("not implemented");
        },
        async listIdentityChecks() {
          throw new Error("not implemented");
        },
        async listAiSessions() {
          throw new Error("not implemented");
        },
        async listAiToolCalls() {
          throw new Error("not implemented");
        },
        async getMutualsSafety() {
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
        async retryDeadLetterJob() {
          throw new Error("not implemented");
        },
        async listUsers() {
          throw new Error("not implemented");
        },
        async getUser() {
          throw new Error("not implemented");
        },
        async listContent() {
          throw new Error("not implemented");
        },
        async updateContentModeration() {
          throw new Error("not implemented");
        },
        async listReports() {
          throw new Error("not implemented");
        },
        async updateReport() {
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
        async enqueueProviderEventReplay() {
          throw new Error("not implemented");
        },
        async listAuditEvents() {
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
        async listDataRequests() {
          throw new Error("not implemented");
        },
        async updateDataRequest() {
          throw new Error("not implemented");
        },
        async listFeatureFlags() {
          throw new Error("not implemented");
        },
        async updateFeatureFlag() {
          throw new Error("not implemented");
        },
        async listEvents() {
          throw new Error("not implemented");
        },
        async listAccessPasses() {
          throw new Error("not implemented");
        },
        async listLiveRooms() {
          throw new Error("not implemented");
        },
        async listMediaAssets() {
          throw new Error("not implemented");
        },
        async listAgeChecks() {
          throw new Error("not implemented");
        },
        async listIdentityChecks() {
          throw new Error("not implemented");
        },
        async listAiSessions() {
          throw new Error("not implemented");
        },
        async listAiToolCalls() {
          throw new Error("not implemented");
        },
        async getMutualsSafety() {
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
      adminRepository: {
        ...fakeAdminRepository,
        async listFeatureFlags() {
          return {
            items: [
              {
                key: "compliance.carf_exports",
                value: { enabled: true },
                category: "compliance",
                policyBoundary: "software_policy_only_no_payment_access_or_social_priority",
                state: "active",
                updatedAt: "2026-06-06T12:00:00.000Z"
              }
            ],
            nextCursor: null
          };
        }
      }
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

  it("blocks CARF report access while the policy feature flag is paused", async () => {
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      adminRepository: fakeAdminRepository
    });
    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: "/v1/admin/compliance/carf/reports",
      headers: {
        authorization: "Bearer valid-token"
      }
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      code: "forbidden",
      message: "CARF reporting is disabled by policy"
    });

    await app.close();
  });

  it("returns sanitized admin audit events", async () => {
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      adminRepository: fakeAdminRepository
    });
    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: "/v1/admin/audit",
      headers: {
        authorization: "Bearer valid-token"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().items[0]).toMatchObject({
      subjectType: "feature_flag",
      action: "feature_flag_updated"
    });
    expect(response.body).not.toMatch(
      /metadata|raw|payload|secret|privateKey|serviceRole|identityDocument|idempotencyKey|reason|providerPayload/i
    );

    await app.close();
  });

  it("returns sanitized admin users content and reports", async () => {
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      adminRepository: fakeAdminRepository
    });
    await app.ready();

    const headers = { authorization: "Bearer valid-token" };
    const [users, user, content, reports] = await Promise.all([
      app.inject({ method: "GET", url: "/v1/admin/users", headers }),
      app.inject({ method: "GET", url: "/v1/admin/users/00000000-0000-4000-8000-000000000011", headers }),
      app.inject({ method: "GET", url: "/v1/admin/content", headers }),
      app.inject({ method: "GET", url: "/v1/admin/reports", headers })
    ]);

    for (const response of [users, user, content, reports]) {
      expect(response.statusCode).toBe(200);
      expect(response.body).not.toMatch(
        /raw|payload|secret|privateKey|serviceRole|identityDocument|providerPayload|metadata|email|phone/i
      );
    }

    expect(users.json().items[0]).toMatchObject({
      handle: "maki",
      ageState: "verified",
      walletState: {
        connected: true,
        chain: "solana_devnet"
      }
    });
    expect(content.json().items[0]).toMatchObject({
      moderationState: "pending",
      creator: { handle: "creator" }
    });
    expect(reports.json().items[0]).toMatchObject({
      subjectType: "content",
      state: "submitted"
    });

    await app.close();
  });

  it("returns sanitized admin Event Access projections", async () => {
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      adminRepository: fakeAdminRepository
    });
    await app.ready();

    const headers = { authorization: "Bearer valid-token" };
    const [events, accessPasses] = await Promise.all([
      app.inject({ method: "GET", url: "/v1/admin/events", headers }),
      app.inject({ method: "GET", url: "/v1/admin/event-access-passes", headers })
    ]);

    expect(events.statusCode).toBe(200);
    expect(events.json().items[0]).toMatchObject({
      title: "Creator live night",
      state: "published",
      accessPassTypes: [expect.objectContaining({ remaining: 49 })]
    });
    expect(accessPasses.statusCode).toBe(200);
    expect(accessPasses.json().items[0]).toMatchObject({
      eventId: "00000000-0000-4000-8000-0000000000e1",
      state: "active"
    });
    const legacyAdminResponse = await app.inject({ method: "GET", url: "/v1/admin/tickets", headers });
    expect(legacyAdminResponse.statusCode).toBe(404);
    expect(`${events.body}${accessPasses.body}`).not.toMatch(
      /raw|payload|secret|privateKey|serviceRole|identityDocument|providerPayload|metadata|streamKey|ingest|balance|payout/i
    );

    await app.close();
  });

  it("updates admin content moderation and reports through audited mutations", async () => {
    const contentCalls: Array<Parameters<AdminRepository["updateContentModeration"]>[0]> = [];
    const reportCalls: Array<Parameters<AdminRepository["updateReport"]>[0]> = [];
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      adminRepository: {
        ...fakeAdminRepository,
        async updateContentModeration(input) {
          contentCalls.push(input);
          return fakeAdminRepository.updateContentModeration(input);
        },
        async updateReport(input) {
          reportCalls.push(input);
          return fakeAdminRepository.updateReport(input);
        }
      }
    });
    await app.ready();

    const headers = {
      authorization: "Bearer valid-token",
      "idempotency-key": "admin-moderation-1"
    };
    const [content, report] = await Promise.all([
      app.inject({
        method: "PATCH",
        url: "/v1/admin/content/00000000-0000-4000-8000-000000000040/moderation",
        headers,
        payload: { action: "block", reason: "Policy violation" }
      }),
      app.inject({
        method: "PATCH",
        url: "/v1/admin/reports/00000000-0000-4000-8000-000000000190",
        headers: {
          authorization: "Bearer valid-token",
          "idempotency-key": "admin-report-1"
        },
        payload: { state: "escalated", reason: "Needs senior review" }
      })
    ]);

    expect(content.statusCode).toBe(200);
    expect(content.json()).toMatchObject({
      moderationState: "blocked",
      state: "blocked"
    });
    expect(report.statusCode).toBe(200);
    expect(report.json()).toMatchObject({
      state: "escalated"
    });
    expect(contentCalls[0]).toMatchObject({
      idempotencyKey: "admin-moderation-1",
      body: { action: "block", reason: "Policy violation" }
    });
    expect(reportCalls[0]).toMatchObject({
      idempotencyKey: "admin-report-1",
      body: { state: "escalated", reason: "Needs senior review" }
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
        state: "resolved",
        resolution: "Creator attested that the noncustodial refund transaction was sent",
        reason: "Confirmed access issue after support review",
        remediationEvidence: {
          evidenceType: "creator_refund_attestation",
          evidenceSource: "creator_attestation",
          externalReference: "creator-refund-signature",
          amountMinor: 25000000,
          currency: "SOL",
          refundValueBasis: "original_crypto_amount",
          refundWallet: "BuyerRefundWallet111111111111111111111111111",
          notes: "Creator supplied a refund transaction reference for support review."
        }
      }
    });

    expect(listed.statusCode).toBe(200);
    expect(listed.json().items[0]).toMatchObject({
      kind: "access_issue",
      custodyBoundary: "no_platform_custody_no_payout_queue",
      remediationEvidenceCount: 0,
      latestRemediationEvidenceAt: null
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({
      id: "00000000-0000-4000-8000-000000000160",
      state: "resolved",
      custodyBoundary: "no_platform_custody_no_payout_queue",
      remediationEvidenceCount: 1,
      latestRemediationEvidenceAt: "2026-06-06T11:30:00.000Z"
    });
    expect(updateCalls[0]).toMatchObject({
      supabaseUserId: "00000000-0000-4000-8000-000000000001",
      idempotencyKey: "refund-admin-1",
      body: {
        remediationEvidence: {
          evidenceType: "creator_refund_attestation",
          evidenceSource: "creator_attestation",
          externalReference: "creator-refund-signature",
          refundValueBasis: "original_crypto_amount"
        }
      }
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

  it("returns sanitized admin data request and feature flag projections", async () => {
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      adminRepository: fakeAdminRepository
    });
    await app.ready();

    const headers = { authorization: "Bearer valid-token" };
    const [dataRequests, featureFlags] = await Promise.all([
      app.inject({ method: "GET", url: "/v1/admin/data-requests", headers }),
      app.inject({ method: "GET", url: "/v1/admin/feature-flags", headers })
    ]);

    expect(dataRequests.statusCode).toBe(200);
    expect(dataRequests.json().items[0]).toMatchObject({
      type: "export",
      privacyBoundary: "sanitized_identity_minimized_no_raw_exports"
    });
    expect(featureFlags.statusCode).toBe(200);
    expect(featureFlags.json().items[0]).toMatchObject({
      key: "compliance.carf_exports",
      policyBoundary: "software_policy_only_no_payment_access_or_social_priority",
      state: "paused"
    });
    expect(`${dataRequests.body}${featureFlags.body}`).not.toMatch(
      /rawPayload|providerPayload|identityDocument|secret|privateKey|serviceRole|creatorBalance|withdraw|payoutQueue|escrow|paymentProof|recommendationBoost|visibilityBoost|messagePriority|mutualsBoost/i
    );

    await app.close();
  });

  it("updates data requests and feature flags through audited admin mutations", async () => {
    const dataRequestCalls: Array<Parameters<AdminRepository["updateDataRequest"]>[0]> = [];
    const featureFlagCalls: Array<Parameters<AdminRepository["updateFeatureFlag"]>[0]> = [];
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      adminRepository: {
        ...fakeAdminRepository,
        async updateDataRequest(input) {
          dataRequestCalls.push(input);
          return fakeAdminRepository.updateDataRequest(input);
        },
        async updateFeatureFlag(input) {
          featureFlagCalls.push(input);
          return fakeAdminRepository.updateFeatureFlag(input);
        }
      }
    });
    await app.ready();

    const dataRequest = await app.inject({
      method: "PATCH",
      url: "/v1/admin/data-requests/00000000-0000-4000-8000-000000000170",
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "data-request-1"
      },
      payload: {
        state: "processing",
        reason: "Identity verified; export job can be prepared"
      }
    });
    const featureFlag = await app.inject({
      method: "PATCH",
      url: "/v1/admin/feature-flags/compliance.carf_exports",
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "feature-flag-1"
      },
      payload: {
        value: { enabled: false },
        state: "paused",
        reason: "Counsel review is still required before export"
      }
    });

    expect(dataRequest.statusCode).toBe(200);
    expect(dataRequest.json()).toMatchObject({
      id: "00000000-0000-4000-8000-000000000170",
      state: "processing",
      privacyBoundary: "sanitized_identity_minimized_no_raw_exports"
    });
    expect(featureFlag.statusCode).toBe(200);
    expect(featureFlag.json()).toMatchObject({
      key: "compliance.carf_exports",
      policyBoundary: "software_policy_only_no_payment_access_or_social_priority"
    });
    expect(dataRequestCalls[0]).toMatchObject({
      idempotencyKey: "data-request-1"
    });
    expect(featureFlagCalls[0]).toMatchObject({
      idempotencyKey: "feature-flag-1",
      featureFlagKey: "compliance.carf_exports"
    });

    await app.close();
  });

  it("rejects feature flag updates without idempotency", async () => {
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      adminRepository: fakeAdminRepository
    });
    await app.ready();

    const response = await app.inject({
      method: "PATCH",
      url: "/v1/admin/feature-flags/compliance.carf_exports",
      headers: {
        authorization: "Bearer valid-token"
      },
      payload: {
        value: { enabled: false },
        state: "paused",
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

  it("provisions an Enterprise organization with explicit owner consent pending", async () => {
    const calls: Array<Parameters<AdminRepository["provisionOrganization"]>[0]> = [];
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      adminRepository: {
        ...fakeAdminRepository,
        async provisionOrganization(input) {
          calls.push(input);
          return {
            id: "00000000-0000-4000-8000-000000000149",
            name: input.body.name,
            state: "pending_kyb",
            plan: "enterprise",
            kybState: "not_started",
            createdAt: "2026-08-16T10:00:00.000Z"
          };
        }
      }
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/v1/admin/organizations",
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "organization-provision-001"
      },
      payload: {
        name: "  Creator House  ",
        ownerHandle: "Creator_Owner",
        reason: "Approved Enterprise onboarding"
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      name: "Creator House",
      state: "pending_kyb",
      kybState: "not_started"
    });
    expect(calls[0]).toMatchObject({
      body: {
        name: "Creator House",
        ownerHandle: "creator_owner",
        reason: "Approved Enterprise onboarding"
      },
      idempotencyKey: "organization-provision-001"
    });
    expect(calls[0]?.requestHash).toMatch(/^[a-f0-9]{64}$/);
    expect(response.body).not.toMatch(/email|balance|withdraw|payout|escrow|privateKey|serviceRole/i);

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

    const [
      summary,
      notificationHealth,
      payments,
      unlocks,
      providerEvents,
      liveRooms,
      mediaAssets,
      ageChecks,
      identityChecks,
      aiSessions,
      aiToolCalls,
      mutualsSafety
    ] = await Promise.all([
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
      }),
      app.inject({
        method: "GET",
        url: "/v1/admin/live/rooms",
        headers: { authorization: "Bearer valid-token" }
      }),
      app.inject({
        method: "GET",
        url: "/v1/admin/media/assets",
        headers: { authorization: "Bearer valid-token" }
      }),
      app.inject({
        method: "GET",
        url: "/v1/admin/age-kyc/age-checks",
        headers: { authorization: "Bearer valid-token" }
      }),
      app.inject({
        method: "GET",
        url: "/v1/admin/age-kyc/identity-checks",
        headers: { authorization: "Bearer valid-token" }
      }),
      app.inject({
        method: "GET",
        url: "/v1/admin/ai/sessions",
        headers: { authorization: "Bearer valid-token" }
      }),
      app.inject({
        method: "GET",
        url: "/v1/admin/ai/tool-calls",
        headers: { authorization: "Bearer valid-token" }
      }),
      app.inject({
        method: "GET",
        url: "/v1/admin/mutuals/safety",
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
      state: "processed",
      latestReplayState: "queued",
      latestReplayProcessedAt: null
    });
    expect(JSON.stringify(providerEvents.json())).not.toMatch(/raw|payload|secret|streamKey/i);
    expect(liveRooms.statusCode).toBe(200);
    expect(liveRooms.json().items[0]).toMatchObject({
      provider: "livepeer",
      providerState: "active",
      state: "live",
      hasPlaybackUrl: true,
      hasHostStreamKey: true
    });
    expect(JSON.stringify(liveRooms.json())).not.toMatch(
      /"hostStreamKey"|host_stream_key|streamKeyValue|maskedIngestUrl|ingestUrl|"playbackUrl"|playback_url|"url"|raw|payload|secret/i
    );
    expect(mediaAssets.statusCode).toBe(200);
    expect(mediaAssets.json().items[0]).toMatchObject({
      provider: "bunny",
      providerState: "ready",
      providerPlayable: true,
      hasPlaybackUrl: true
    });
    expect(JSON.stringify(mediaAssets.json())).not.toMatch(
      /"playbackUrl"|playback_url|"url"|raw|payload|secret|streamKeyValue|ingestUrl/i
    );
    expect(ageChecks.statusCode).toBe(200);
    expect(ageChecks.json().items[0]).toMatchObject({
      provider: "sumsub",
      state: "verified",
      hasProviderReference: true,
      privacyBoundary: "sanitized_age_state_no_raw_identity_payloads"
    });
    expect(JSON.stringify(ageChecks.json())).not.toMatch(
      /rawProviderPayload|documentImage|documentNumber|legalName|payloadBody|secret|privateKey|serviceRole/i
    );
    expect(identityChecks.statusCode).toBe(200);
    expect(identityChecks.json().items[0]).toMatchObject({
      verificationType: "kyc",
      state: "pending",
      hasLegalNameHash: true,
      privacyBoundary: "sanitized_identity_minimized_no_raw_documents_or_pii"
    });
    expect(JSON.stringify(identityChecks.json())).not.toMatch(
      /rawProviderPayload|payloadBody|documentImage|documentNumber|legalName[^H]|tin|vatId|secret|privateKey|serviceRole/i
    );
    expect(aiSessions.statusCode).toBe(200);
    expect(aiSessions.json().items[0]).toMatchObject({
      scope: "admin_ops",
      state: "active",
      allowedToolCount: 2
    });
    expect(JSON.stringify(aiSessions.json())).not.toMatch(/idempotencyKey|allowedTools|inputRedacted|outputRedacted|secret/i);
    expect(aiToolCalls.statusCode).toBe(200);
    expect(aiToolCalls.json().items[0]).toMatchObject({
      toolName: "provider_health_summary",
      state: "executed",
      redactionBoundary: "summaries_only_no_tool_payloads_or_secrets"
    });
    expect(JSON.stringify(aiToolCalls.json())).not.toMatch(
      /inputRedacted|outputRedacted|payloadBody|secretValue|privateKey|serviceRole/i
    );
    expect(mutualsSafety.statusCode).toBe(200);
    expect(mutualsSafety.json()).toEqual({
      openReports: 0,
      activeMutuals: 1,
      staleMutuals: 0,
      socialMoneyBoundary: "money_never_buys_people_visibility_matches_or_social_priority"
    });

    const legacyDatingSafety = await app.inject({
      method: "GET",
      url: "/v1/admin/dating/safety",
      headers: { authorization: "Bearer valid-token" }
    });
    expect(legacyDatingSafety.statusCode).toBe(404);

    const replayResponse = await app.inject({
      method: "POST",
      url: "/v1/admin/provider-events/00000000-0000-4000-8000-0000000000a0/replay",
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "provider-event-replay-key"
      },
      payload: { reason: "retry normalized settlement event after provider outage" }
    });

    expect(replayResponse.statusCode).toBe(202);

    const deadLetterRetryResponse = await app.inject({
      method: "POST",
      url: "/v1/admin/worker-queues/media_moderation/jobs/00000000-0000-4000-8000-0000000000b0/retry",
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "media-moderation-dead-letter-retry-key"
      },
      payload: { reason: "retry after correcting the moderation provider configuration" }
    });

    expect(deadLetterRetryResponse.statusCode).toBe(202);

    await app.close();
  });

  it("passes referral tokens to backend-owned payment intent creation", async () => {
    vi.stubEnv("PAYMENT_PLATFORM_TREASURY_WALLET", treasuryWallet);
    const paymentRepository: PaymentRepository = {
      ...checkoutPaymentRepositoryMethods,
      async createOrReuseIntent(input) {
        expect(input).toMatchObject({
          productType: "support",
          targetId: "00000000-0000-4000-8000-000000000010",
          amountMinor: 10000000,
          referralToken: "veel_referral_token"
        });

        return {
          ...storedPaymentIntent,
          productType: input.productType,
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
        productType: "support",
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
      ...checkoutPaymentRepositoryMethods,
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
        state: "pending",
        settlementKind: "creator_split",
        creatorSideProceedsMinor: storedPaymentIntent.creatorSideProceedsMinor,
        creatorAmountMinor: storedPaymentIntent.creatorAmountMinor,
        enterpriseManagementAmountMinor: storedPaymentIntent.enterpriseManagementAmountMinor,
        platformFeeGrossMinor: storedPaymentIntent.platformFeeGrossMinor,
        platformFeeAmountMinor: storedPaymentIntent.platformFeeAmountMinor,
        referralAmountMinor: storedPaymentIntent.referralAmountMinor,
        refundPolicy: storedPaymentIntent.refundPolicy
      }
    });

    await app.close();
    vi.unstubAllEnvs();
  });

  it("rejects client-priced generic access-bearing payment intents", async () => {
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
        productType: "live_pass",
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

  it("mints a scoped Solana Pay checkout that exposes wallet metadata without Veel auth", async () => {
    vi.stubEnv("PAYMENT_PLATFORM_TREASURY_WALLET", treasuryWallet);
    const recordedRequests: RecordTransactionRequestInput[] = [];
    const paymentRepository: PaymentRepository = {
      ...checkoutPaymentRepositoryMethods,
      async createOrReuseIntent() {
        throw new Error("not implemented");
      },
      async findIntent() {
        return storedPaymentIntent;
      },
      async findCheckoutIntent() {
        return storedPaymentIntent;
      },
      async recordTransactionRequest(input) {
        recordedRequests.push(input);

        return {
          transactionRequestUrl: input.publicTransactionRequestUrl,
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
    const body = response.json() as {
      transactionRequestUrl: string;
      checkoutUrl: string;
      qrDataUrl: string;
      expiresAt: string;
    };
    expect(body.transactionRequestUrl).toMatch(
      /^solana:http:\/\/localhost:4000\/v1\/payments\/checkout\/[A-Za-z0-9_-]{43}\?label=WeVid&message=/
    );
    expect(body.checkoutUrl).toMatch(
      /^http:\/\/localhost:4000\/v1\/payments\/checkout\/[A-Za-z0-9_-]{43}$/
    );
    expect(body.qrDataUrl).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(recordedRequests[0]?.publicTransactionRequestUrl).toBe(body.transactionRequestUrl);
    expect(recordedRequests[0]?.storedTransactionRequestUrl).toContain("/redacted?");
    expect(recordedRequests[0]?.checkoutTokenHash).toMatch(/^[a-f0-9]{64}$/);

    const walletMetadata = await app.inject({
      method: "GET",
      url: new URL(body.checkoutUrl).pathname
    });
    expect(walletMetadata.statusCode).toBe(200);
    expect(walletMetadata.json()).toEqual({
      label: "WeVid",
      icon: "http://localhost:3000/favicon.ico"
    });

    await app.close();
    vi.unstubAllEnvs();
  });

  it("requires and records explicit checkout consent before minting a wallet capability", async () => {
    vi.stubEnv("PAYMENT_PLATFORM_TREASURY_WALLET", treasuryWallet);
    const withoutConsent: StoredPaymentIntent = {
      ...storedPaymentIntent,
      refundPolicy: {
        ...storedPaymentIntent.refundPolicy,
        withdrawalWaiverAcceptedAt: null
      },
      withdrawalWaiverAcceptedAt: null
    };
    let consentRecorded = false;
    const paymentRepository: PaymentRepository = {
      ...checkoutPaymentRepositoryMethods,
      async createOrReuseIntent() {
        throw new Error("not implemented");
      },
      async findIntent() {
        return withoutConsent;
      },
      async acceptCheckoutTerms(input) {
        expect(input).toMatchObject({
          paymentIntentId: storedPaymentIntent.id,
          idempotencyKey: "checkout-consent-1",
          termsVersion: storedPaymentIntent.termsVersion,
          withdrawalWaiverVersion: storedPaymentIntent.withdrawalWaiverVersion,
          immediateAccessAcknowledged: true
        });
        consentRecorded = true;
        return storedPaymentIntent;
      },
      async recordTransactionRequest() {
        throw new Error("must not mint before consent");
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
      paymentRepository
    });
    await app.ready();

    const blocked = await app.inject({
      method: "GET",
      url: `/v1/payments/intents/${storedPaymentIntent.id}/transaction-request`,
      headers: { authorization: "Bearer valid-token" }
    });
    expect(blocked.statusCode).toBe(409);

    const consent = await app.inject({
      method: "POST",
      url: `/v1/payments/intents/${storedPaymentIntent.id}/consent`,
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "checkout-consent-1"
      },
      payload: {
        termsVersion: storedPaymentIntent.termsVersion,
        withdrawalWaiverVersion: storedPaymentIntent.withdrawalWaiverVersion,
        immediateAccessAcknowledged: true
      }
    });
    expect(consent.statusCode).toBe(200);
    expect(consentRecorded).toBe(true);
    expect(consent.json()).toMatchObject({
      id: storedPaymentIntent.id,
      refundPolicy: { withdrawalWaiverAcceptedAt: "2026-06-04T23:00:00.000Z" }
    });

    consentRecorded = false;
    const invalidConsent = await app.inject({
      method: "POST",
      url: `/v1/payments/intents/${storedPaymentIntent.id}/consent`,
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "checkout-consent-invalid"
      },
      payload: {
        termsVersion: storedPaymentIntent.termsVersion,
        withdrawalWaiverVersion: storedPaymentIntent.withdrawalWaiverVersion
      }
    });
    expect(invalidConsent.statusCode).toBe(400);
    expect(consentRecorded).toBe(false);

    await app.close();
    vi.unstubAllEnvs();
  });

  it("records a payment submission and confirms only verified settlement", async () => {
    vi.stubEnv("PAYMENT_PLATFORM_TREASURY_WALLET", treasuryWallet);
    const submissions: RecordPaymentSubmissionInput[] = [];
    const settlementInputs: PaymentSettlementInput[] = [];
    const paymentRepository: PaymentRepository = {
      ...checkoutPaymentRepositoryMethods,
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
      async verifyTransfer(input) {
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
        memo: `veel:${storedPaymentIntent.id}`,
        settlementKind: "creator_split",
        buyerWallet: null,
        creatorWallet,
        enterpriseWallet: null,
        platformFeeWallet,
        referralWallet: null,
        treasuryWallet,
        totalAmountMinor: storedPaymentIntent.totalAmountMinor,
        creatorAmountMinor: storedPaymentIntent.creatorAmountMinor,
        enterpriseManagementAmountMinor: storedPaymentIntent.enterpriseManagementAmountMinor,
        platformFeeAmountMinor: storedPaymentIntent.platformFeeAmountMinor,
        referralAmountMinor: storedPaymentIntent.referralAmountMinor,
        currency: "SOL",
        tokenMint: null,
        tokenDecimals: null,
        expiresAt: storedPaymentIntent.expiresAt
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
      ...checkoutPaymentRepositoryMethods,
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
      async verifyTransfer(input) {
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
        memo: `veel:${storedPaymentIntent.id}`,
        settlementKind: "creator_split",
        buyerWallet: null,
        creatorWallet,
        enterpriseWallet: null,
        platformFeeWallet,
        referralWallet: null,
        treasuryWallet,
        totalAmountMinor: storedPaymentIntent.totalAmountMinor,
        creatorAmountMinor: storedPaymentIntent.creatorAmountMinor,
        enterpriseManagementAmountMinor: storedPaymentIntent.enterpriseManagementAmountMinor,
        platformFeeAmountMinor: storedPaymentIntent.platformFeeAmountMinor,
        referralAmountMinor: storedPaymentIntent.referralAmountMinor,
        currency: "SOL",
        tokenMint: null,
        tokenDecimals: null,
        expiresAt: storedPaymentIntent.expiresAt
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
      ...checkoutPaymentRepositoryMethods,
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
        async onReserveRoom(input) {
          repositoryCreates.push(input.title);
          return liveRoomFixture({
            id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa10",
            title: input.title,
            providerStreamId: null,
            providerPlaybackId: null,
            hostIngestUrl: null,
            hostStreamKey: null,
            requestHash: input.requestHash
          });
        },
        async onAttachProviderRoom(input) {
          return liveRoomFixture({
            id: input.roomId,
            title: "Friday live room",
            providerStreamId: input.providerRoom.providerStreamId,
            providerPlaybackId: input.providerRoom.providerPlaybackId,
            hostIngestUrl: input.providerRoom.hostIngestUrl,
            hostStreamKey: input.providerRoom.hostStreamKey
          });
        },
        async onFindOwnedRoomByIdempotency() {
          return null;
        }
      }),
      liveProvider: {
        ...noopLiveProviderControls,
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
        sfwAttestation: "this_live_stream_is_sfw",
        accessMode: "paid_event",
        previewSeconds: 45,
        eventPriceMinor: 75000000,
        replayWindowHours: 72
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
    expect(providerCreates).toEqual([
      { roomId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa10", title: "Friday live room" }
    ]);
    expect(repositoryCreates).toEqual(["Friday live room"]);

    await app.close();
  });

  it("reserves a live room before provider creation and avoids provider attachment on failure", async () => {
    const repositoryReservations: string[] = [];
    const providerCreates: Array<{ roomId: string; title: string }> = [];
    const providerAttachments: string[] = [];
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      sessionRepository: appReadySessionRepository,
      ageRepository: verifiedAgeRepository,
      walletRepository: walletRepositoryWithWallet,
      liveRepository: fakeLiveRepository({
        async onReserveRoom(input) {
          repositoryReservations.push(input.title);
          return liveRoomFixture({
            id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa19",
            title: input.title,
            providerStreamId: null,
            providerPlaybackId: null,
            hostIngestUrl: null,
            hostStreamKey: null,
            requestHash: input.requestHash
          });
        },
        async onAttachProviderRoom(input) {
          providerAttachments.push(input.roomId);
          return null;
        },
        async onFindOwnedRoomByIdempotency() {
          return null;
        }
      }),
      liveProvider: {
        ...noopLiveProviderControls,
        isConfigured: () => true,
        async createRoom(input) {
          providerCreates.push(input);
          throw new LiveProviderConfigurationError();
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
        "idempotency-key": "live-room-create-fail-1"
      },
      payload: {
        title: "Provider fail room",
        sfwAttestation: "this_live_stream_is_sfw",
        accessMode: "paid_event",
        previewSeconds: 45,
        eventPriceMinor: 75000000
      }
    });

    expect(response.statusCode).toBe(503);
    expect(repositoryReservations).toEqual(["Provider fail room"]);
    expect(providerCreates).toEqual([
      { roomId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa19", title: "Provider fail room" }
    ]);
    expect(providerAttachments).toEqual([]);

    await app.close();
  });

  it("suspends then terminates an unattached provider room when database attachment fails", async () => {
    const providerControls: string[] = [];
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      sessionRepository: appReadySessionRepository,
      ageRepository: verifiedAgeRepository,
      walletRepository: walletRepositoryWithWallet,
      liveRepository: fakeLiveRepository({
        async onReserveRoom(input) {
          return liveRoomFixture({
            id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa39",
            providerStreamId: null,
            providerPlaybackId: null,
            hostIngestUrl: null,
            hostStreamKey: null,
            requestHash: input.requestHash
          });
        },
        async onAttachProviderRoom() {
          return null;
        },
        async onFindOwnedRoomByIdempotency() {
          return null;
        }
      }),
      liveProvider: {
        isConfigured: () => true,
        async createRoom() {
          return {
            provider: "livepeer" as const,
            providerStreamId: "provider-orphan-39",
            providerPlaybackId: "playback-orphan-39",
            providerState: "waiting" as const,
            playbackUrl: "https://livepeercdn.studio/hls/playback-orphan-39/index.m3u8",
            hostIngestUrl: "rtmp://rtmp.livepeer.com/live",
            hostStreamKey: "secret"
          };
        },
        async getRoomStatus() {
          throw new Error("not implemented");
        },
        async createPlaybackJwt() {
          return null;
        },
        async setRoomSuspended(input) {
          providerControls.push(`suspend:${input.providerStreamId}`);
        },
        async terminateRoom(input) {
          providerControls.push(`terminate:${input.providerStreamId}`);
        }
      }
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/v1/live/rooms",
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "live-room-attach-fail-1"
      },
      payload: {
        title: "Unattached provider room",
        sfwAttestation: "this_live_stream_is_sfw"
      }
    });

    expect(response.statusCode).toBe(503);
    expect(providerControls).toEqual([
      "suspend:provider-orphan-39",
      "terminate:provider-orphan-39"
    ]);
    await app.close();
  });

  it("allows only one provider creation claimant for an idempotent live room", async () => {
    let providerCreateCount = 0;
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      sessionRepository: appReadySessionRepository,
      ageRepository: verifiedAgeRepository,
      walletRepository: walletRepositoryWithWallet,
      liveRepository: fakeLiveRepository({
        async onReserveRoom(input) {
          return liveRoomFixture({
            id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa29",
            providerStreamId: null,
            providerPlaybackId: null,
            requestHash: input.requestHash
          });
        },
        async onClaimProviderCreation() {
          return false;
        },
        async onFindOwnedRoomByIdempotency() {
          return null;
        }
      }),
      liveProvider: {
        ...noopLiveProviderControls,
        isConfigured: () => true,
        async createRoom() {
          providerCreateCount += 1;
          throw new Error("must not run");
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
        "idempotency-key": "live-room-claim-conflict-1"
      },
      payload: {
        title: "Claimed room",
        sfwAttestation: "this_live_stream_is_sfw"
      }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ message: "Live room setup is already in progress" });
    expect(providerCreateCount).toBe(0);
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

  it("reveals creator OBS credentials only through the recent-auth audited route", async () => {
    const reveals: unknown[] = [];
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      sessionRepository: appReadySessionRepository,
      ageRepository: verifiedAgeRepository,
      walletRepository: walletRepositoryWithWallet,
      liveRepository: fakeLiveRepository({
        async onRevealHostConnection(input) {
          reveals.push(input);
          return {
            provider: "livepeer",
            ingestUrl: "rtmp://rtmp.livepeer.com/live",
            streamKey: "creator-secret-key",
            securityNotice: "never_share_or_store_this_stream_key"
          };
        }
      })
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/v1/live/rooms/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa11/host-connection/reveal",
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "live-host-reveal-1"
      },
      payload: { acknowledgement: "i_understand_stream_keys_are_secrets" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store, max-age=0");
    expect(response.json()).toEqual({
      provider: "livepeer",
      ingestUrl: "rtmp://rtmp.livepeer.com/live",
      streamKey: "creator-secret-key",
      securityNotice: "never_share_or_store_this_stream_key"
    });
    expect(reveals).toHaveLength(1);
    expect(reveals[0]).toMatchObject({
      roomId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa11",
      idempotencyKey: "live-host-reveal-1"
    });
    await app.close();
  });

  it("rejects OBS credential reveal when authentication is no longer recent", async () => {
    let revealCalled = false;
    const app = await buildApi({
      authVerifier: {
        async verifyToken(token) {
          const verified = await fakeAuthVerifier.verifyToken(token);
          return verified
            ? { ...verified, authenticatedAt: new Date(Date.now() - 20 * 60 * 1000) }
            : null;
        }
      },
      sessionRepository: appReadySessionRepository,
      ageRepository: verifiedAgeRepository,
      walletRepository: walletRepositoryWithWallet,
      liveRepository: fakeLiveRepository({
        async onRevealHostConnection() {
          revealCalled = true;
          return null;
        }
      })
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/v1/live/rooms/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa11/host-connection/reveal",
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "live-host-reveal-stale-1"
      },
      payload: { acknowledgement: "i_understand_stream_keys_are_secrets" }
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: "recent_authentication_required" });
    expect(revealCalled).toBe(false);
    await app.close();
  });

  it("ends creator live rooms locally before terminating the provider stream", async () => {
    const calls: string[] = [];
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      sessionRepository: appReadySessionRepository,
      ageRepository: verifiedAgeRepository,
      walletRepository: walletRepositoryWithWallet,
      liveRepository: fakeLiveRepository({
        async onReserveOwnedControl() {
          calls.push("reserve");
          return {
            id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa41",
            roomId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa12",
            action: "creator_ended",
            state: "pending",
            providerStreamId: "provider-stream-12"
          };
        },
        async onCompleteControl(input) {
          calls.push(`complete:${input.state}:${input.providerState}`);
        }
      }),
      liveProvider: {
        ...noopLiveProviderControls,
        isConfigured: () => true,
        async createRoom() {
          throw new Error("not implemented");
        },
        async getRoomStatus() {
          throw new Error("not implemented");
        },
        async createPlaybackJwt() {
          return null;
        },
        async terminateRoom(input) {
          calls.push(`terminate:${input.providerStreamId}`);
        }
      }
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/v1/live/rooms/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa12/end",
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "live-end-room-1"
      }
    });

    expect(response.statusCode).toBe(202);
    expect(calls).toEqual([
      "reserve",
      "terminate:provider-stream-12",
      "complete:ended:terminated"
    ]);
    await app.close();
  });

  it("applies staff live suspension through canonical and provider controls", async () => {
    const calls: string[] = [];
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      adminRepository: fakeAdminRepository,
      liveRepository: fakeLiveRepository({
        async onReserveStaffControl(input) {
          calls.push(`reserve:${input.action}:${input.reason}`);
          return {
            id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa42",
            roomId: input.roomId,
            action: input.action,
            state: "pending",
            providerStreamId: "provider-stream-13"
          };
        },
        async onCompleteControl(input) {
          calls.push(`complete:${input.state}:${input.providerState}`);
        }
      }),
      liveProvider: {
        ...noopLiveProviderControls,
        isConfigured: () => true,
        async createRoom() {
          throw new Error("not implemented");
        },
        async getRoomStatus() {
          throw new Error("not implemented");
        },
        async createPlaybackJwt() {
          return null;
        },
        async setRoomSuspended(input) {
          calls.push(`provider:${input.suspended}:${input.providerStreamId}`);
        }
      }
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/v1/admin/live/rooms/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa13/suspension",
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "admin-live-suspend-1"
      },
      payload: { suspended: true, reason: "Safety review" }
    });

    expect(response.statusCode).toBe(202);
    expect(calls).toEqual([
      "reserve:staff_suspended:Safety review",
      "provider:true:provider-stream-13",
      "complete:suspended:suspended"
    ]);
    await app.close();
  });

  it("returns signed Livepeer playback only when backend access is allowed", async () => {
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
        ...noopLiveProviderControls,
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
            appUserId: "00000000-0000-4000-8000-000000000010"
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
      url: "https://livepeercdn.studio/hls/livepeer-playback-15/index.m3u8",
      provider: "livepeer",
      resourceType: "hls",
      jwt: "livepeer.jwt.token"
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
        ...noopLiveProviderControls,
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

  it("creates one server-priced live event access intent and records the purchase request", async () => {
    vi.stubEnv("PAYMENT_PLATFORM_TREASURY_WALLET", treasuryWallet);
    const paymentCreates: StoredPaymentIntent[] = [];
    const passRequests: Array<{ paymentIntentId: string; amountMinor: number }> = [];
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
            accessMode: "paid_event",
            accessState: "event_access_required",
            playbackUrl: "https://livepeercdn.studio/hls/playback-12/index.m3u8"
          });
        },
        async onRecordLivePassPurchaseRequest(input) {
          passRequests.push({
            paymentIntentId: input.paymentIntentId,
            amountMinor: input.amountMinor
          });
        }
      }),
      paymentRepository: {
        ...checkoutPaymentRepositoryMethods,
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
      url: "/v1/live/rooms/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa12/event-access-intents",
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "live-event-access-intent-1"
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa50",
      productType: "live_pass",
      amountMinor: 50000000
    });
    expect(paymentCreates[0]?.productType).toBe("live_pass");
    expect(passRequests).toEqual([
      { paymentIntentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa50", amountMinor: 50000000 }
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
        ...noopLiveProviderControls,
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
        "idempotency-key": "live-sync-01"
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
        "idempotency-key": "live-chat-01"
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
    const createdInputs: Array<{ body: string; idempotencyKey: string }> = [];
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      sessionRepository: appReadySessionRepository,
      ageRepository: verifiedAgeRepository,
      walletRepository: walletRepositoryWithWallet,
      messageRepository: fakeMessageRepository({
        async onCreateMessage(input) {
          createdInputs.push({ body: input.body, idempotencyKey: input.idempotencyKey });
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
    expect(createdInputs).toEqual([
      { body: "Hello from Veel", idempotencyKey: "message-create-1" }
    ]);

    await app.close();
  });

  it("rejects normal message idempotency-key reuse with changed input", async () => {
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      sessionRepository: appReadySessionRepository,
      ageRepository: verifiedAgeRepository,
      walletRepository: walletRepositoryWithWallet,
      messageRepository: fakeMessageRepository({
        async onCreateMessage() {
          throw new MessageIdempotencyConflictError();
        }
      })
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/v1/messages/conversations/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaab11/messages",
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "message-conflict-1"
      },
      payload: { body: "Changed message" }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: "conflict" });

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
        ...checkoutPaymentRepositoryMethods,
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
      nsfwPreference: "both"
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
    const malformedCommentCursorResponse = await app.inject({
      method: "GET",
      url: "/v1/engagement/00000000-0000-4000-8000-000000000040/comments?cursor=not-a-date",
      headers: { authorization: "Bearer valid-token" }
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
    expect(malformedCommentCursorResponse.statusCode).toBe(400);
    expect(malformedCommentCursorResponse.json()).toEqual({
      code: "validation_failed",
      message: "cursor must be an ISO timestamp"
    });
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

  it("reads and mutates the canonical follow graph and records feed impressions", async () => {
    const calls: Array<{ kind: string; input: unknown }> = [];
    const targetUserId = "00000000-0000-4000-8000-000000000011";
    const contentId = "00000000-0000-4000-8000-000000000040";
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      sessionRepository: appReadySessionRepository,
      ageRepository: verifiedAgeRepository,
      engagementRepository: fakeEngagementRepository({
        async onGetFollowState(input) {
          calls.push({ kind: "read", input });
        },
        async onSetFollowState(input) {
          calls.push({ kind: input.following ? "follow" : "unfollow", input });
        },
        async onRecordFeedImpression(input) {
          calls.push({ kind: "impression", input });
        }
      })
    });
    await app.ready();

    const read = await app.inject({
      method: "GET",
      url: `/v1/follows/${targetUserId}`,
      headers: { authorization: "Bearer valid-token" }
    });
    const follow = await app.inject({
      method: "POST",
      url: `/v1/follows/${targetUserId}`,
      headers: { authorization: "Bearer valid-token", "idempotency-key": "follow-command-1" }
    });
    const unfollow = await app.inject({
      method: "DELETE",
      url: `/v1/follows/${targetUserId}`,
      headers: { authorization: "Bearer valid-token", "idempotency-key": "unfollow-command-1" }
    });
    const impression = await app.inject({
      method: "POST",
      url: "/v1/feed/impressions",
      headers: { authorization: "Bearer valid-token", "idempotency-key": "impression-1" },
      payload: { contentId }
    });

    expect(read.statusCode).toBe(200);
    expect(follow.statusCode).toBe(200);
    expect(follow.json().following).toBe(true);
    expect(unfollow.statusCode).toBe(200);
    expect(unfollow.json().following).toBe(false);
    expect(impression.statusCode).toBe(202);
    expect(calls).toMatchObject([
      { kind: "read", input: { targetUserId } },
      { kind: "follow", input: { targetUserId, following: true, idempotencyKey: "follow-command-1" } },
      { kind: "unfollow", input: { targetUserId, following: false, idempotencyKey: "unfollow-command-1" } },
      { kind: "impression", input: { body: { contentId }, idempotencyKey: "impression-1" } }
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

  it("returns backend-owned platform tier capabilities and allowance state", async () => {
    const calls: unknown[] = [];
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      sessionRepository: appReadySessionRepository,
      ageRepository: verifiedAgeRepository,
      walletRepository: walletRepositoryWithWallet,
      subscriptionRepository: fakeSubscriptionRepository({
        async onGetPlatformAccess(input) {
          calls.push(input);
          return platformAccessFixture();
        }
      })
    });
    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: "/v1/platform-access",
      headers: { authorization: "Bearer valid-token" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      currentTier: {
        key: "free_verified",
        publicMediaAllowanceSeconds: 72000,
        purchaseState: "included"
      },
      usage: {
        publicMediaSeconds: 0,
        remainingPublicMediaSeconds: 72000,
        limitReached: false
      },
      policyBoundary: "platform_tiers_buy_software_and_public_media_allowance_never_social_priority"
    });
    expect(calls).toEqual([
      { supabaseUserId: "00000000-0000-4000-8000-000000000001" }
    ]);

    await app.close();
  });

  it("creates and advances idempotent public-media playback accounting sessions", async () => {
    const calls: Array<{ kind: string; input: unknown }> = [];
    const app = await buildApi({
      authVerifier: fakeAuthVerifier,
      sessionRepository: appReadySessionRepository,
      ageRepository: verifiedAgeRepository,
      walletRepository: walletRepositoryWithWallet,
      subscriptionRepository: fakeSubscriptionRepository({
        async onCreatePlatformPlaybackSession(input) {
          calls.push({ kind: "start", input });
          return platformPlaybackSessionFixture();
        },
        async onRecordPlatformPlaybackHeartbeat(input) {
          calls.push({ kind: "heartbeat", input });
          return platformPlaybackSessionFixture({ consumedSeconds: 15 });
        }
      })
    });
    await app.ready();

    const start = await app.inject({
      method: "POST",
      url: "/v1/platform-usage/playback-sessions",
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "playback-start-1"
      },
      payload: {
        targetType: "content",
        targetId: "00000000-0000-4000-8000-000000000040"
      }
    });
    expect(start.statusCode).toBe(201);

    const heartbeat = await app.inject({
      method: "POST",
      url: "/v1/platform-usage/playback-sessions/00000000-0000-4000-8000-000000000085/heartbeats",
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "playback-heartbeat-1"
      },
      payload: { sequence: 1, playedSeconds: 15 }
    });
    expect(heartbeat.statusCode).toBe(200);
    expect(heartbeat.json()).toMatchObject({ consumedSeconds: 15, state: "active" });
    expect(calls.map((call) => call.kind)).toEqual(["start", "heartbeat"]);

    await app.close();
  });

  it("creates delegated subscription intents and keeps activation behind backend verification", async () => {
    vi.stubEnv("SUBSCRIPTIONS_ENABLED", "true");
    vi.stubEnv("SUBSCRIPTIONS_PROVIDER", "official_solana_subscription_program");
    vi.stubEnv("SUBSCRIPTIONS_SOLANA_PROGRAM_ID", "De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44");
    vi.stubEnv("SUBSCRIPTIONS_SOLANA_RPC_URL", "https://api.devnet.solana.com");
    vi.stubEnv("SUBSCRIPTIONS_SUPPORTED_MINTS", "USDC_MINT_CONFIG_REQUIRED");
    vi.stubEnv("SUBSCRIPTIONS_DEFAULT_MINT", "USDC_MINT_CONFIG_REQUIRED");
    vi.stubEnv("SUBSCRIPTIONS_COLLECTOR_WALLET", "11111111111111111111111111111111");
    vi.stubEnv("SUBSCRIPTIONS_MERCHANT_WALLET", "11111111111111111111111111111111");
    vi.stubEnv("SUBSCRIPTIONS_REQUIRE_ONCHAIN_VERIFICATION", "true");
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
            authorityAddress: null,
            delegationAddress: null
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
          verification: { verified: false, failureCode: "provider_not_configured" }
        }
      }
    ]);

    await app.close();
    vi.unstubAllEnvs();
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

class TestRateLimitStore {
  constructor(_options: unknown) {}

  incr(_key: string, callback: (error: Error | null, result?: { current: number; ttl: number }) => void) {
    callback(null, { current: 1, ttl: 60_000 });
  }

  child() {
    return this;
  }
}

class FailingRateLimitStore extends TestRateLimitStore {
  override incr(_key: string, callback: (error: Error | null) => void) {
    callback(new Error("rate-limit store unavailable"));
  }
}

const noopLiveProviderControls = {
  async setRoomSuspended() {},
  async terminateRoom() {}
};

const fakeAuthVerifier: ApplicationSessionVerifier = {
  async verifyToken(token: string): Promise<VerifiedApplicationSession | null> {
    if (token !== "valid-token") {
      return null;
    }

    return {
      userId: "00000000-0000-4000-8000-000000000001",
      supabaseUserId: "00000000-0000-4000-8000-000000000001",
      sessionId: "00000000-0000-4000-8000-000000000099",
      authenticatedAt: new Date(),
      authenticationMethod: "wallet"
    };
  }
};

function fakeWalletAuthRepository(
  overrides: Partial<WalletAuthRepository> = {}
): WalletAuthRepository {
  return {
    async createChallenge() {
      throw new Error("not implemented");
    },
    async findChallenge() {
      throw new Error("not implemented");
    },
    async createSessionFromChallenge() {
      throw new Error("not implemented");
    },
    async createRecoveryLinkIntent() {
      throw new Error("not implemented");
    },
    async exchangeRecoveryIdentity() {
      throw new Error("not implemented");
    },
    async unlinkRecoveryIdentity() {
      throw new Error("not implemented");
    },
    async rotateSessionToken() {
      throw new Error("not implemented");
    },
    async revokeAllSessions() {
      throw new Error("not implemented");
    },
    async revokeSessionToken() {
      throw new Error("not implemented");
    },
    async verifySessionToken() {
      throw new Error("not implemented");
    },
    ...overrides
  };
}

function rotatingWalletAuthRepository() {
  return fakeWalletAuthRepository({
    async rotateSessionToken() {
      return {
        accessToken: "wevid_session_rotated",
        expiresAt: new Date(Date.now() + 60_000)
      };
    }
  });
}

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
  async applyProviderWebhook() {
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
  async applyProviderWebhook() {
    throw new Error("not implemented");
  },
  async updateVerificationFromWebhook() {
    throw new Error("not implemented");
  }
};

const pendingAgeSessionRepository: AgeRepository = {
  async findLatestAgeStatusBySupabaseUserId() {
    return {
      state: "required",
      provider: null
    };
  },
  async createPendingAgeVerification() {
    return undefined;
  },
  async applyProviderWebhook() {
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

function diditV2Signature(payload: unknown): string {
  return createHmac("sha256", "didit-webhook-secret").update(testCanonicalJson(payload)).digest("hex");
}

function personaSignature(timestamp: string, payload: string): string {
  const signature = createHmac("sha256", "persona-webhook-secret").update(`${timestamp}.${payload}`).digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

function testCanonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => testCanonicalJson(item)).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${testCanonicalJson(record[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
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

function contentRepositoryWithDetail(item: ContentItem): ContentRepository {
  return {
    async createDraft() {
      throw new Error("not implemented");
    },
    async createMediaAsset() {
      throw new Error("not implemented");
    },
    async findContentDetail() {
      return item;
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
}

const treasuryWallet = "1".repeat(32);
const creatorWallet = "2".repeat(32);
const platformFeeWallet = "3".repeat(32);
const validSolanaSignature =
  "5Pj5fCupXLUePYn18JkY8SrRaWFiUctuDTRwvUy2MLgVFG1FsCeezrWwZsmxkL5YJQFmQpAcY7rc5pN6vrXJt7Qp";

const storedPaymentIntent: StoredPaymentIntent = {
  id: "00000000-0000-4000-8000-000000000050",
  productType: "support",
  targetId: "00000000-0000-4000-8000-000000000010",
  amountMinor: 10000000,
  currency: "SOL",
  state: "pending",
  referenceAddress: `${"1".repeat(31)}2`,
  treasuryWallet,
  settlementKind: "creator_split",
  buyerWallet: null,
  creatorWallet,
  enterpriseWallet: null,
  platformFeeWallet,
  referralWallet: null,
  totalAmountMinor: 10000000,
  creatorSideProceedsMinor: 9000000,
  creatorAmountMinor: 9000000,
  enterpriseManagementAmountMinor: 0,
  platformFeeGrossMinor: 1000000,
  platformFeeAmountMinor: 1000000,
  referralAmountMinor: 0,
  solanaCluster: "devnet",
  expiresAt: new Date("2099-07-04T23:15:00.000Z"),
  requestHash: "request-hash",
  refundPolicy: {
    withdrawalWaiverRequired: true,
    withdrawalWaiverAcceptedAt: "2026-06-04T23:00:00.000Z",
    withdrawalWaiverVersion: "instant-digital-access-v1",
    termsVersion: "veel-terms-v1",
    durableConfirmationRequired: true,
    refundValueBasis: "manual_resolution"
  },
  withdrawalWaiverRequired: true,
  withdrawalWaiverAcceptedAt: new Date("2026-06-04T23:00:00.000Z"),
  withdrawalWaiverVersion: "instant-digital-access-v1",
  termsVersion: "veel-terms-v1",
  durableConfirmationRequired: true,
  refundValueBasis: "manual_resolution"
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
    safetyState: overrides.safetyState ?? (state === "live" ? "monitoring" : "approved"),
    accessMode: overrides.accessMode ?? "paid_event",
    accessState: overrides.accessState ?? (hasPass ? "allowed" : "event_access_required"),
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
    previewSecondsRemaining: hasPass ? null : 60,
    eventAccess:
      overrides.eventAccess ?? {
        amountMinor: 50000000,
        currency: "SOL",
        replayWindowHours: 48,
        membersIncluded: false
      },
    chat: {
      enabled: state === "live",
      accessState: state === "live" ? (hasPass ? "allowed" : "members_only") : "closed"
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
    onReserveRoom: LiveRepository["reserveRoom"];
    onClaimProviderCreation: LiveRepository["claimProviderCreation"];
    onAttachProviderRoom: LiveRepository["attachProviderRoom"];
    onFindRoom: LiveRepository["findRoom"];
    onFindOwnedRoom: LiveRepository["findOwnedRoom"];
    onFindOwnedRoomByIdempotency: LiveRepository["findOwnedRoomByIdempotency"];
    onRevealHostConnection: LiveRepository["revealHostConnection"];
    onReserveOwnedControl: LiveRepository["reserveOwnedControl"];
    onReserveStaffControl: LiveRepository["reserveStaffControl"];
    onCompleteControl: LiveRepository["completeControl"];
    onFailControl: LiveRepository["failControl"];
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
    async reserveRoom(input) {
      return overrides.onReserveRoom?.(input) ?? liveRoomFixture({ id: input.idempotencyKey });
    },
    async claimProviderCreation(input) {
      return overrides.onClaimProviderCreation?.(input) ?? true;
    },
    async attachProviderRoom(input) {
      return overrides.onAttachProviderRoom?.(input) ?? liveRoomFixture({ id: input.roomId });
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
    async listOwnedRooms() {
      return { items: [], nextCursor: null };
    },
    async revealHostConnection(input) {
      return overrides.onRevealHostConnection?.(input) ?? null;
    },
    async reserveOwnedControl(input) {
      return overrides.onReserveOwnedControl?.(input) ?? null;
    },
    async reserveStaffControl(input) {
      return overrides.onReserveStaffControl?.(input) ?? null;
    },
    async completeControl(input) {
      await overrides.onCompleteControl?.(input);
    },
    async failControl(input) {
      await overrides.onFailControl?.(input);
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
    description: overrides.description ?? null,
    benefits: overrides.benefits ?? [],
    amountMinor: overrides.amountMinor ?? 15000000,
    currency: overrides.currency ?? "USDC",
    periodDays: overrides.periodDays ?? 30,
    billingMode: overrides.billingMode ?? "delegated_solana_subscription",
    providerState: overrides.providerState ?? "staging_required",
    provider: overrides.provider ?? "official_solana_subscription_program",
    tokenMint: overrides.tokenMint ?? "USDC_MINT_CONFIG_REQUIRED",
    tokenProgram: overrides.tokenProgram ?? "spl_token",
    programId: overrides.programId ?? "De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44",
    planPda: overrides.planPda ?? null,
    merchantWallet: overrides.merchantWallet ?? null,
    amountAtomic: overrides.amountAtomic ?? overrides.amountMinor ?? 15000000,
    periodSeconds: overrides.periodSeconds ?? 30 * 86_400
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
    delegationAddress: overrides.delegationAddress ?? null,
    subscriberWallet: overrides.subscriberWallet ?? null,
    subscriberTokenAccount: overrides.subscriberTokenAccount ?? null,
    tokenMint: overrides.tokenMint ?? null,
    provider: overrides.provider ?? null,
    programId: overrides.programId ?? null,
    planPda: overrides.planPda ?? null,
    subscriptionPda: overrides.subscriptionPda ?? null,
    failureReason: overrides.failureReason ?? null
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
    onGetPlatformAccess: NonNullable<SubscriptionRepository["getPlatformAccess"]>;
    onGetPlatformPlaybackDecision: NonNullable<SubscriptionRepository["getPlatformPlaybackDecision"]>;
    onCreatePlatformPlaybackSession: NonNullable<SubscriptionRepository["createPlatformPlaybackSession"]>;
    onRecordPlatformPlaybackHeartbeat: NonNullable<SubscriptionRepository["recordPlatformPlaybackHeartbeat"]>;
    onListPlans: SubscriptionRepository["listPlans"];
    onListSubscriptions: SubscriptionRepository["listSubscriptions"];
    onCreateAuthorizationIntent: SubscriptionRepository["createAuthorizationIntent"];
    onSubmitAuthorization: SubscriptionRepository["submitAuthorization"];
    onCancel: SubscriptionRepository["cancel"];
  }> = {}
): SubscriptionRepository {
  return {
    async getPlatformAccess(input) {
      return overrides.onGetPlatformAccess?.(input) ?? platformAccessFixture();
    },
    async getPlatformPlaybackDecision(input) {
      return overrides.onGetPlatformPlaybackDecision?.(input) ?? {
        countsTowardAllowance: false,
        limitReached: false
      };
    },
    async createPlatformPlaybackSession(input) {
      return overrides.onCreatePlatformPlaybackSession?.(input) ?? platformPlaybackSessionFixture();
    },
    async recordPlatformPlaybackHeartbeat(input) {
      return overrides.onRecordPlatformPlaybackHeartbeat?.(input) ?? platformPlaybackSessionFixture();
    },
    async listPlans(input) {
      return overrides.onListPlans?.(input) ?? { items: [subscriptionPlanFixture()] };
    },
    async listSubscriptions(input): Promise<SubscriptionPage> {
      return overrides.onListSubscriptions?.(input) ?? { items: [subscriptionFixture()] };
    },
    async getCreatorOffer() {
      return null;
    },
    async upsertCreatorOffer() {
      return subscriptionPlanFixture({ scope: "creator" });
    },
    async disableCreatorOffer() {
      return true;
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
        subscriberWallet: "11111111111111111111111111111111",
        authorityAddress: "11111111111111111111111111111111",
        delegationAddress: "11111111111111111111111111111111",
        subscriberTokenAccount: "11111111111111111111111111111111",
        tokenMint: "USDC_MINT_CONFIG_REQUIRED",
        tokenProgram: "spl_token",
        amountMinor: 15000000,
        amountAtomic: 15000000,
        periodDays: 30,
        periodSeconds: 2592000,
        delegationNonce: 0,
        delegationExpiresAt: new Date("2027-07-05T00:15:00.000Z"),
        provider: "official_solana_subscription_program",
        planId: "platform_plus_monthly",
        planPda: null,
        subscriptionPda: null,
        merchantWallet: null,
        expiresAt: new Date("2026-07-05T00:15:00.000Z")
      };
    },
    async recordAuthorizationTransactionFacts() {},
    async submitAuthorization(input) {
      return overrides.onSubmitAuthorization?.(input) ?? subscriptionFixture();
    },
    async cancel(input) {
      return overrides.onCancel?.(input) ?? subscriptionFixture({ id: input.subscriptionId });
    }
  };
}

function platformAccessFixture(): PlatformAccess {
  const currentTier: PlatformAccess["currentTier"] = {
    key: "free_verified",
    label: "Free Verified",
    rank: 0,
    monthlyPriceMinor: 0,
    currency: "USDC",
    publicMediaAllowanceSeconds: 72000,
    capabilities: ["social", "bits", "publish_sfw", "public_live", "buy", "support"],
    purchaseState: "included",
    subscriptionPlanId: null
  };

  return {
    currentTier,
    usage: {
      windowStartsAt: "2026-08-01T00:00:00.000Z",
      windowEndsAt: "2026-09-01T00:00:00.000Z",
      publicMediaSeconds: 0,
      remainingPublicMediaSeconds: 72000,
      limitReached: false
    },
    tiers: [currentTier],
    policyBoundary: "platform_tiers_buy_software_and_public_media_allowance_never_social_priority"
  };
}

function platformPlaybackSessionFixture(
  overrides: Partial<PlatformPlaybackSession> = {}
): PlatformPlaybackSession {
  return {
    id: overrides.id ?? "00000000-0000-4000-8000-000000000085",
    state: overrides.state ?? "active",
    heartbeatIntervalSeconds: overrides.heartbeatIntervalSeconds ?? 15,
    consumedSeconds: overrides.consumedSeconds ?? 0,
    usage: overrides.usage ?? platformAccessFixture().usage
  };
}

function fakeSubscriptionAuthorizationVerifier(verified: boolean): SubscriptionAuthorizationVerifier {
  return {
    async verifyAuthorization() {
      return verified
        ? { verified: true }
        : { verified: false, failureCode: "provider_not_configured" };
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
              remediationEvidenceCount: 0,
              latestRemediationEvidenceAt: null,
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
        remediationEvidenceCount: 0,
        latestRemediationEvidenceAt: null,
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
    onCreateDirectConversation: MessageRepository["createDirectConversation"];
    onRespondToMessageRequest: MessageRepository["respondToMessageRequest"];
    onMarkConversationRead: MessageRepository["markConversationRead"];
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
              counterpart: homeFeedItem.creator,
              requestState: "accepted",
              requestRole: "initiator",
              canSend: true,
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
    async createDirectConversation(input) {
      return overrides.onCreateDirectConversation?.(input) ?? {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaab10",
        type: "direct",
        title: "Maki",
        unreadCount: 0,
        counterpart: homeFeedItem.creator,
        requestState: "pending",
        requestRole: "initiator",
        canSend: true
      };
    },
    async respondToMessageRequest(input) {
      return overrides.onRespondToMessageRequest?.(input) ?? {
        id: input.conversationId,
        type: "direct",
        title: "Maki",
        unreadCount: 1,
        counterpart: homeFeedItem.creator,
        requestState: input.action === "accept" ? "accepted" : "declined",
        requestRole: "recipient",
        canSend: input.action === "accept"
      };
    },
    async markConversationRead(input) {
      return overrides.onMarkConversationRead?.(input) ?? {
        conversationId: input.conversationId,
        unreadCount: 0,
        readAt: "2026-06-04T23:50:00.000Z"
      };
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
  async verifyTransfer() {
    return {
      confirmed: false,
      failureCode: "not_found"
    };
  }
};

function fakeEngagementRepository(
  overrides: Partial<{
    onGetFeedPreferences: EngagementCallback<"getFeedPreferences">;
    onGetFollowState: EngagementCallback<"getFollowState">;
    onSetFollowState: EngagementCallback<"setFollowState">;
    onRecordFeedImpression: EngagementCallback<"recordFeedImpression">;
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
    async getFollowState(input) {
      await overrides.onGetFollowState?.(input);
      return { userId: input.targetUserId, following: false, followerCount: 0, followingCount: 0 };
    },
    async setFollowState(input) {
      await overrides.onSetFollowState?.(input);
      return { userId: input.targetUserId, following: input.following, followerCount: input.following ? 1 : 0, followingCount: 0 };
    },
    async recordFeedImpression(input) {
      await overrides.onRecordFeedImpression?.(input);
    },
    async getFeedPreferences(input) {
      await overrides.onGetFeedPreferences?.(input);
      return {
        defaultMode: "recommended",
        nsfwPreference: "both",
        hiddenCreatorIds: [],
        hiddenTopics: []
      };
    },
    async updateFeedPreferences(input) {
      await overrides.onUpdateFeedPreferences?.(input);
      return {
        defaultMode: input.body.defaultMode ?? "recommended",
        nsfwPreference: input.body.nsfwPreference ?? "both",
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
        nsfwPreference: "both",
        hiddenCreatorIds: [input.creatorUserId],
        hiddenTopics: []
      };
    },
    async hideTopic(input) {
      await overrides.onHideTopic?.(input);
      return {
        defaultMode: "recommended",
        nsfwPreference: "both",
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
  },
  async provisionOrganization() {
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
  | "provisionOrganization"
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
      workerQueues: [],
      openReports: 0,
      paymentCounts: { total: 1, pending: 0, submitted: 0, confirmed: 1, failed: 0 },
      unlockCounts: { total: 1, pending: 0, submitted: 0, confirmed: 1, failed: 0 },
      providerEventCounts: { total: 1, pending: 0, submitted: 0, confirmed: 1, failed: 0 },
      subscriptionCounts: { total: 0, pending: 0, submitted: 0, confirmed: 0, failed: 0 },
      subscriptionProviderReadiness: "staging_required",
      organizationCounts: { total: 1, pending: 0, submitted: 0, confirmed: 1, failed: 0 },
      managedCreatorCounts: { total: 1, pending: 0, submitted: 0, confirmed: 1, failed: 0 },
      enterpriseAllocationCounts: { total: 1, pending: 0, submitted: 0, confirmed: 1, failed: 0 }
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
      deadLetterDeliveryCount: 0,
      skippedDeliveryCount: 0,
      revokedDeliveryCount: 0,
      latestNotificationAt: "2026-06-06T10:00:00.000Z",
      latestDeviceSeenAt: "2026-06-06T10:01:00.000Z",
      latestDeliveryAt: "2026-06-06T10:02:00.000Z"
    };
  },
  async retryDeadLetterJob() {
    return true;
  },
  async listUsers() {
    return {
      items: [
        {
          id: "00000000-0000-4000-8000-000000000011",
          handle: "maki",
          state: "active",
          ageState: "verified",
          walletState: {
            connected: true,
            chain: "solana_devnet",
            address: "11111111111111111111111111111112"
          }
        }
      ],
      nextCursor: null
    };
  },
  async getUser(input) {
    return {
      id: input.userId,
      handle: "maki",
      state: "active",
      ageState: "verified",
      walletState: {
        connected: true,
        chain: "solana_devnet",
        address: "11111111111111111111111111111112"
      }
    };
  },
  async listContent() {
    return {
      items: [
        {
          id: "00000000-0000-4000-8000-000000000040",
          creator: {
            id: "00000000-0000-4000-8000-000000000010",
            handle: "creator",
            displayName: "Creator",
            avatarUrl: null,
            badges: []
          },
          moderationState: "pending",
          state: "ready"
        }
      ],
      nextCursor: null
    };
  },
  async updateContentModeration(input) {
    return {
      id: input.contentId,
      creator: {
        id: "00000000-0000-4000-8000-000000000010",
        handle: "creator",
        displayName: "Creator",
        avatarUrl: null,
        badges: []
      },
      moderationState: input.body.action === "block" ? "blocked" : "approved",
      state: input.body.action === "block" ? "blocked" : "ready"
    };
  },
  async listReports() {
    return {
      items: [
        {
          id: "00000000-0000-4000-8000-000000000190",
          subjectType: "content",
          subjectId: "00000000-0000-4000-8000-000000000040",
          state: "submitted",
          reason: "Unsafe content"
        }
      ],
      nextCursor: null
    };
  },
  async updateReport(input) {
    return {
      id: input.reportId,
      subjectType: "content",
      subjectId: "00000000-0000-4000-8000-000000000040",
      state: input.body.state,
      reason: "Unsafe content"
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
          processedAt: "2026-06-04T20:01:01.000Z",
          latestReplayState: "queued",
          latestReplayRequestedAt: "2026-06-04T20:02:00.000Z",
          latestReplayProcessedAt: null
        }
      ],
      nextCursor: null
    };
  },
  async enqueueProviderEventReplay(input) {
    return input.providerEventId === "00000000-0000-4000-8000-0000000000a0";
  },
  async listAuditEvents() {
    return {
      items: [
        {
          id: "00000000-0000-4000-8000-000000000180",
          subjectType: "feature_flag",
          action: "feature_flag_updated",
          createdAt: "2026-06-06T13:00:00.000Z"
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
          remediationEvidenceCount: 0,
          latestRemediationEvidenceAt: null,
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
      remediationEvidenceCount: input.body.remediationEvidence ? 1 : 0,
      latestRemediationEvidenceAt: input.body.remediationEvidence ? "2026-06-06T11:30:00.000Z" : null,
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
  async listDataRequests() {
    return {
      items: [
        {
          id: "00000000-0000-4000-8000-000000000170",
          requesterUserId: "00000000-0000-4000-8000-000000000011",
          type: "export",
          state: "requested",
          privacyBoundary: "sanitized_identity_minimized_no_raw_exports",
          createdAt: "2026-06-06T12:00:00.000Z",
          updatedAt: null,
          completedAt: null
        }
      ],
      nextCursor: null
    };
  },
  async updateDataRequest(input) {
    return {
      id: input.dataRequestId,
      requesterUserId: "00000000-0000-4000-8000-000000000011",
      type: "export",
      state: input.body.state,
      privacyBoundary: "sanitized_identity_minimized_no_raw_exports",
      createdAt: "2026-06-06T12:00:00.000Z",
      updatedAt: "2026-06-06T12:30:00.000Z",
      completedAt:
        input.body.state === "completed" || input.body.state === "rejected"
          ? "2026-06-06T12:30:00.000Z"
          : null
    };
  },
  async listEvents() {
    return {
      items: [
        {
          id: "00000000-0000-4000-8000-0000000000e1",
          title: "Creator live night",
          description: "Event Access test event",
          startsAt: "2026-06-10T20:00:00.000Z",
          endsAt: null,
          accessRule: "public_sale",
          location: { type: "digital_live_stream", label: "Veel Live" },
          state: "published",
          accessPassTypes: [
            {
              id: "00000000-0000-4000-8000-0000000000e2",
              label: "Access Pass",
              priceMinor: 10000000,
              currency: "SOL",
              capacity: 50,
              remaining: 49,
              state: "active",
              saleStartsAt: null,
              saleEndsAt: null,
              perUserLimit: 1
            }
          ]
        }
      ],
      nextCursor: null
    };
  },
  async listAccessPasses() {
    return {
      items: [
        {
          id: "00000000-0000-4000-8000-0000000000e3",
          eventId: "00000000-0000-4000-8000-0000000000e1",
          accessPassTypeId: "00000000-0000-4000-8000-0000000000e2",
          holderUserId: "00000000-0000-4000-8000-000000000011",
          paymentIntentId: "00000000-0000-4000-8000-000000000050",
          state: "active",
          qrToken: "veel_access_pass_redacted",
          checkedInAt: null,
          createdAt: "2026-06-06T14:00:00.000Z"
        }
      ],
      nextCursor: null
    };
  },
  async listLiveRooms() {
    return {
      items: [
        {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa10",
          creatorUserId: "00000000-0000-4000-8000-000000000010",
          title: "Studio live",
          provider: "livepeer",
          providerStreamId: "livepeer-stream-1",
          providerPlaybackId: "livepeer-playback-1",
          providerState: "active",
          state: "live",
          accessMode: "paid_event",
          eventPriceMinor: 50000000,
          currency: "SOL",
          membersOnlyChat: false,
          membersIncludedInPaidEvent: false,
          replayWindowHours: 48,
          hasPlaybackUrl: true,
          hasHostStreamKey: true,
          startsAt: "2026-06-06T15:00:00.000Z",
          endedAt: null,
          createdAt: "2026-06-06T14:00:00.000Z",
          updatedAt: "2026-06-06T15:01:00.000Z"
        }
      ],
      nextCursor: null
    };
  },
  async listMediaAssets() {
    return {
      items: [
        {
          id: "00000000-0000-4000-8000-000000000070",
          contentItemId: "00000000-0000-4000-8000-000000000040",
          provider: "bunny",
          providerAssetId: "bunny-video-1",
          providerState: "ready",
          providerPlayable: true,
          hasPlaybackUrl: true,
          readyAt: "2026-06-06T15:00:00.000Z",
          providerCheckedAt: "2026-06-06T15:01:00.000Z",
          createdAt: "2026-06-06T14:00:00.000Z"
        }
      ],
      nextCursor: null
    };
  },
  async listAgeChecks() {
    return {
      items: [
        {
          id: "00000000-0000-4000-8000-0000000000f0",
          userId: "00000000-0000-4000-8000-000000000011",
          provider: "sumsub",
          providerReference: "sumsub-age-ref-1",
          state: "verified",
          jurisdiction: "EU",
          rule: "18_plus",
          hasProviderReference: true,
          privacyBoundary: "sanitized_age_state_no_raw_identity_payloads",
          verifiedAt: "2026-06-06T14:05:00.000Z",
          expiresAt: "2027-06-06T14:05:00.000Z",
          createdAt: "2026-06-06T14:00:00.000Z"
        }
      ],
      nextCursor: null
    };
  },
  async listIdentityChecks() {
    return {
      items: [
        {
          id: "00000000-0000-4000-8000-0000000000f1",
          userId: "00000000-0000-4000-8000-000000000011",
          provider: "sumsub",
          providerReference: "sumsub-kyc-ref-1",
          verificationType: "kyc",
          state: "pending",
          countryCode: "DE",
          documentType: "passport",
          livenessState: "passed",
          walletOwnershipState: null,
          hasProviderReference: true,
          hasLegalNameHash: true,
          privacyBoundary: "sanitized_identity_minimized_no_raw_documents_or_pii",
          verifiedAt: null,
          expiresAt: null,
          createdAt: "2026-06-06T14:00:00.000Z"
        }
      ],
      nextCursor: null
    };
  },
  async listAiSessions() {
    return {
      items: [
        {
          id: "00000000-0000-4000-8000-0000000000f2",
          actorUserId: "00000000-0000-4000-8000-000000000001",
          scope: "admin_ops",
          state: "active",
          allowedToolCount: 2,
          createdAt: "2026-06-06T14:00:00.000Z",
          expiresAt: "2026-06-06T15:00:00.000Z"
        }
      ],
      nextCursor: null
    };
  },
  async listAiToolCalls() {
    return {
      items: [
        {
          id: "00000000-0000-4000-8000-0000000000f3",
          sessionId: "00000000-0000-4000-8000-0000000000f2",
          actorUserId: "00000000-0000-4000-8000-000000000001",
          scope: "admin_ops",
          toolName: "provider_health_summary",
          state: "executed",
          confirmationState: "not_required",
          subjectType: "provider",
          subjectId: null,
          inputSummary: "Summarize provider state",
          outputSummary: "Providers healthy",
          redactionBoundary: "summaries_only_no_tool_payloads_or_secrets",
          createdAt: "2026-06-06T14:02:00.000Z"
        }
      ],
      nextCursor: null
    };
  },
  async getMutualsSafety() {
    return {
      openReports: 0,
      activeMutuals: 1,
      staleMutuals: 0,
      socialMoneyBoundary: "money_never_buys_people_visibility_matches_or_social_priority"
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
  async provisionOrganization(input) {
    return {
      id: "00000000-0000-4000-8000-000000000149",
      name: input.body.name,
      state: "pending_kyb",
      plan: "enterprise",
      kybState: "not_started",
      createdAt: "2026-08-16T10:00:00.000Z"
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
  },
  async listFeatureFlags() {
    return {
      items: [
        {
          key: "compliance.carf_exports",
          value: { enabled: false },
          category: "compliance",
          policyBoundary: "software_policy_only_no_payment_access_or_social_priority",
          state: "paused",
          updatedAt: "2026-06-06T12:00:00.000Z"
        }
      ],
      nextCursor: null
    };
  },
  async updateFeatureFlag(input) {
    return {
      key: input.featureFlagKey,
      value: input.body.value,
      category: "compliance",
      policyBoundary: "software_policy_only_no_payment_access_or_social_priority",
      state: input.body.state,
      updatedAt: "2026-06-06T12:45:00.000Z"
    };
  }
};

function mutualsProfileFixture(overrides: Partial<Awaited<ReturnType<MutualsRepository["activate"]>>> = {}) {
  return {
    enabled: overrides.enabled ?? true,
    consentVersion: overrides.consentVersion ?? "mutuals-consent-2026-06-04",
    activeMatchLimit: overrides.activeMatchLimit ?? 10,
    visibleOnMedia: overrides.visibleOnMedia ?? true,
    safetyState: overrides.safetyState ?? ("clear" as const),
    createdAt: overrides.createdAt ?? "2026-06-04T22:30:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-06-04T22:30:00.000Z"
  };
}

function mutualsFeedItemFixture() {
  return {
    contentId: "00000000-0000-4000-8000-000000000040",
    creatorUserId: "00000000-0000-4000-8000-000000000011",
    handle: "maki",
    displayName: "Maki",
    avatarUrl: null,
    title: "Mutuals profile card",
    mediaKind: "image" as const,
    posterUrl: "https://media.example.test/mutuals.jpg",
    createdAt: "2026-06-04T22:31:00.000Z"
  };
}

function mutualFixture() {
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
    accessPassTypeId: string;
    priceMinor: number | null;
  }> = {}
) {
  const accessPassTypeId = overrides.accessPassTypeId ?? "00000000-0000-4000-8000-0000000000e2";
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
    accessPassTypes: [accessPassTypeFixture({ id: accessPassTypeId, priceMinor })]
  };
}

function accessPassTypeFixture(
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

function accessPassFixture(
  overrides: Partial<{
    eventId: string;
    accessPassTypeId: string;
  }> = {}
) {
  return {
    id: "00000000-0000-4000-8000-0000000000f1",
    eventId: overrides.eventId ?? "00000000-0000-4000-8000-0000000000e1",
    accessPassTypeId: overrides.accessPassTypeId ?? "00000000-0000-4000-8000-0000000000e2",
    holderUserId: "00000000-0000-4000-8000-000000000001",
    paymentIntentId: null,
    state: "active" as const,
    qrToken: "veel_access_pass_fixture",
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
    },
    async listMembers() { return []; },
    async inviteMember() { return null; },
    async respondToMembership() { return null; },
    async updateMember() { return null; }
  };
}

function sessionRepositoryWithProfile(options: {
  onEnsure?: (supabaseUserId: string) => Promise<void> | void;
  onFind: SessionRepository["findProfileBySupabaseUserId"];
}): SessionRepository {
  return {
    findProfileByUserId: options.onFind,
    findProfileBySupabaseUserId: options.onFind
  };
}

function verificationRepositoryStub(
  resolution: Partial<CapabilityResolution> = {}
): VerificationRepository {
  const defaultResolution: CapabilityResolution = {
    capabilities: {
      canAccessApp: true,
      canCreateProfile: true,
      canViewAgeRestrictedContent: true,
      canStartCreatorOnboarding: true,
      canCreateDraft: true,
      canUploadMedia: false,
      canPublishMedia: false,
      canPublishAdultMedia: false,
      canMonetize: false,
      canReceiveCreatorProceeds: false,
      canAccessCreatorDashboard: true,
      canCreateOrganization: true,
      canAccessStudio: true,
      canInviteTeam: false,
      canUseTeamPublishing: false,
      canUseAllocationWallets: false,
      canUseComplianceExports: false,
      canAccessEnterprise: false
    },
    missingRequirements: ["creator_kyc_required"],
    nextBestAction: "verify_creator_identity",
    verificationSummary: {
      ageAccess: null,
      adultPublisherEligibility: null,
      creatorKyc: null,
      orgKyb: null
    }
  };

  return {
    async authorizeOrganizationVerification() {
      return true;
    },
    async createPendingSession() {
      return "11111111-1111-4111-8111-111111111111";
    },
    async applyProviderWebhook() {
      return "applied";
    },
    async updateVerificationFromWebhook() {
      return true;
    },
    async findLatestUserVerification() {
      return null;
    },
    async findLatestOrganizationVerification() {
      return null;
    },
    async resolveCapabilities() {
      return { ...defaultResolution, ...resolution };
    }
  };
}

function creatorVerifiedVerificationRepository(): VerificationRepository {
  const repository = verificationRepositoryStub();

  return {
    ...repository,
    async resolveCapabilities(input) {
      const resolution = await repository.resolveCapabilities(input);

      return {
        ...resolution,
        capabilities: {
          ...resolution.capabilities,
          canUploadMedia: true,
          canPublishMedia: true,
          canPublishAdultMedia: true,
          canMonetize: true,
          canReceiveCreatorProceeds: true,
          canAccessCreatorDashboard: true
        },
        missingRequirements: [],
        nextBestAction: "creator_ready",
        verificationSummary: {
          ...resolution.verificationSummary,
          creatorKyc: {
            subjectType: "user",
            subjectId: input.supabaseUserId,
            purpose: "creator_kyc",
            status: "valid",
            provider: "sumsub",
            method: "gov_id_selfie",
            assuranceLevel: "documentary",
            verifiedAt: "2026-06-03T22:00:00.000Z",
            expiresAt: null,
            reusable: true
          }
        }
      };
    }
  };
}

const fakeProfileRepository: ProfileRepository = {
  async upsertMyProfile(supabaseUserId, input) {
    expect(supabaseUserId).toBe("00000000-0000-4000-8000-000000000001");
    expect(input).toMatchObject({
      handle: "maki",
      displayName: "Maki",
      avatarUrl: "https://media.example.test/avatar.jpg",
      links: [{ label: "Website", url: "https://veel.example.test/maki" }],
      bio: "Building Veel v2"
    });

    return {
      id: "00000000-0000-4000-8000-000000000010",
      handle: input.handle,
      displayName: input.displayName ?? input.handle,
      avatarUrl: input.avatarUrl ?? null,
      badges: []
    };
  },
  async isHandleAvailable() {
    return true;
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
      links: [{ label: "Website", url: "https://veel.example.test/maki" }],
      stats: {
        contentCount: 2,
        liveRoomCount: 1,
        confirmedPaymentCount: 3,
        followerCount: 0,
        followingCount: 0
      },
      monetisation: {
        supportEnabled: true,
        contentUnlocksEnabled: true,
        livePassesEnabled: true,
        paidMessagesEnabled: true,
        subscriptionsEnabled: false,
        membershipOffer: null
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
        readinessScore: 80,
        canMonetize: false,
        nextAction: "/wallet",
        policyBoundary: "creator_records_only_no_balances_payout_queue_or_social_priority",
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
      readinessScore: 60,
      nextAction: "/wallet",
      policyBoundary: "creator_records_only_no_balances_payout_queue_or_social_priority",
      configuration: {
        recipientWalletId: null,
        earningsTermsVersion: null,
        products: {
          support: false,
          contentUnlocks: false,
          eventAccessAndLive: false,
          paidMessages: false,
          memberships: false
        }
      },
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
