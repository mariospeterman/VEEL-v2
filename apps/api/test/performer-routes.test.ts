import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApi } from "../src/app.js";
import type { PerformerConsentRequestResource, PerformerRepository } from "../src/modules/performer/types.js";

const invitation: PerformerConsentRequestResource = {
  id: "00000000-0000-4000-8000-000000000091",
  contentId: "00000000-0000-4000-8000-000000000040",
  contentRevision: 3,
  contentCaption: "Exact scene",
  mediaType: "vod",
  rating: "explicit",
  performerLabel: "Guest performer",
  linkedUser: false,
  state: "verification_required",
  verificationState: "pending",
  allowedUses: ["capture", "upload", "distribution", "monetisation"],
  expiresAt: "2026-08-19T00:00:00.000Z"
};

afterEach(() => vi.unstubAllEnvs());

describe("performer consent routes", () => {
  it("returns an external invitation once and stores only its hash", async () => {
    let storedTokenHash: string | null = null;
    const repository = performerRepository({
      async createRequest(input) {
        storedTokenHash = input.invitationTokenHash ?? null;
        expect(input.allowedUses).toEqual(invitation.allowedUses);
        expect(input.externalLabel).toBe("Guest performer");
        return { request: invitation, invitationCreated: true };
      }
    });
    const app = await buildApi({
      authVerifier: {
        async verifyToken() {
          return { userId: "00000000-0000-4000-8000-000000000001", supabaseUserId: "00000000-0000-4000-8000-000000000001", sessionId: "00000000-0000-4000-8000-000000000099", authenticatedAt: new Date(), authenticationMethod: "wallet" as const };
        }
      },
      performerRepository: repository
    });

    const response = await app.inject({
      method: "POST",
      url: `/v1/content/${invitation.contentId}/performers`,
      headers: { authorization: "Bearer valid-token", "idempotency-key": "performer-request-1" },
      payload: {
        externalLabel: "Guest performer",
        allowedUses: invitation.allowedUses
      }
    });

    expect(response.statusCode).toBe(201);
    const invitationUrl = response.json().invitationUrl as string;
    const rawToken = invitationUrl.split("/").at(-1) ?? "";
    expect(rawToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(storedTokenHash).toBe(createHash("sha256").update(rawToken).digest("hex"));
    expect(storedTokenHash).not.toContain(rawToken);
    expect(response.json().request).toEqual(invitation);

    await app.close();
  });

  it("does not expose a mismatched invitation token on an idempotent retry", async () => {
    const app = await buildApi({
      authVerifier: {
        async verifyToken() {
          return { userId: "00000000-0000-4000-8000-000000000001", supabaseUserId: "00000000-0000-4000-8000-000000000001", sessionId: "00000000-0000-4000-8000-000000000099", authenticatedAt: new Date(), authenticationMethod: "wallet" as const };
        }
      },
      performerRepository: performerRepository({
        async createRequest() {
          return { request: invitation, invitationCreated: false };
        }
      })
    });

    const response = await app.inject({
      method: "POST",
      url: `/v1/content/${invitation.contentId}/performers`,
      headers: { authorization: "Bearer valid-token", "idempotency-key": "performer-request-1" },
      payload: { externalLabel: "Guest performer", allowedUses: invitation.allowedUses }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().invitationUrl).toBeNull();
    await app.close();
  });

  it("fails closed when external consent is accepted before verification", async () => {
    const app = await buildApi({
      performerRepository: performerRepository({
        async respondToInvitation() {
          return null;
        }
      })
    });
    const token = "a".repeat(43);
    const response = await app.inject({
      method: "POST",
      url: `/v1/performer-invitations/${token}/responses`,
      headers: { "idempotency-key": "performer-response-1" },
      payload: { decision: "accept" }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe("performer_consent_not_ready");
    await app.close();
  });
});

function performerRepository(overrides: Partial<PerformerRepository>): PerformerRepository {
  return {
    async listForContent() { return []; },
    async createRequest() { return null; },
    async findInvitation() { return null; },
    async createVerificationSession() { return null; },
    async respondAsLinkedUser() { return null; },
    async respondToInvitation() { return null; },
    ...overrides
  };
}
