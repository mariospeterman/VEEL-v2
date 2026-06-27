import { createHmac } from "node:crypto";
import type { ServerEnv } from "@veel/config";
import type {
  AgeProvider,
  AgeProviderAdapter
} from "./types.js";

export class AgeProviderHttpError extends Error {
  constructor(
    public readonly provider: AgeProvider,
    public readonly status: number,
    public readonly body: string
  ) {
    super(`AGE_PROVIDER_HTTP_ERROR:${provider}:${status}`);
    this.name = "AgeProviderHttpError";
  }
}

export function createYotiAgeProviderAdapter(env: ServerEnv): AgeProviderAdapter {
  return {
    provider: "yoti",
    isConfigured() {
      return (
        (env.AGE_VERIFICATION_DRIVER === "yoti" ||
          env.AGE_VERIFICATION_DRIVER === "yoti_digital_id") &&
        Boolean(env.YOTI_SDK_ID && env.YOTI_API_TOKEN)
      );
    },
    async createSession(input) {
      if (!env.YOTI_SDK_ID || !env.YOTI_API_TOKEN) {
        throw new AgeProviderHttpError("yoti", 503, "Yoti is not configured");
      }

      const response = await providerFetch("yoti", `${env.YOTI_API_BASE_URL}/sessions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.YOTI_API_TOKEN}`,
          "content-type": "application/json",
          "yoti-sdk-id": env.YOTI_SDK_ID
        },
        body: JSON.stringify({
          type: "OVER",
          ttl: 900,
          reference_id: input.idempotencyKey,
          callback: {
            url: input.callbackUrl,
            auto: true
          },
          notification_url: `${input.webhookBaseUrl}/yoti`,
          digital_id: {
            allowed: true,
            threshold: 18,
            age_estimation_allowed: true,
            age_estimation_threshold: 25,
            retry_limit: 3
          },
          age_estimation: {
            allowed: true,
            threshold: 25,
            level: "PASSIVE",
            retry_limit: 3
          },
          doc_scan: {
            allowed: true,
            threshold: 18,
            authenticity: "AUTO",
            level: "PASSIVE",
            retry_limit: 3
          },
          credit_card: {
            allowed: false
          }
        })
      });
      const body = objectBody(await response.json());
      const sessionId = firstString(body.session_id, body.sessionId, body.id);

      if (!sessionId) {
        throw new AgeProviderHttpError("yoti", 502, "Yoti response is missing a session id");
      }

      return {
        provider: "yoti",
        providerReference: sessionId,
        launchUrl: `${env.YOTI_LAUNCH_BASE_URL}?sessionId=${encodeURIComponent(sessionId)}&sdkId=${encodeURIComponent(env.YOTI_SDK_ID)}`,
        expiresAt: expiresInSeconds(900),
        rule: "over_18"
      };
    }
  };
}

export function createDiditAgeProviderAdapter(env: ServerEnv): AgeProviderAdapter {
  return {
    provider: "didit",
    isConfigured() {
      return Boolean(env.DIDIT_API_KEY && env.DIDIT_AGE_WORKFLOW_ID);
    },
    async createSession(input) {
      if (!env.DIDIT_API_KEY || !env.DIDIT_AGE_WORKFLOW_ID) {
        throw new AgeProviderHttpError("didit", 503, "Didit is not configured");
      }

      const response = await providerFetch("didit", `${withoutTrailingSlash(env.DIDIT_API_BASE_URL)}/v3/session/`, {
        method: "POST",
        headers: {
          "x-api-key": env.DIDIT_API_KEY,
          "content-type": "application/json",
          "idempotency-key": input.idempotencyKey
        },
        body: JSON.stringify({
          workflow_id: env.DIDIT_AGE_WORKFLOW_ID,
          callback_url: input.callbackUrl,
          vendor_data: `user:${input.supabaseUserId}`,
          metadata: {
            purpose: "age_access",
            rule: "over_18",
            webhook_url: `${input.webhookBaseUrl}/didit`
          }
        })
      });
      const body = objectBody(await response.json());
      const session = objectBody(body.session, true);
      const providerReference = firstString(body.id, body.session_id, session?.id, session?.session_id);
      const launchUrl = firstString(body.url, body.verification_url, body.redirect_url, session?.url, session?.verification_url);

      if (!providerReference || !launchUrl) {
        throw new AgeProviderHttpError("didit", 502, "Didit response is missing session launch data");
      }

      return {
        provider: "didit",
        providerReference,
        launchUrl,
        expiresAt: expiresInSeconds(24 * 60 * 60),
        rule: "over_18"
      };
    }
  };
}

