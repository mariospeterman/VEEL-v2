import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AdminRepository } from "../admin/types.js";
import type { AgeRepository } from "../age/types.js";
import { unauthorizedResponse, verifyRequestSession } from "../auth/http-auth.js";
import type { SessionRepository, SupabaseAuthVerifier } from "../session/types.js";
import { AiRepositoryConfigurationError } from "./ai-repository.js";
import type {
  AiCapabilities,
  AiRepository,
  AiSession,
  AiSessionScope,
  AiToolCall,
  AiToolName,
  CreateAiSessionRequest,
  CreateAiToolCallRequest
} from "./types.js";

interface RegisterAiRoutesOptions {
  authVerifier: SupabaseAuthVerifier;
  sessionRepository: SessionRepository;
  ageRepository: AgeRepository;
  adminRepository: AdminRepository;
  aiRepository: AiRepository;
}

const toolScopes: Record<AiSessionScope, AiToolName[]> = {
  user_self_service: ["explain_app_state", "summarize_own_activity", "find_own_purchases"],
  creator_helper: [
    "explain_app_state",
    "summarize_own_activity",
    "find_own_purchases",
    "draft_caption",
    "suggest_hashtags",
    "prepare_event_copy",
    "summarize_creator_metrics",
    "payment_lookup"
  ],
  admin_ops: [
    "explain_app_state",
    "payment_lookup",
    "provider_health_summary",
    "moderation_queue_summary",
    "draft_support_reply",
    "prepare_refund_decision",
    "prepare_ban_or_restriction",
    "summarize_creator_metrics"
  ]
};

const confirmationRequiredTools = new Set<AiToolName>([
  "draft_support_reply",
  "prepare_refund_decision",
  "prepare_ban_or_restriction"
]);

const knownTools = new Set<AiToolName>(Object.values(toolScopes).flat());

