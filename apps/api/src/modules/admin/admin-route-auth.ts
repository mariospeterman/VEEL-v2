import type { FastifyReply, FastifyRequest } from "fastify";
import {
  idempotencyKeyValidationResponse,
  readIdempotencyKey,
  type ValidationErrorResponse
} from "../../shared/idempotency.js";
import { unauthorizedResponse, verifyRequestSession } from "../auth/http-auth.js";
import type { ApplicationSessionVerifier } from "../session/types.js";
import type { LiveProviderAdapter, LiveRepository } from "../live/types.js";
import { AdminRepositoryConfigurationError } from "./admin-repository.js";
import type { AdminRepository } from "./types.js";
import type { AdminPermission } from "./admin-permissions.js";
import type { PaymentCommercialPolicyRepository } from "../payment/types.js";

export interface RegisterAdminRoutesOptions {
  authVerifier: ApplicationSessionVerifier;
  adminRepository: AdminRepository;
  liveRepository: LiveRepository;
  liveProvider: LiveProviderAdapter;
  paymentCommercialPolicyRepository?: PaymentCommercialPolicyRepository;
}

export interface AdminMutationContext<Body> {
  supabaseUserId: string;
  idempotencyKey: string;
  body: Body;
  authenticatedAt: Date;
}

export interface AdminRoutePolicy {
  permission: AdminPermission;
  mutation?: boolean;
  reasonRequired?: boolean;
}

export function adminListInput(query: { q?: string; cursor?: string }): { query?: string; cursor?: string } {
  return {
    ...(query.q ? { query: query.q } : {}),
    ...(query.cursor ? { cursor: query.cursor } : {})
  };
}

export async function requireAdminAccess(
  request: FastifyRequest,
  reply: FastifyReply,
  options: RegisterAdminRoutesOptions,
  permission: AdminPermission
): Promise<boolean> {
  const access = await requireAdminAccessWithUser(request, reply, options, { permission });
  return Boolean(access);
}

export async function requireAdminAccessWithUser(
  request: FastifyRequest,
  reply: FastifyReply,
  options: RegisterAdminRoutesOptions,
  policy: AdminRoutePolicy
): Promise<{ supabaseUserId: string; authenticatedAt: Date } | null> {
  const verifiedSession = await verifyRequestSession(request, options.authVerifier);

  if (!verifiedSession) {
    reply.code(401).send(unauthorizedResponse("Missing or invalid bearer token"));
    return null;
  }

  try {
    const isAdmin = await options.adminRepository.hasAdminPermission(
      verifiedSession.supabaseUserId,
      policy.permission
    );

    if (!isAdmin) {
      request.log.warn(
        {
          policyPermission: policy.permission,
          policyMutation: policy.mutation === true
        },
        "Admin route policy denied request"
      );
      reply.code(403).send({
        code: "forbidden",
        message: "You do not have permission for this admin action"
      });
      return null;
    }

    return {
      supabaseUserId: verifiedSession.supabaseUserId,
      authenticatedAt: verifiedSession.authenticatedAt
    };
  } catch (error) {
    if (error instanceof AdminRepositoryConfigurationError) {
      request.log.warn({ error }, "Admin repository is not configured");
      reply.code(403).send({
        code: "forbidden",
        message: "Admin access is not configured"
      });
      return null;
    }

    throw error;
  }
}

export async function requireAdminMutation<Body>(
  request: FastifyRequest,
  reply: FastifyReply,
  options: RegisterAdminRoutesOptions,
  policy: AdminRoutePolicy,
  validateBody: (body: Partial<Body> | undefined) => string | null
): Promise<AdminMutationContext<Body> | null> {
  const access = await requireAdminAccessWithUser(request, reply, options, {
    ...policy,
    mutation: true,
    reasonRequired: true
  });
  if (!access) return null;

  const idempotencyKey = readIdempotencyKey(request);
  if (!idempotencyKey) {
    reply.code(400).send(idempotencyKeyValidationResponse());
    return null;
  }

  const body = request.body as Partial<Body> | undefined;
  const validationError = validateBody(body);
  if (validationError) {
    reply.code(400).send(validationResponse(validationError));
    return null;
  }

  request.log.info(
    {
      policyPermission: policy.permission,
      idempotencyKey
    },
    "Admin mutation accepted by route policy"
  );

  return {
    supabaseUserId: access.supabaseUserId,
    idempotencyKey,
    body: body as Body,
    authenticatedAt: access.authenticatedAt
  };
}

export async function featureFlagEnabled(repository: AdminRepository, key: string): Promise<boolean> {
  const flags = await repository.listFeatureFlags();
  const flag = flags.items.find((item) => item.key === key);

  if (!flag || flag.state !== "active") {
    return false;
  }

  if (typeof flag.value !== "object" || flag.value === null || Array.isArray(flag.value)) {
    return false;
  }

  return (flag.value as { enabled?: unknown }).enabled === true;
}

function validationResponse(message: string): ValidationErrorResponse {
  return {
    code: "validation_failed",
    message
  };
}