export function createPersonaAgeProviderAdapter(env: ServerEnv): AgeProviderAdapter {
  return {
    provider: "persona",
    isConfigured() {
      return (
        env.AGE_VERIFICATION_DRIVER === "persona" &&
        Boolean(env.PERSONA_API_KEY && env.PERSONA_TEMPLATE_ID)
      );
    },
    async createSession(input) {
      if (!env.PERSONA_API_KEY || !env.PERSONA_TEMPLATE_ID) {
        throw new AgeProviderHttpError("persona", 503, "Persona is not configured");
      }

      const response = await providerFetch("persona", `${env.PERSONA_API_BASE_URL}/api/v1/inquiries`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.PERSONA_API_KEY}`,
          "content-type": "application/json",
          "idempotency-key": input.idempotencyKey,
          "key-inflection": "kebab"
        },
        body: JSON.stringify({
          data: {
            attributes: {
              "inquiry-template-id": env.PERSONA_TEMPLATE_ID,
              "reference-id": input.supabaseUserId,
              note: "WeVid age assurance"
            }
          },
          meta: {
            "redirect-uri": input.callbackUrl
          }
        })
      });
      const body = objectBody(await response.json());
      const data = objectBody(body.data);
      const meta = objectBody(body.meta, true);
      const attributes = objectBody(data.attributes, true);
      const providerReference = firstString(data.id, attributes?.["reference-id"]);
      const launchUrl = firstString(
        meta?.["one-time-link"],
        meta?.["one_time_link"],
        meta?.["one-time-link-short"],
        meta?.["one_time_link_short"]
      );
      const expiresAt = parseDate(firstString(attributes?.["expires-at"], attributes?.["expires_at"])) ?? expiresInSeconds(86_400);

      if (!providerReference || !launchUrl) {
        throw new AgeProviderHttpError("persona", 502, "Persona response is missing inquiry launch data");
      }

      return {
        provider: "persona",
        providerReference,
        launchUrl,
        expiresAt,
        rule: "over_18"
      };
    }
  };
}

export function createVeriffAgeProviderAdapter(env: ServerEnv): AgeProviderAdapter {
  return {
    provider: "veriff",
    isConfigured() {
      return env.AGE_VERIFICATION_DRIVER === "veriff" && Boolean(env.VERIFF_API_KEY);
    },
    async createSession(input) {
      if (!env.VERIFF_API_KEY) {
        throw new AgeProviderHttpError("veriff", 503, "Veriff is not configured");
      }

      const response = await providerFetch("veriff", `${env.VERIFF_API_BASE_URL}/v1/sessions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-auth-client": env.VERIFF_API_KEY
        },
        body: JSON.stringify({
          verification: {
            callback: input.callbackUrl,
            vendorData: input.supabaseUserId,
            endUserId: input.supabaseUserId
          }
        })
      });
      const body = objectBody(await response.json());
      const verification = objectBody(body.verification);
      const providerReference = firstString(verification.id);
      const launchUrl = firstString(verification.url);

      if (!providerReference || !launchUrl) {
        throw new AgeProviderHttpError("veriff", 502, "Veriff response is missing verification launch data");
      }

      return {
        provider: "veriff",
        providerReference,
        launchUrl,
        expiresAt: expiresInSeconds(7 * 24 * 60 * 60),
        rule: "over_18"
      };
    }
  };
}

export function createSumsubAgeProviderAdapter(env: ServerEnv): AgeProviderAdapter {
  return {
    provider: "sumsub",
    isConfigured() {
      return (
        env.AGE_VERIFICATION_DRIVER === "sumsub" &&
        Boolean(env.SUMSUB_APP_TOKEN && env.SUMSUB_SECRET_KEY && env.SUMSUB_LEVEL_NAME)
      );
    },
    async createSession(input) {
      if (!env.SUMSUB_APP_TOKEN || !env.SUMSUB_SECRET_KEY || !env.SUMSUB_LEVEL_NAME) {
        throw new AgeProviderHttpError("sumsub", 503, "Sumsub is not configured");
      }

      const path = "/resources/accessTokens/sdk";
      const body = JSON.stringify({
        ttlInSecs: 600,
        userId: input.supabaseUserId,
        levelName: env.SUMSUB_LEVEL_NAME
      });
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const signature = createHmac("sha256", env.SUMSUB_SECRET_KEY)
        .update(`${timestamp}POST${path}${body}`)
        .digest("hex");
      const response = await providerFetch("sumsub", `${env.SUMSUB_API_BASE_URL}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-app-token": env.SUMSUB_APP_TOKEN,
          "x-app-access-ts": timestamp,
          "x-app-access-sig": signature
        },
        body
      });
      const responseBody = objectBody(await response.json());
      const token = firstString(responseBody.token);
      const userId = firstString(responseBody.userId) ?? input.supabaseUserId;

      if (!token) {
        throw new AgeProviderHttpError("sumsub", 502, "Sumsub response is missing an access token");
      }

      return {
        provider: "sumsub",
        providerReference: userId,
        launchUrl: `${input.callbackUrl}?provider=sumsub&token=${encodeURIComponent(token)}`,
        expiresAt: expiresInSeconds(600),
        rule: "over_18"
      };
    }
  };
}

async function providerFetch(provider: AgeProvider, url: string, init: RequestInit): Promise<Response> {
  const response = await fetch(url, init);

  if (!response.ok) {
    throw new AgeProviderHttpError(provider, response.status, await response.text());
  }

  return response;
}

function objectBody(input: unknown, optional?: false): Record<string, unknown>;
function objectBody(input: unknown, optional: true): Record<string, unknown> | null;
function objectBody(input: unknown, optional = false): Record<string, unknown> | null {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }

  if (optional) {
    return null;
  }

  throw new Error("Provider response is not a JSON object");
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }

  return null;
}

function parseDate(value: string | null): Date | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function expiresInSeconds(seconds: number): Date {
  return new Date(Date.now() + seconds * 1000);
}

function withoutTrailingSlash(value: string) {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}
