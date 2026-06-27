import { createHmac } from "node:crypto";
import type { ServerEnv } from "@veel/config";
import type {
  CreateVerificationSessionInput,
  VerificationProvider,
  VerificationProviderSession,
  VerificationProviderWaterfall
} from "./types.js";

export class VerificationProviderHttpError extends Error {
  constructor(
    public readonly provider: VerificationProvider,
    public readonly status: number,
    public readonly body: string
  ) {
    super(`VERIFICATION_PROVIDER_HTTP_ERROR:${provider}:${status}`);
    this.name = "VerificationProviderHttpError";
  }
}

export class VerificationProviderUnavailableError extends Error {
  constructor() {
    super("VERIFICATION_PROVIDER_UNAVAILABLE");
    this.name = "VerificationProviderUnavailableError";
  }
}

interface VerificationProviderAdapter {
  provider: Extract<VerificationProvider, "sumsub" | "didit" | "persona" | "veriff">;
  isConfigured(input: CreateVerificationSessionInput): boolean;
  createSession(input: CreateVerificationSessionInput): Promise<VerificationProviderSession>;
}

export function createVerificationProviderWaterfall(env: ServerEnv): VerificationProviderWaterfall {
  return createStaticVerificationProviderWaterfall([
    createDiditVerificationProviderAdapter(env),
    createSumsubVerificationProviderAdapter(env),
    createPersonaVerificationProviderAdapter(env),
    createVeriffVerificationProviderAdapter(env)
  ]);
}

export function createStaticVerificationProviderWaterfall(
  adapters: VerificationProviderAdapter[]
): VerificationProviderWaterfall {
  const byProvider = new Map(adapters.map((adapter) => [adapter.provider, adapter]));

  return {
    async createSession(input) {
      for (const provider of providerOrder(input.providerPreference)) {
        const adapter = byProvider.get(provider);

        if (!adapter?.isConfigured(input)) {
          continue;
        }

        return adapter.createSession(input);
      }

      throw new VerificationProviderUnavailableError();
    }
  };
}

function createSumsubVerificationProviderAdapter(env: ServerEnv): VerificationProviderAdapter {
  return {
    provider: "sumsub",
    isConfigured(input) {
      return Boolean(env.SUMSUB_APP_TOKEN && env.SUMSUB_SECRET_KEY && sumsubLevelName(env, input));
    },
    async createSession(input) {
      const levelName = sumsubLevelName(env, input);

      if (!env.SUMSUB_APP_TOKEN || !env.SUMSUB_SECRET_KEY || !levelName) {
        throw new VerificationProviderHttpError("sumsub", 503, "Sumsub is not configured");
      }

      const path = "/resources/accessTokens/sdk";
      const externalUserId = input.purpose === "org_kyb"
        ? `org:${input.organizationId}`
        : `user:${input.supabaseUserId}`;
      const body = JSON.stringify({
        ttlInSecs: 600,
        userId: externalUserId,
        levelName
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
      const userId = firstString(responseBody.userId) ?? externalUserId;

      if (!token) {
        throw new VerificationProviderHttpError("sumsub", 502, "Sumsub response is missing an access token");
      }

      return {
        provider: "sumsub",
        providerReference: userId,
        providerApplicantId: userId,
        launchUrl: `${input.callbackUrl}?provider=sumsub&token=${encodeURIComponent(token)}`,
        expiresAt: expiresInSeconds(600),
        method: input.purpose === "org_kyb" ? "kyb_registry" : "gov_id_selfie",
        assuranceLevel: input.purpose === "org_kyb" ? "business_verified" : "documentary"
      };
    }
  };
}

function createDiditVerificationProviderAdapter(env: ServerEnv): VerificationProviderAdapter {
  return {
    provider: "didit",
    isConfigured(input) {
      return Boolean(env.DIDIT_API_KEY && diditWorkflowId(env, input));
    },
    async createSession(input) {
      const workflowId = diditWorkflowId(env, input);

      if (!env.DIDIT_API_KEY || !workflowId) {
        throw new VerificationProviderHttpError("didit", 503, "Didit is not configured");
      }

      const response = await providerFetch("didit", `${env.DIDIT_API_BASE_URL}/v1/sessions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.DIDIT_API_KEY}`,
          "content-type": "application/json",
          "idempotency-key": input.idempotencyKey
        },
        body: JSON.stringify({
          workflow_id: workflowId,
          reference_id: input.purpose === "org_kyb" ? input.organizationId : input.supabaseUserId,
          callback_url: input.callbackUrl,
          webhook_url: `${input.webhookBaseUrl}/didit`,
          metadata: {
            purpose: input.purpose,
            subject: input.purpose === "org_kyb" ? "organization" : "user"
          }
        })
      });
      const body = objectBody(await response.json());
      const session = objectBody(body.session, true);
      const id = firstString(body.id, body.session_id, session?.id, session?.session_id);
      const url = firstString(body.url, body.verification_url, body.redirect_url, session?.url, session?.verification_url);

      if (!id || !url) {
        throw new VerificationProviderHttpError("didit", 502, "Didit response is missing session launch data");
      }

      return {
        provider: "didit",
        providerReference: id,
        providerSessionId: id,
        launchUrl: url,
        expiresAt: expiresInSeconds(24 * 60 * 60),
        method: input.purpose === "org_kyb" ? "kyb_registry" : "gov_id_selfie",
        assuranceLevel: input.purpose === "org_kyb" ? "business_verified" : "documentary",
        reusable: true
      };
    }
  };
}

