import { createHmac } from "node:crypto";
import type { ServerEnv } from "@veel/config";
import { cursorTimestamp, parseDatabaseDate } from "../../shared/database-timestamp.js";
import type {
  CreateVerificationSessionInput,
  VerificationProviderReconciliation,
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
  reconcileSession?(input: {
    providerReference: string;
    purpose: CreateVerificationSessionInput["purpose"];
  }): Promise<VerificationProviderReconciliation>;
}

type SelectableVerificationProvider = VerificationProviderAdapter["provider"];

interface StaticVerificationProviderWaterfallOptions {
  ageAccessPrimaryProvider?: SelectableVerificationProvider | null;
}

export function createVerificationProviderWaterfall(env: ServerEnv): VerificationProviderWaterfall {
  return createStaticVerificationProviderWaterfall([
    createMockVerificationProviderAdapter(env),
    createDiditVerificationProviderAdapter(env),
    createYotiVerificationProviderAdapter(env),
    createSumsubVerificationProviderAdapter(env),
    createPersonaVerificationProviderAdapter(env),
    createVeriffVerificationProviderAdapter(env)
  ], {
    ageAccessPrimaryProvider: configuredAgeAccessProvider(env)
  });
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
        providerExternalUserId: providerSubjectReference(input),
        providerSessionId: providerReference,
        launchUrl: appendQuery(input.callbackUrl, {
          provider: "mock",
          reference: providerReference
        }),
        expiresAt: expiresInSeconds(15 * 60),
        method: isOrganization ? "kyb_registry" : isAge ? "age_estimation" : "gov_id_selfie",
        assuranceLevel: isOrganization ? "business_verified" : isAge ? "medium" : "documentary",
        reusable: false
      };
    }
  };
}

