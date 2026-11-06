import { describe, expect, it, vi } from "vitest";
import { buildApi } from "../src/app";
import { AgeProviderHttpError } from "../src/modules/age/age-provider-waterfall";
import type {
  AgeProviderWaterfall,
  AgeRepository,
  AgeSessionAttemptResource
} from "../src/modules/age/types";
import type {
  ApplicationSessionVerifier,
  VerifiedApplicationSession
} from "../src/modules/session/types";

const userId = "00000000-0000-4000-8000-000000000001";
const sessionId = "00000000-0000-4000-8000-000000000138";

const authVerifier: ApplicationSessionVerifier = {
  async verifyToken(token: string): Promise<VerifiedApplicationSession | null> {
    if (token !== "valid-token") return null;
    return {
      userId,
      supabaseUserId: userId,
      sessionId: "00000000-0000-4000-8000-000000000099",
      authenticatedAt: new Date(),
      authenticationMethod: "wallet"
    };
  }
};

function baseRepository(overrides: Partial<AgeRepository>): AgeRepository {
  return {
    async findLatestAgeStatusByUserId() {
      return { state: "required", provider: null };
    },
    async findLatestAgeStatusBySupabaseUserId() {
      return { state: "required", provider: null };
    },
    async createPendingAgeVerification() {},
    async applyProviderWebhook() {
      throw new Error("not implemented");
    },
    async updateVerificationFromWebhook() {
      return false;
    },
    ...overrides
  };
}

