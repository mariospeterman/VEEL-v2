import { afterEach, describe, expect, it, vi } from "vitest";
import { parseServerEnv } from "@veel/config";
import {
  createVerificationProviderWaterfall,
  VerificationProviderUnavailableError
} from "../src/modules/verification/verification-provider-adapters";
import type {
  CreateVerificationSessionInput,
  VerificationProviderSelection
} from "../src/modules/verification/types";

const baseInput = {
  supabaseUserId: "00000000-0000-4000-8000-000000000001",
  purpose: "age_access",
  providerPreference: "didit",
  idempotencyKey: "age-provider-selection-1",
  callbackUrl: "https://app.example.test/age/callback",
  webhookBaseUrl: "https://api.example.test/v1/webhooks/age"
} satisfies CreateVerificationSessionInput;

describe("age verification provider selection", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses AGE_VERIFICATION_DRIVER instead of a browser provider preference", async () => {
    const fetchMock = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) => new Response(
        JSON.stringify({ session_id: "yoti-session-1" }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);
    const selected: VerificationProviderSelection[] = [];
    const waterfall = createVerificationProviderWaterfall(parseServerEnv({
      NODE_ENV: "test",
      AGE_VERIFICATION_DRIVER: "yoti",
      YOTI_SDK_ID: "yoti-sdk-id-1234",
      YOTI_API_TOKEN: "yoti-api-token",
      YOTI_API_BASE_URL: "https://age.yoti.example/api/v1",
      YOTI_LAUNCH_BASE_URL: "https://age.yoti.example",
      DIDIT_API_KEY: "didit-api-key",
      DIDIT_AGE_WORKFLOW_ID: "didit-age-workflow",
      DIDIT_API_BASE_URL: "https://verification.didit.example"
    }));

    const session = await waterfall.createSession({
      ...baseInput,
      providerPreference: "didit",
      onProviderSelected: async (selection) => {
        selected.push(selection);
      }
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://age.yoti.example/api/v1/sessions");
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      retry_enabled: true,
      resume_enabled: true,
      synchronous_checks: true,
      digital_id: {
        retry_enabled: true,
        retry_limit: 3
      },
      age_estimation: {
        retry_enabled: true,
        retry_limit: 3
      },
      doc_scan: {
        retry_enabled: true,
        retry_limit: 3
      }
    });
    expect(selected).toEqual([{
      provider: "yoti",
      method: "age_estimation",
      assuranceLevel: "medium",
      reusable: false
    }]);
    expect(session).toMatchObject({
      provider: "yoti",
      providerReference: "yoti-session-1",
      method: "age_estimation",
      reusable: false
    });
  });

  it("does not shop for another configured provider when the selected driver is unavailable", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const waterfall = createVerificationProviderWaterfall(parseServerEnv({
      NODE_ENV: "test",
      AGE_VERIFICATION_DRIVER: "yoti",
      DIDIT_API_KEY: "didit-api-key",
      DIDIT_AGE_WORKFLOW_ID: "didit-age-workflow",
      DIDIT_API_BASE_URL: "https://verification.didit.example"
    }));

    await expect(waterfall.createSession({
      ...baseInput,
      providerPreference: "didit"
    })).rejects.toBeInstanceOf(VerificationProviderUnavailableError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not open a second provider after an ambiguous selected-provider response", async () => {
    const fetchMock = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        new Response("upstream timeout", { status: 504 })
    );
    vi.stubGlobal("fetch", fetchMock);
    const waterfall = createVerificationProviderWaterfall(parseServerEnv({
      NODE_ENV: "test",
      AGE_VERIFICATION_DRIVER: "yoti",
      YOTI_SDK_ID: "yoti-sdk-id-1234",
      YOTI_API_TOKEN: "yoti-api-token",
      YOTI_API_BASE_URL: "https://age.yoti.example/api/v1",
      DIDIT_API_KEY: "didit-api-key",
      DIDIT_AGE_WORKFLOW_ID: "didit-age-workflow",
      DIDIT_API_BASE_URL: "https://verification.didit.example"
    }));

    await expect(waterfall.createSession({
      ...baseInput,
      providerPreference: "didit"
    })).rejects.toMatchObject({
      provider: "yoti",
      status: 504
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://age.yoti.example/api/v1/sessions");
  });
});
