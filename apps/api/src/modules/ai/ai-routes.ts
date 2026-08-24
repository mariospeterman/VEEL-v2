import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AdminRepository } from "../admin/types.js";
import type { AgeRepository } from "../age/types.js";
import { unauthorizedResponse, verifyRequestSession } from "../auth/http-auth.js";
import type { SessionRepository, ApplicationSessionVerifier } from "../session/types.js";
import { AiRepositoryConfigurationError } from "./ai-repository.js";
import {
  allowedToolsForScope,
  buildCapabilities,
  isScope,
  isToolName,
  prepareToolResult,
  redactInput,
  summarizeInput
} from "./ai-route-policy.js";
import type {
  AiRepository,
  AiSession,
  AiToolCall,
  AiToolName,
  CreateAiSessionRequest,
  CreateAiToolCallRequest
} from "./types.js";

interface RegisterAiRoutesOptions {
  authVerifier: ApplicationSessionVerifier;
  sessionRepository: SessionRepository;
  ageRepository: AgeRepository;
  adminRepository: AdminRepository;
  aiRepository: AiRepository;
}

export async function registerAiRoutes(
  app: FastifyInstance,
  options: RegisterAiRoutesOptions
): Promise<void> {
  app.get("/v1/ai/capabilities", async (request, reply) => {
    const access = await verifyAiAccess(request, options);
    if (!access.ok) {
      return reply.code(access.statusCode).send(access.body);
    }

    const adminAllowed = await options.adminRepository.hasAdminPermission(
      access.supabaseUserId,
      "admin.ai.read"
    );
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
        ? await options.adminRepository.hasAdminPermission(access.supabaseUserId, "admin.ai.read")
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
        const adminAllowed = await options.adminRepository.hasAdminPermission(
          access.supabaseUserId,
          "admin.ai.read"
        );
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

  if (profile?.state !== "active" || !profile.handle || !profile.displayName || ageStatus.state !== "verified") {
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
