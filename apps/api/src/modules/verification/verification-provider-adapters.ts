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
  provider: Extract<VerificationProvider, "sumsub" | "didit" | "yoti" | "persona" | "veriff">;
  isConfigured(input: CreateVerificationSessionInput): boolean;
  createSession(input: CreateVerificationSessionInput): Promise<VerificationProviderSession>;
}

export function createVerificationProviderWaterfall(env: ServerEnv): VerificationProviderWaterfall {
  return createStaticVerificationProviderWaterfall([
    createMockVerificationProviderAdapter(env),
    createDiditVerificationProviderAdapter(env),
    createYotiVerificationProviderAdapter(env),
    createSumsubVerificationProviderAdapter(env),
    createPersonaVerificationProviderAdapter(env),
    createVeriffVerificationProviderAdapter(env)
  ]);
}

const mockVerificationProviderReferencePrefix = "mock-verification:";

export function isMockVerificationProviderReference(env: ServerEnv, providerReference: string): boolean {
  return (
    env.NODE_ENV !== "production" &&
    env.AGE_VERIFICATION_ALLOW_MOCK_PROVIDER &&
    providerReference.startsWith(mockVerificationProviderReferencePrefix)
  );
}

function createMockVerificationProviderAdapter(env: ServerEnv): VerificationProviderAdapter {
  return {
    provider: "didit",
    isConfigured() {
      return env.NODE_ENV !== "production" && env.AGE_VERIFICATION_ALLOW_MOCK_PROVIDER;
    },
    async createSession(input) {
      const providerReference = `${mockVerificationProviderReferencePrefix}${input.purpose}:${input.organizationId ?? input.supabaseUserId}:${input.idempotencyKey}`;
      const isOrganization = input.purpose === "org_kyb";
      const isAge = input.purpose === "age_access";

      return {
        provider: "didit",
        providerReference,
        providerSessionId: providerReference,
        launchUrl: appendQuery(input.callbackUrl, {
          provider: "mock",
          reference: providerReference
        }),
        expiresAt: expiresInSeconds(15 * 60),
        method: isOrganization ? "kyb_registry" : isAge ? "reusable_age" : "gov_id_selfie",
        assuranceLevel: isOrganization ? "business_verified" : isAge ? "medium" : "documentary",
        reusable: true
      };
    }
  };
}