function createPersonaVerificationProviderAdapter(env: ServerEnv): VerificationProviderAdapter {
  return {
    provider: "persona",
    isConfigured(input) {
      return input.purpose === "creator_kyc" && Boolean(env.PERSONA_API_KEY && env.PERSONA_TEMPLATE_ID);
    },
    async createSession(input) {
      if (!env.PERSONA_API_KEY || !env.PERSONA_TEMPLATE_ID) {
        throw new VerificationProviderHttpError("persona", 503, "Persona is not configured");
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
              note: "WeVid creator KYC"
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
      const id = firstString(data.id);
      const url = firstString(meta?.["one-time-link"], meta?.["one_time_link"]);

      if (!id || !url) {
        throw new VerificationProviderHttpError("persona", 502, "Persona response is missing inquiry launch data");
      }

      return {
        provider: "persona",
        providerReference: id,
        providerInquiryId: id,
        launchUrl: url,
        expiresAt: parseDate(firstString(attributes?.["expires-at"], attributes?.["expires_at"])) ?? expiresInSeconds(86_400),
        method: "gov_id_selfie",
        assuranceLevel: "documentary"
      };
    }
  };
}

function createVeriffVerificationProviderAdapter(env: ServerEnv): VerificationProviderAdapter {
  return {
    provider: "veriff",
    isConfigured(input) {
      return input.purpose === "creator_kyc" && Boolean(env.VERIFF_API_KEY);
    },
    async createSession(input) {
      if (!env.VERIFF_API_KEY) {
        throw new VerificationProviderHttpError("veriff", 503, "Veriff is not configured");
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
      const id = firstString(verification.id);
      const url = firstString(verification.url);

      if (!id || !url) {
        throw new VerificationProviderHttpError("veriff", 502, "Veriff response is missing verification launch data");
      }

      return {
        provider: "veriff",
        providerReference: id,
        providerSessionId: id,
        launchUrl: url,
        expiresAt: expiresInSeconds(7 * 24 * 60 * 60),
        method: "gov_id_selfie",
        assuranceLevel: "documentary"
      };
    }
  };
}

function providerOrder(preference: CreateVerificationSessionInput["providerPreference"]) {
  if (preference === "provider_first") {
    return ["didit", "sumsub", "persona", "veriff"] as const;
  }

  return [
    preference,
    ...(["didit", "sumsub", "persona", "veriff"] as const).filter((provider) => provider !== preference)
  ];
}

function sumsubLevelName(env: ServerEnv, input: CreateVerificationSessionInput) {
  return input.purpose === "org_kyb"
    ? env.SUMSUB_ORG_KYB_LEVEL_NAME ?? env.SUMSUB_LEVEL_NAME
    : env.SUMSUB_CREATOR_KYC_LEVEL_NAME ?? env.SUMSUB_LEVEL_NAME;
}

function diditWorkflowId(env: ServerEnv, input: CreateVerificationSessionInput) {
  return input.purpose === "org_kyb" ? env.DIDIT_KYB_WORKFLOW_ID : env.DIDIT_KYC_WORKFLOW_ID;
}

async function providerFetch(provider: VerificationProvider, url: string, init: RequestInit): Promise<Response> {
  const response = await fetch(url, init);

  if (!response.ok) {
    throw new VerificationProviderHttpError(provider, response.status, await response.text());
  }

  return response;
}

function objectBody(input: unknown, optional?: false): Record<string, unknown>;
function objectBody(input: unknown, optional: true): Record<string, unknown> | null;
function objectBody(input: unknown, optional = false): Record<string, unknown> | null {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }

  if (optional) return null;
  throw new Error("Provider response is not a JSON object");
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.length > 0) return value;
  }

  return null;
}

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function expiresInSeconds(seconds: number): Date {
  return new Date(Date.now() + seconds * 1000);
}
