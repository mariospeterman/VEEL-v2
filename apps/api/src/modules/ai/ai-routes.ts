import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AdminRepository } from "../admin/types.js";
import type { AgeRepository } from "../age/types.js";
import { unauthorizedResponse, verifyRequestSession } from "../auth/http-auth.js";
import type { SessionRepository, ApplicationSessionVerifier } from "../session/types.js";
import { buildCapabilities } from "./ai-route-policy.js";
import type { AiRepository } from "./types.js";

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
    if (!access.ok) return reply.code(access.statusCode).send(access.body);

    const adminAllowed = await options.adminRepository.hasAdminPermission(
      access.supabaseUserId,
      "admin.ai.read"
    );
    return reply.send(buildCapabilities(adminAllowed));
  });

  app.post("/v1/ai/sessions", async (request, reply) => {
    const access = await verifyAiAccess(request, options);
    if (!access.ok) return reply.code(access.statusCode).send(access.body);

    return reply.code(503).send(legacyAiUnavailable());
  });

  app.post("/v1/ai/sessions/:aiSessionId/tool-calls", async (request, reply) => {
    const access = await verifyAiAccess(request, options);
    if (!access.ok) return reply.code(access.statusCode).send(access.body);

    return reply.code(503).send(legacyAiUnavailable());
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

function legacyAiUnavailable() {
  return {
    code: "provider_unavailable",
    message: "The legacy in-app AI assistant is disabled; configured connected-assistant tools remain separate"
  };
}