export async function registerAiRoutes(
  app: FastifyInstance,
  options: RegisterAiRoutesOptions
): Promise<void> {
  app.get("/v1/ai/capabilities", async (request, reply) => {
    const access = await verifyAiAccess(request, options);
    if (!access.ok) {
      return reply.code(access.statusCode).send(access.body);
    }

    const adminAllowed = await options.adminRepository.hasAdminAccess(access.supabaseUserId);
    return reply.send(buildCapabilities(adminAllowed));
  });

  app.post("/v1/ai/sessions", async (request, reply) => {
    const access = await verifyAiAccess(request, options);
    if (!access.ok) {
      return reply.code(access.statusCode).send(access.body);
    }

    const idempotencyKey = request.headers["idempotency-key"];
    if (typeof idempotencyKey !== "string" || idempotencyKey.length === 0) {
      return reply.code(400).send(validationResponse("Idempotency-Key header is required"));
    }

    const body = request.body as Partial<CreateAiSessionRequest>;
    if (!isScope(body.scope)) {
      return reply.code(400).send(validationResponse("scope is required"));
    }

    const adminAllowed =
      body.scope === "admin_ops"
        ? await options.adminRepository.hasAdminAccess(access.supabaseUserId)
        : false;

    if (body.scope === "admin_ops" && !adminAllowed) {
      return reply.code(403).send({
        code: "forbidden",
        message: "Admin AI tools require staff access"
      });
    }

    const allowedTools = allowedToolsForScope(body.scope, body.requestedTools ?? []);
    if (allowedTools.length === 0) {
      return reply.code(400).send(validationResponse("No requested tools are available for this scope"));
    }

    try {
      const session = await options.aiRepository.createOrReuseSession({
        supabaseUserId: access.supabaseUserId,
        scope: body.scope,
        allowedTools,
        idempotencyKey,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000)
      });

      return reply.code(201).send(session);
    } catch (error) {
      if (error instanceof AiRepositoryConfigurationError) {
        request.log.warn({ error }, "AI repository is not configured");
        return reply.code(503).send(serviceUnavailableResponse("AI assistant is not configured"));
      }

      throw error;
    }
  });

  app.post("/v1/ai/sessions/:aiSessionId/tool-calls", async (request, reply) => {
    const access = await verifyAiAccess(request, options);
    if (!access.ok) {
      return reply.code(access.statusCode).send(access.body);
    }

    const idempotencyKey = request.headers["idempotency-key"];
    if (typeof idempotencyKey !== "string" || idempotencyKey.length === 0) {
      return reply.code(400).send(validationResponse("Idempotency-Key header is required"));
    }

    const params = request.params as { aiSessionId?: string };
    const body = request.body as Partial<CreateAiToolCallRequest>;
    if (!params.aiSessionId) {
      return reply.code(400).send(validationResponse("aiSessionId is required"));
    }
    if (!isToolName(body.toolName)) {
      return reply.code(400).send(validationResponse("toolName is required"));
    }

    try {
      const session = await options.aiRepository.findSessionForSupabaseUser({
        sessionId: params.aiSessionId,
        supabaseUserId: access.supabaseUserId
      });

      if (!session) {
        return reply.code(404).send({
          code: "not_found",
          message: "AI session not found"
        });
      }

      if (session.state !== "active" || new Date(session.expiresAt).getTime() <= Date.now()) {
        return reply.code(403).send({
          code: "forbidden",
          message: "AI session is not active"
        });
      }

      if (!session.allowedTools.includes(body.toolName)) {
        const blocked = await recordBlockedToolCall({
          options,
          access,
          session,
          toolName: body.toolName,
          input: body.input,
          idempotencyKey,
          reason: "Tool is not allowed for this AI session"
        });

        return reply.code(403).send(blocked);
      }

      if (session.scope === "admin_ops") {
        const adminAllowed = await options.adminRepository.hasAdminAccess(access.supabaseUserId);
        if (!adminAllowed) {
          return reply.code(403).send({
            code: "forbidden",
            message: "Admin AI tools require staff access"
          });
        }
      }

      const prepared = prepareToolResult(session, body.toolName, body.input ?? {}, body.confirmed === true);
      const toolCall = await options.aiRepository.createOrReuseToolCall({
        session,
        supabaseUserId: access.supabaseUserId,
        toolName: body.toolName,
        inputSummary: summarizeInput(body.input),
        outputSummary: prepared.outputSummary,
        inputRedacted: redactInput(body.input),
        outputRedacted: prepared.result,
        state: prepared.state,
        confirmationState: prepared.confirmationState,
        affectedResource: prepared.affectedResource,
        idempotencyKey
      });

      return reply.code(201).send(toolCall);
    } catch (error) {
      if (error instanceof AiRepositoryConfigurationError) {
        request.log.warn({ error }, "AI repository is not configured");
        return reply.code(503).send(serviceUnavailableResponse("AI assistant is not configured"));
      }

      throw error;
    }
  });
}

type AiAccessResult =
  | { ok: true; supabaseUserId: string }
  | {
      ok: false;
      statusCode: 401 | 403;
      body: { code: string; message: string };
    };

async function verifyAiAccess(
  request: FastifyRequest,
  options: RegisterAiRoutesOptions
): Promise<AiAccessResult> {
  const verifiedSession = await verifyRequestSession(request, options.authVerifier);

  if (!verifiedSession) {
    return {
      ok: false,
      statusCode: 401,
      body: unauthorizedResponse("Missing or invalid bearer token")
    };
  }

  const [profile, ageStatus] = await Promise.all([
    options.sessionRepository.findProfileBySupabaseUserId(verifiedSession.supabaseUserId),
    options.ageRepository.findLatestAgeStatusBySupabaseUserId(verifiedSession.supabaseUserId)
  ]);

  if (!profile?.handle || !profile.displayName || ageStatus.state !== "verified") {
    return {
      ok: false,
      statusCode: 403,
      body: {
        code: "forbidden",
        message: "AI assistant requires profile and age verification"
      }
    };
  }

  return { ok: true, supabaseUserId: verifiedSession.supabaseUserId };
}