export function createStaticVerificationProviderWaterfall(
  adapters: VerificationProviderAdapter[],
  options: StaticVerificationProviderWaterfallOptions = {}
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
      const providers = input.purpose === "age_access"
        ? options.ageAccessPrimaryProvider
          ? [options.ageAccessPrimaryProvider]
          : []
        : providerOrder(input.providerPreference);

      for (const provider of providers) {
        const providerAdapters = byProvider.get(provider) ?? [];

        for (const adapter of providerAdapters) {
          if (!adapter.isConfigured(input)) {
            continue;
          }

          await input.onProviderSelected?.({
            provider: adapter.provider,
            method: verificationMethod(input, adapter.provider),
            assuranceLevel: verificationAssurance(input, adapter.provider),
            reusable: false
          });
          // Once a provider call starts its outcome can be ambiguous (for example,
          // a remote session may exist even if the response is lost). Do not open a
          // second provider session automatically. Recovery reuses the durable local
          // reservation and provider reconciliation instead.
          return adapter.createSession(input);
        }
      }

      throw new VerificationProviderUnavailableError();
    },
    async reconcileSession(input) {
      if (input.provider !== "didit" && input.provider !== "yoti") {
        throw new VerificationProviderUnavailableError();
      }
      const provider = input.provider;
      const adapter = (byProvider.get(provider) ?? []).find((candidate) =>
        candidate.reconcileSession && candidate.isConfigured({
          supabaseUserId: "reconciliation",
          purpose: input.purpose as CreateVerificationSessionInput["purpose"],
          providerPreference: provider,
          idempotencyKey: `reconcile:${input.providerReference}`,
          callbackUrl: "https://localhost.invalid/reconciliation",
          webhookBaseUrl: "https://localhost.invalid/reconciliation"
        })
      );
      if (!adapter?.reconcileSession) throw new VerificationProviderUnavailableError();
      return adapter.reconcileSession({
        providerReference: input.providerReference,
        purpose: input.purpose as CreateVerificationSessionInput["purpose"]
      });
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

      const path = "/resources/sdkIntegrations/levels/-/websdkLink";
      const externalUserId = providerSubjectReference(input);
      const body = JSON.stringify({
        ttlInSecs: 1800,
        userId: externalUserId,
        levelName,
        redirect: {
          successUrl: input.callbackUrl,
          rejectUrl: input.callbackUrl
        }
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
      const launchUrl = firstString(responseBody.url);

      if (!launchUrl) {
        throw new VerificationProviderHttpError("sumsub", 502, "Sumsub response is missing a WebSDK launch URL");
      }

      return {
        provider: "sumsub",
        providerReference: externalUserId,
        providerExternalUserId: externalUserId,
        providerApplicantId: null,
        launchUrl,
        expiresAt: expiresInSeconds(1800),
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
        providerExternalUserId: providerSubjectReference(input),
        providerSessionId: id,
        launchUrl: url,
        expiresAt: expiresInSeconds(24 * 60 * 60),
        method: verificationMethod(input, "didit"),
        assuranceLevel: verificationAssurance(input, "didit"),
        reusable: false
      };
    },
    async reconcileSession(input) {
      if (!env.DIDIT_API_KEY) {
        throw new VerificationProviderHttpError("didit", 503, "Didit is not configured");
      }
      const response = await providerFetch(
        "didit",
        `${withoutTrailingSlash(env.DIDIT_API_BASE_URL)}/v3/session/${encodeURIComponent(input.providerReference)}/decision/`,
        {
          method: "GET",
          headers: { "x-api-key": env.DIDIT_API_KEY }
        }
      );
      const body = objectBody(await response.json());
      const decision = objectBody(body.decision, true) ?? body;
      const status = firstString(body.status, decision.status);
      const mapped = mapDiditDecisionStatus(status);
      const occurredAt = parseDate(firstString(
        objectBody(body.decision_trace, true)?.decided_at,
        decision.updated_at,
        body.updated_at
      ));
      const expiresAt = parseDate(firstString(body.expires_at));
      const providerReference = firstString(body.session_id, body.id) ?? input.providerReference;
      return {
        provider: "didit",
        providerReference,
        providerEventId: `${providerReference}:authenticated:${status ?? "unknown"}:${occurredAt ? cursorTimestamp(occurredAt) : "observed"}`,
        eventType: "session.authenticated_result",
        status: mapped.status,
        signatureHash: null,
        occurredAt,
        failureReasonCode: mapped.failureReasonCode,
        identityEvidence: {
          documentApproved: hasApprovedEntries(decision.id_verifications),
          livenessApproved: hasApprovedEntries(decision.liveness_checks),
          faceMatchApproved: hasApprovedEntries(decision.face_matches)
        },
        launchUrl: firstString(body.session_url),
        expiresAt
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
          retry_enabled: true,
          resume_enabled: true,
          synchronous_checks: true,
          reference_id: providerSubjectReference(input),
          callback: { url: input.callbackUrl, auto: true },
          notification_url: `${input.webhookBaseUrl}/yoti`,
          digital_id: {
            allowed: true,
            threshold: 18,
            age_estimation_allowed: true,
            age_estimation_threshold: 25,
            retry_enabled: true,
            retry_limit: 3
          },
          age_estimation: {
            allowed: true,
            threshold: 25,
            level: "PASSIVE",
            retry_enabled: true,
            retry_limit: 3
          },
          doc_scan: {
            allowed: true,
            threshold: 18,
            authenticity: "AUTO",
            level: "PASSIVE",
            retry_enabled: true,
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
        providerExternalUserId: providerSubjectReference(input),
        providerSessionId: id,
        launchUrl: appendQuery(env.YOTI_LAUNCH_BASE_URL, {
          sessionId: id,
          sdkId: env.YOTI_SDK_ID
        }),
        expiresAt: expiresInSeconds(900),
        method: "age_estimation",
        assuranceLevel: "medium",
        reusable: false
      };
    },
    async reconcileSession(input) {
      if (!env.YOTI_SDK_ID || !env.YOTI_API_TOKEN) {
        throw new VerificationProviderHttpError("yoti", 503, "Yoti is not configured");
      }
      const response = await providerFetch(
        "yoti",
        `${withoutTrailingSlash(env.YOTI_API_BASE_URL)}/sessions/${encodeURIComponent(input.providerReference)}/result`,
        {
          method: "GET",
          headers: {
            authorization: `Bearer ${env.YOTI_API_TOKEN}`,
            "yoti-sdk-id": env.YOTI_SDK_ID
          }
        }
      );
      const body = objectBody(await response.json());
      const status = firstString(body.status, body.state)?.toUpperCase() ?? "PENDING";
      const result = firstString(body.result, body.outcome, body.decision)?.toUpperCase() ?? null;
      const mapped = mapYotiResultStatus(status, body.result, result);
      const occurredAt = parseDate(firstString(body.updated_at, body.updatedAt));
      const expiresAt = parseDate(firstString(body.expires_at, body.expiresAt));
      const providerReference = firstString(body.id, body.session_id, body.session_key) ?? input.providerReference;
      return {
        provider: "yoti",
        providerReference,
        providerSubjectReference: firstString(body.reference_id),
        providerEventId: `${providerReference}:authenticated:${status}:${occurredAt ? cursorTimestamp(occurredAt) : "observed"}`,
        eventType: `session.authenticated_result.${firstString(body.method)?.toLowerCase() ?? "unknown"}`,
        status: mapped.status,
        signatureHash: null,
        occurredAt,
        failureReasonCode: mapped.failureReasonCode,
        launchUrl: appendQuery(env.YOTI_LAUNCH_BASE_URL, {
          sessionId: providerReference,
          sdkId: env.YOTI_SDK_ID
        }),
        expiresAt
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
          "key-inflection": "kebab",
          "persona-version": "2026-09-29"
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
          meta: {}
        })
      });
      const body = objectBody(await response.json());
      const data = objectBody(body.data);
      const attributes = objectBody(data.attributes, true);
      const id = firstString(data.id);

      if (!id) {
        throw new VerificationProviderHttpError("persona", 502, "Persona response is missing an inquiry id");
      }

      const launchResponse = await providerFetch(
        "persona",
        `${env.PERSONA_API_BASE_URL}/api/v1/inquiries/${encodeURIComponent(id)}/generate-one-time-link`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${env.PERSONA_API_KEY}`,
            "content-type": "application/json",
            "idempotency-key": `${input.idempotencyKey}:launch`,
            "key-inflection": "kebab",
            "persona-version": "2026-09-29"
          },
          body: JSON.stringify({
            meta: {
              "redirect-uri": input.callbackUrl
            }
          })
        }
      );
      const launchBody = objectBody(await launchResponse.json());
      const launchMeta = objectBody(launchBody.meta, true);
      const url = firstString(launchMeta?.["one-time-link"], launchMeta?.["one_time_link"]);
      if (!url) {
        throw new VerificationProviderHttpError("persona", 502, "Persona response is missing a one-time link");
      }

      return {
        provider: "persona",
        providerReference: id,
        providerExternalUserId: providerSubjectReference(input),
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
            vendorData: providerSubjectReference(input),
            endUserId: providerSubjectReference(input)
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
        providerExternalUserId: providerSubjectReference(input),
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

function configuredAgeAccessProvider(env: ServerEnv): SelectableVerificationProvider | null {
  if (env.AGE_VERIFICATION_DRIVER) {
    return env.AGE_VERIFICATION_DRIVER;
  }

  if (env.NODE_ENV !== "production" && env.AGE_VERIFICATION_ALLOW_MOCK_PROVIDER) {
    return "didit";
  }

  return null;
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
  if (provider === "yoti") return "age_estimation";
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
  const date = parseDatabaseDate(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function mapDiditDecisionStatus(status: string | null): {
  status: VerificationProviderReconciliation["status"];
  failureReasonCode: string | null;
} {
  if (status === "Approved") return { status: "valid", failureReasonCode: null };
  if (status === "Declined") return { status: "blocked", failureReasonCode: "Declined" };
  if (["Expired", "Abandoned", "Kyc Expired"].includes(status ?? "")) {
    return { status: "invalid", failureReasonCode: status };
  }
  return { status: "pending", failureReasonCode: null };
}

function mapYotiResultStatus(
  status: string,
  rawResult: unknown,
  result: string | null
): {
  status: VerificationProviderReconciliation["status"];
  failureReasonCode: string | null;
} {
  if (status === "COMPLETE") {
    if (rawResult === false || ["FAIL", "FAILED", "UNDER", "NO", "DECLINED"].includes(result ?? "")) {
      return { status: "blocked", failureReasonCode: result ?? "FAIL" };
    }
    return { status: "valid", failureReasonCode: null };
  }
  // Yoti can emit FAIL before a retry/resume later completes successfully.
  // Keep the authenticated current FAIL recoverable; only COMPLETE decides pass/fail.
  if (status === "FAIL") return { status: "pending", failureReasonCode: "FAIL" };
  if (["CANCELLED", "EXPIRED"].includes(status)) {
    return { status: "invalid", failureReasonCode: status };
  }
  return { status: "pending", failureReasonCode: null };
}

function hasApprovedEntries(value: unknown): boolean {
  return Array.isArray(value) && value.some((entry) => {
    const record = objectBody(entry, true);
    return firstString(record?.status)?.toLowerCase() === "approved";
  });
}

function expiresInSeconds(seconds: number): Date {
  return new Date(Date.now() + seconds * 1000);
}