export function createStaticVerificationProviderWaterfall(
  adapters: VerificationProviderAdapter[]
): VerificationProviderWaterfall {
  const byProvider = new Map<VerificationProviderAdapter["provider"], VerificationProviderAdapter[]>();

  for (const adapter of adapters) {
    byProvider.set(adapter.provider, [
      ...(byProvider.get(adapter.provider) ?? []),
      adapter
    ]);
  }

  return {
    async createSession(input) {
      for (const provider of providerOrder(input.providerPreference)) {
        const providerAdapters = byProvider.get(provider) ?? [];

        for (const adapter of providerAdapters) {
          if (!adapter.isConfigured(input)) {
            continue;
          }

          try {
            return await adapter.createSession(input);
          } catch (error) {
            if (error instanceof VerificationProviderHttpError && error.status >= 500) {
              continue;
            }

            throw error;
          }
        }
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
        launchUrl: appendQuery(input.callbackUrl, { provider: "sumsub", token }),
        expiresAt: expiresInSeconds(600),
        method: verificationMethod(input, "sumsub"),
        assuranceLevel: verificationAssurance(input, "sumsub")
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

      const response = await providerFetch("didit", `${withoutTrailingSlash(env.DIDIT_API_BASE_URL)}/v3/session/`, {
        method: "POST",
        headers: {
          "x-api-key": env.DIDIT_API_KEY,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          workflow_id: workflowId,
          callback: input.callbackUrl,
          callback_method: "completer",
          vendor_data: providerSubjectReference(input),
          metadata: {
            purpose: input.purpose,
            subject: input.purpose === "org_kyb"
              ? "organization"
              : input.purpose === "performer_eligibility"
                ? "performer"
                : "user",
            ...(input.purpose === "age_access" ? { rule: "over_18" } : {}),
            ...(input.policyVersion ? { policy_version: input.policyVersion } : {})
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
        method: verificationMethod(input, "didit"),
        assuranceLevel: verificationAssurance(input, "didit"),
        reusable: false
      };
    }
  };
}

function createYotiVerificationProviderAdapter(env: ServerEnv): VerificationProviderAdapter {
  return {
    provider: "yoti",
    isConfigured(input) {
      return input.purpose === "age_access" && Boolean(env.YOTI_SDK_ID && env.YOTI_API_TOKEN);
    },
    async createSession(input) {
      if (!env.YOTI_SDK_ID || !env.YOTI_API_TOKEN) {
        throw new VerificationProviderHttpError("yoti", 503, "Yoti is not configured");
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
          callback: { url: input.callbackUrl, auto: true },
          notification_url: `${input.webhookBaseUrl}/yoti`,
          digital_id: {
            allowed: true,
            threshold: 18,
            age_estimation_allowed: true,
            age_estimation_threshold: 25,
            retry_limit: 3
          },
          age_estimation: { allowed: true, threshold: 25, level: "PASSIVE", retry_limit: 3 },
          doc_scan: {
            allowed: true,
            threshold: 18,
            authenticity: "AUTO",
            level: "PASSIVE",
            retry_limit: 3
          },
          credit_card: { allowed: false }
        })
      });
      const body = objectBody(await response.json());
      const id = firstString(body.session_id, body.sessionId, body.id);

      if (!id) {
        throw new VerificationProviderHttpError("yoti", 502, "Yoti response is missing a session id");
      }

      return {
        provider: "yoti",
        providerReference: id,
        providerSessionId: id,
        launchUrl: appendQuery(env.YOTI_LAUNCH_BASE_URL, {
          sessionId: id,
          sdkId: env.YOTI_SDK_ID
        }),
        expiresAt: expiresInSeconds(900),
        method: "reusable_age",
        assuranceLevel: "medium",
        reusable: true
      };
    }
  };
}

function createPersonaVerificationProviderAdapter(env: ServerEnv): VerificationProviderAdapter {
  return {
    provider: "persona",
    isConfigured(input) {
      return Boolean(env.PERSONA_API_KEY && personaTemplateId(env, input));
    },
    async createSession(input) {
      const templateId = personaTemplateId(env, input);

      if (!env.PERSONA_API_KEY || !templateId) {
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
              "inquiry-template-id": templateId,
              "reference-id": providerSubjectReference(input),
              note: input.purpose === "org_kyb"
                ? "WeVid organization KYB"
                : input.purpose === "age_access"
                  ? "WeVid age assurance"
                  : "WeVid creator KYC"
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
        method: verificationMethod(input, "persona"),
        assuranceLevel: verificationAssurance(input, "persona")
      };
    }
  };
}

function createVeriffVerificationProviderAdapter(env: ServerEnv): VerificationProviderAdapter {
  return {
    provider: "veriff",
    isConfigured(input) {
      return input.purpose !== "org_kyb" && Boolean(env.VERIFF_API_KEY);
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
  if (preference === "reusable_first") {
    return ["didit", "yoti", "persona", "sumsub", "veriff"] as const;
  }

  if (preference === "provider_first") {
    return ["didit", "sumsub", "persona", "veriff", "yoti"] as const;
  }

  return [
    preference,
    ...(["didit", "yoti", "sumsub", "persona", "veriff"] as const).filter((provider) => provider !== preference)
  ];
}

function sumsubLevelName(env: ServerEnv, input: CreateVerificationSessionInput) {
  if (input.purpose === "age_access") return env.SUMSUB_LEVEL_NAME;
  return input.purpose === "org_kyb"
    ? env.SUMSUB_ORG_KYB_LEVEL_NAME ?? env.SUMSUB_LEVEL_NAME
    : env.SUMSUB_CREATOR_KYC_LEVEL_NAME ?? env.SUMSUB_LEVEL_NAME;
}

function diditWorkflowId(env: ServerEnv, input: CreateVerificationSessionInput) {
  if (input.purpose === "age_access") return env.DIDIT_AGE_WORKFLOW_ID;
  if (input.purpose === "adult_publisher_eligibility" || input.purpose === "performer_eligibility") {
    return env.DIDIT_ADULT_PUBLISHER_WORKFLOW_ID;
  }
  return input.purpose === "org_kyb" ? env.DIDIT_KYB_WORKFLOW_ID : env.DIDIT_KYC_WORKFLOW_ID;
}

function personaTemplateId(env: ServerEnv, input: CreateVerificationSessionInput) {
  if (input.purpose === "age_access") return env.PERSONA_TEMPLATE_ID;
  if (input.purpose === "org_kyb") return env.PERSONA_ORG_KYB_TEMPLATE_ID;
  return env.PERSONA_CREATOR_KYC_TEMPLATE_ID ?? env.PERSONA_TEMPLATE_ID;
}

function providerSubjectReference(input: CreateVerificationSessionInput) {
  if (input.subjectReference) return input.subjectReference;
  return input.purpose === "org_kyb" ? `org:${input.organizationId ?? input.supabaseUserId}` : `user:${input.supabaseUserId}`;
}

function verificationMethod(
  input: CreateVerificationSessionInput,
  provider: VerificationProvider
): VerificationProviderSession["method"] {
  if (input.purpose === "org_kyb") return "kyb_registry";
  if (input.purpose !== "age_access") return "gov_id_selfie";
  if (provider === "didit") return "age_estimation";
  if (provider === "yoti") return "reusable_age";
  if (provider === "persona") return "doc_scan";
  return "gov_id_selfie";
}

function verificationAssurance(
  input: CreateVerificationSessionInput,
  provider: VerificationProvider
): VerificationProviderSession["assuranceLevel"] {
  if (input.purpose === "org_kyb") return "business_verified";
  if (input.purpose !== "age_access") return "documentary";
  return provider === "didit" || provider === "yoti" ? "medium" : "documentary";
}

function appendQuery(baseUrl: string, params: Record<string, string>) {
  const search = new URLSearchParams(params);
  return `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}${search.toString()}`;
}

function withoutTrailingSlash(value: string) {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

async function providerFetch(provider: VerificationProvider, url: string, init: RequestInit): Promise<Response> {
  const response = await fetch(url, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(10_000)
  });

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