function isScope(scope: unknown): scope is AiSessionScope {
  return scope === "user_self_service" || scope === "creator_helper" || scope === "admin_ops";
}

function isToolName(toolName: unknown): toolName is AiToolName {
  return typeof toolName === "string" && knownTools.has(toolName as AiToolName);
}

function allowedToolsForScope(scope: AiSessionScope, requestedTools: AiToolName[]): AiToolName[] {
  const allowed = toolScopes[scope];
  if (requestedTools.length === 0) {
    return allowed;
  }

  return requestedTools.filter((tool) => allowed.includes(tool));
}

function buildCapabilities(adminAllowed: boolean): AiCapabilities {
  const scopes = Object.entries(toolScopes).filter(([scope]) => scope !== "admin_ops" || adminAllowed) as Array<
    [AiSessionScope, AiToolName[]]
  >;

  return {
    items: scopes.map(([scope, allowedTools]) => ({
      scope,
      allowedTools,
      canStartSession: allowedTools.length > 0,
      confirmationRequiredTools: allowedTools.filter((tool) => confirmationRequiredTools.has(tool))
    }))
  };
}

async function recordBlockedToolCall(input: {
  options: RegisterAiRoutesOptions;
  access: { supabaseUserId: string };
  session: AiSession;
  toolName: AiToolName;
  input: unknown;
  idempotencyKey: string;
  reason: string;
}): Promise<AiToolCall> {
  return input.options.aiRepository.createOrReuseToolCall({
    session: input.session,
    supabaseUserId: input.access.supabaseUserId,
    toolName: input.toolName,
    inputSummary: summarizeInput(input.input),
    outputSummary: input.reason,
    inputRedacted: redactInput(input.input),
    outputRedacted: { message: input.reason },
    state: "blocked",
    confirmationState: "rejected",
    affectedResource: null,
    idempotencyKey: input.idempotencyKey
  });
}

function prepareToolResult(
  session: AiSession,
  toolName: AiToolName,
  input: unknown,
  confirmed: boolean
): {
  state: AiToolCall["state"];
  confirmationState: AiToolCall["confirmationState"];
  outputSummary: string;
  result: Record<string, unknown>;
  affectedResource: NonNullable<AiToolCall["affectedResource"]> | null;
} {
  const affectedResource = affectedResourceFromInput(input);
  if (confirmationRequiredTools.has(toolName) && !confirmed) {
    return {
      state: "prepared",
      confirmationState: "required",
      outputSummary: `${toolName} prepared and awaiting explicit admin confirmation`,
      result: {
        status: "confirmation_required",
        draft: safeDraftForTool(toolName),
        nextStep: "Submit a confirmed tool call after human review."
      },
      affectedResource
    };
  }

  const result = safeResultForTool(session.scope, toolName, input);
  return {
    state: "executed",
    confirmationState: confirmationRequiredTools.has(toolName) ? "confirmed" : "not_required",
    outputSummary: result.summary,
    result,
    affectedResource
  };
}