describe("durable age attempt routes", () => {
  it("keeps an ambiguous create reconciling and reuses it for a different key", async () => {
    let attempt: AgeSessionAttemptResource = {
      id: sessionId,
      provider: null,
      providerReference: null,
      launchUrl: null,
      expiresAt: null,
      launchState: "reserved",
      status: "created",
      resumable: false
    };
    let firstReservation = true;
    const fail = vi.fn();
    const markReconciling = vi.fn(async () => {
      attempt = {
        ...attempt,
        provider: "yoti",
        launchState: "reconciling",
        status: "submitted"
      };
    });
    const repository = baseRepository({
      async reservePendingAgeVerification() {
        if (firstReservation) {
          firstReservation = false;
          return {
            id: sessionId,
            subjectReference: `wevid:user:${userId}:age_access:${sessionId}`,
            attempt,
            shouldCreateProviderSession: true
          };
        }
        return {
          id: sessionId,
          subjectReference: `wevid:user:${userId}:age_access:${sessionId}`,
          attempt,
          shouldCreateProviderSession: false
        };
      },
      async selectPendingAgeProvider(input) {
        attempt = {
          ...attempt,
          provider: input.provider,
          launchState: "reconciling",
          status: "submitted"
        };
      },
      async completePendingAgeVerification() {},
      async failPendingAgeVerification() {
        fail();
      },
      markPendingAgeVerificationReconciling: markReconciling,
      async findAgeVerificationAttempt(input) {
        expect(input.userId).toBe(userId);
        return input.sessionId === sessionId ? attempt : null;
      }
    });
    const createSession = vi.fn(async (input: Parameters<AgeProviderWaterfall["createSession"]>[0]) => {
      await input.onProviderSelected?.({
        provider: "yoti",
        method: "age_estimation",
        assuranceLevel: "medium",
        reusable: false
      });
      throw new Error("connection_lost_after_provider_create");
    });
    const app = await buildApi({
      authVerifier,
      ageRepository: repository,
      ageProviderWaterfall: { createSession }
    });
    await app.ready();

    const first = await app.inject({
      method: "POST",
      url: "/v1/age/sessions",
      headers: { authorization: "Bearer valid-token", "idempotency-key": "age-attempt-0001" },
      payload: { providerPreference: "yoti" }
    });
    expect(first.statusCode, first.body).toBe(202);
    expect(first.json()).toMatchObject({ id: sessionId, launchState: "reconciling" });
    expect(markReconciling).toHaveBeenCalledOnce();
    expect(fail).not.toHaveBeenCalled();

    const second = await app.inject({
      method: "POST",
      url: "/v1/age/sessions",
      headers: { authorization: "Bearer valid-token", "idempotency-key": "age-attempt-0002" },
      payload: { providerPreference: "didit" }
    });
    expect(second.statusCode, second.body).toBe(202);
    expect(second.json()).toMatchObject({ id: sessionId, launchState: "reconciling" });
    expect(createSession).toHaveBeenCalledTimes(1);

    await app.close();
  });

  it("fails a durable reservation when the provider definitively rejects creation", async () => {
    const fail = vi.fn();
    const markReconciling = vi.fn();
    const repository = baseRepository({
      async reservePendingAgeVerification() {
        return {
          id: sessionId,
          subjectReference: `wevid:user:${userId}:age_access:${sessionId}`,
          attempt: {
            id: sessionId,
            provider: null,
            providerReference: null,
            launchUrl: null,
            expiresAt: null,
            launchState: "reserved",
            status: "created",
            resumable: false
          },
          shouldCreateProviderSession: true
        };
      },
      async selectPendingAgeProvider() {},
      async completePendingAgeVerification() {},
      async failPendingAgeVerification(input) {
        fail(input);
      },
      markPendingAgeVerificationReconciling: markReconciling
    });
    const app = await buildApi({
      authVerifier,
      ageRepository: repository,
      ageProviderWaterfall: {
        async createSession(input) {
          await input.onProviderSelected?.({
            provider: "yoti",
            method: "age_estimation",
            assuranceLevel: "medium",
            reusable: false
          });
          throw new AgeProviderHttpError("yoti", 400, "invalid request");
        }
      }
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/v1/age/sessions",
      headers: { authorization: "Bearer valid-token", "idempotency-key": "age-attempt-rejected-0001" },
      payload: { providerPreference: "yoti" }
    });

    expect(response.statusCode, response.body).toBe(503);
    expect(fail).toHaveBeenCalledWith({
      sessionId,
      reason: "provider_create_rejected_400"
    });
    expect(markReconciling).not.toHaveBeenCalled();

    await app.close();
  });

  it("reconciles a referenced attempt through authenticated provider retrieval", async () => {
    let attempt: AgeSessionAttemptResource = {
      id: sessionId,
      provider: "yoti",
      providerReference: "yoti-session-138",
      launchUrl: null,
      expiresAt: null,
      launchState: "reconciling",
      status: "submitted",
      resumable: true
    };
    const apply = vi.fn(async () => {
      attempt = {
        ...attempt,
        launchUrl: "https://age.yoti.example?sessionId=yoti-session-138&sdkId=sdk",
        expiresAt: "2026-11-06T12:15:00.000Z",
        launchState: "ready",
        status: "approved"
      };
      return true;
    });
    const repository = baseRepository({
      async recordAgeVerificationReconciliationAttempt(input) {
        expect(input).toEqual({ userId, sessionId });
        return attempt;
      },
      async findAgeVerificationAttempt() {
        return attempt;
      },
      async completePendingAgeVerification() {},
      applyProviderReconciliation: apply
    });
    const reconcileSession = vi.fn(async () => ({
      provider: "yoti" as const,
      providerReference: "yoti-session-138",
      providerEventId: "yoti-session-138:authenticated:COMPLETE:observed",
      eventType: "session.authenticated_result.age_estimation",
      status: "valid" as const,
      signatureHash: null,
      launchUrl: "https://age.yoti.example?sessionId=yoti-session-138&sdkId=sdk",
      expiresAt: new Date("2026-11-06T12:15:00.000Z")
    }));
    const app = await buildApi({
      authVerifier,
      ageRepository: repository,
      ageProviderWaterfall: {
        async createSession() {
          throw new Error("must not create another provider session");
        },
        reconcileSession
      }
    });
    await app.ready();

    const unauthorizedStatus = await app.inject({
      method: "GET",
      url: `/v1/age/sessions/${sessionId}`
    });
    expect(unauthorizedStatus.statusCode).toBe(401);
    const status = await app.inject({
      method: "GET",
      url: `/v1/age/sessions/${sessionId}`,
      headers: { authorization: "Bearer valid-token" }
    });
    expect(status.statusCode, status.body).toBe(200);
    expect(status.json()).toMatchObject({ id: sessionId, launchState: "reconciling" });

    const response = await app.inject({
      method: "POST",
      url: `/v1/age/sessions/${sessionId}/resume`,
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "age-resume-0001"
      }
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      id: sessionId,
      launchState: "ready",
      launchUrl: "https://age.yoti.example?sessionId=yoti-session-138&sdkId=sdk"
    });
    expect(reconcileSession).toHaveBeenCalledOnce();
    expect(apply).toHaveBeenCalledOnce();

    await app.close();
  });

  it("returns a controlled provider error while keeping a referenced attempt resumable", async () => {
    const attempt: AgeSessionAttemptResource = {
      id: sessionId,
      provider: "didit",
      providerReference: "didit-session-138",
      launchUrl: null,
      expiresAt: null,
      launchState: "reconciling",
      status: "submitted",
      resumable: true
    };
    const repository = baseRepository({
      async recordAgeVerificationReconciliationAttempt() {
        return attempt;
      },
      async findAgeVerificationAttempt() {
        return attempt;
      },
      async completePendingAgeVerification() {},
      async applyProviderReconciliation() {
        return true;
      }
    });
    const app = await buildApi({
      authVerifier,
      ageRepository: repository,
      ageProviderWaterfall: {
        async createSession() {
          throw new Error("must not create another provider session");
        },
        async reconcileSession() {
          throw new AgeProviderHttpError("didit", 503, "temporarily unavailable");
        }
      }
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: `/v1/age/sessions/${sessionId}/resume`,
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "age-resume-unavailable-0001"
      }
    });

    expect(response.statusCode, response.body).toBe(503);
    expect(response.json()).toEqual({
      code: "service_unavailable",
      message: "Age verification provider is unavailable"
    });

    await app.close();
  });
});