function safeResultForTool(
  scope: AiSessionScope,
  toolName: AiToolName,
  input: unknown
): Record<string, unknown> & { summary: string } {
  switch (toolName) {
    case "draft_caption":
      return {
        summary: "Caption draft prepared from creator-provided context",
        draft: "New drop is live. Tap in for the full set and save your favorites.",
        safetyNote: "Creator must review labels and publish manually."
      };
    case "suggest_hashtags":
      return {
        summary: "Hashtag suggestions prepared",
        hashtags: ["#veel", "#creator", "#behindthescenes", "#exclusive"],
        safetyNote: "Review tags before publishing."
      };
    case "prepare_event_copy":
      return {
        summary: "Event copy prepared from creator-provided details",
        title: "Members-only live event",
        description: "A private creator-hosted session with ticketed access.",
        safetyNote: "Creator must review price, capacity, and visibility manually."
      };
    case "provider_health_summary":
      return {
        summary: "Provider health summary prepared",
        providerHealth: "Use the admin ops dashboard for live provider counts.",
        safetyNote: "No provider secrets or raw payloads included."
      };
    case "moderation_queue_summary":
      return {
        summary: "Moderation queue summary prepared",
        queueHealth: "Use admin reports and content queues for live case counts.",
        safetyNote: "No private content or message bodies included."
      };
    case "payment_lookup":
      return {
        summary: "Payment lookup guidance prepared",
        resourceId: affectedResourceFromInput(input)?.id ?? null,
        safetyNote: scope === "admin_ops" ? "Admin lookup only returns sanitized projections." : "User lookup is limited to own activity."
      };
    case "summarize_creator_metrics":
      return {
        summary: "Creator metrics summary prepared",
        metrics: "Use the creator dashboard for backend-derived current metrics.",
        safetyNote: "No fabricated stats."
      };
    case "summarize_own_activity":
      return {
        summary: "Own activity summary prepared",
        activity: "Purchases, Access Passes, wallet records, and referrals are available in Activity.",
        safetyNote: "Only own account activity is eligible."
      };
    case "find_own_purchases":
      return {
        summary: "Own purchase lookup guidance prepared",
        activityRoute: "/activity",
        safetyNote: "Access grants come only from backend settlement records."
      };
    case "draft_support_reply":
      return {
        summary: "Support reply draft confirmed for human-controlled workflow",
        draft: "Thanks for the details. We reviewed the account-safe records and will follow up with the next step.",
        safetyNote: "This tool does not send messages."
      };
    case "prepare_refund_decision":
      return {
        summary: "Refund decision prepared for human-controlled workflow",
        recommendation: "Review settlement, entitlement, and support context before any refund action.",
        safetyNote: "This tool does not refund, revoke, or mutate ledger state."
      };
    case "prepare_ban_or_restriction":
      return {
        summary: "Restriction decision prepared for human-controlled workflow",
        recommendation: "Review policy evidence and apply any action in the admin moderation surface.",
        safetyNote: "This tool does not ban or restrict users."
      };
    case "explain_app_state":
    default:
      return {
        summary: "App state explanation prepared",
        explanation: "Veel gates premium actions through profile, age, wallet, backend settlement, and server-side access checks.",
        safetyNote: "No privileged state changed."
      };
  }
}

function safeDraftForTool(toolName: AiToolName): string {
  if (toolName === "prepare_refund_decision") {
    return "Refund decision package prepared for admin review.";
  }
  if (toolName === "prepare_ban_or_restriction") {
    return "Restriction decision package prepared for admin review.";
  }
  return "Support reply draft prepared for admin review.";
}

function summarizeInput(input: unknown): string {
  const keys = input && typeof input === "object" && !Array.isArray(input) ? Object.keys(input) : [];
  return keys.length === 0 ? "No structured input" : `Structured input keys: ${keys.sort().join(", ")}`;
}

function redactInput(input: unknown): Record<string, unknown> {
  const keys = input && typeof input === "object" && !Array.isArray(input) ? Object.keys(input) : [];
  return {
    keyCount: keys.length,
    keys: keys.sort().slice(0, 20)
  };
}

function affectedResourceFromInput(input: unknown): NonNullable<AiToolCall["affectedResource"]> | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }

  const resourceType = "resourceType" in input ? input.resourceType : null;
  const resourceId = "resourceId" in input ? input.resourceId : null;
  if (typeof resourceType !== "string") {
    return null;
  }
  if (!["content", "event", "payment", "provider", "support_case", "report", "user", "none"].includes(resourceType)) {
    return null;
  }

  return {
    type: resourceType as NonNullable<AiToolCall["affectedResource"]>["type"],
    id: typeof resourceId === "string" ? resourceId : null
  };
}

function validationResponse(message: string) {
  return {
    code: "validation_failed",
    message
  };
}

function serviceUnavailableResponse(message: string) {
  return {
    code: "provider_unavailable",
    message
  };
}
