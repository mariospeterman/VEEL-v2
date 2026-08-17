import type { FastifyInstance } from "fastify";
import { hashIdempotencyPayload } from "../../shared/idempotency.js";
import { mutationRateLimit } from "../../shared/rate-limits.js";
import {
  PaymentCommercialPolicyIdempotencyConflictError,
  PaymentCommercialPolicyRepositoryConfigurationError
} from "../payment/payment-commercial-policy-repository.js";
import type { AdminPaymentCommercialPolicyPatchRequest } from "../payment/types.js";
import {
  requireAdminAccess,
  requireAdminMutation,
  type RegisterAdminRoutesOptions
} from "./admin-route-auth.js";

const productTypes = new Set([
  "support",
  "content_unlock",
  "paid_message",
  "live_pass",
  "event_access_pass"
]);
const currencies = new Set(["SOL", "USDC"]);

export function registerAdminPaymentCommercialPolicyRoutes(
  app: FastifyInstance,
  options: RegisterAdminRoutesOptions
): void {
  app.get("/v1/admin/payments/commercial-policies", async (request, reply) => {
    const allowed = await requireAdminAccess(request, reply, options);
    if (!allowed) return reply;
    if (!options.paymentCommercialPolicyRepository) {
      return reply.code(503).send({
        code: "service_unavailable",
        message: "Payment commercial policy storage is not configured"
      });
    }

    try {
      return reply.code(200).send(await options.paymentCommercialPolicyRepository.listOverrides());
    } catch (error) {
      if (error instanceof PaymentCommercialPolicyRepositoryConfigurationError) {
        return reply.code(503).send({
          code: "service_unavailable",
          message: "Payment commercial policy storage is not configured"
        });
      }
      throw error;
    }
  });

  app.patch(
    "/v1/admin/payments/commercial-policies/:productType/:currency",
    mutationRateLimit("adminMutation"),
    async (request, reply) => {
      const params = request.params as { productType?: string; currency?: string };
      if (!params.productType || !productTypes.has(params.productType) ||
          !params.currency || !currencies.has(params.currency)) {
        return reply.code(404).send({ code: "not_found", message: "Payment policy was not found" });
      }

      const mutation = await requireAdminMutation<AdminPaymentCommercialPolicyPatchRequest>(
        request,
        reply,
        options,
        { action: "payment_commercial_policy_updated" },
        validatePolicyPatch
      );
      if (!mutation) return reply;
      if (!options.paymentCommercialPolicyRepository) {
        return reply.code(503).send({
          code: "service_unavailable",
          message: "Payment commercial policy storage is not configured"
        });
      }

      try {
        const policy = await options.paymentCommercialPolicyRepository.updateOverride({
          supabaseUserId: mutation.supabaseUserId,
          productType: params.productType as "support" | "content_unlock" | "paid_message" | "live_pass" | "event_access_pass",
          currency: params.currency as "SOL" | "USDC",
          body: mutation.body,
          idempotencyKey: mutation.idempotencyKey,
          requestHash: hashIdempotencyPayload({
            productType: params.productType,
            currency: params.currency,
            ...mutation.body
          })
        });
        return reply.code(200).send(policy);
      } catch (error) {
        if (error instanceof PaymentCommercialPolicyIdempotencyConflictError) {
          return reply.code(409).send({
            code: "conflict",
            message: "Idempotency key was already used for a different payment policy update"
          });
        }
        if (error instanceof PaymentCommercialPolicyRepositoryConfigurationError) {
          return reply.code(503).send({
            code: "service_unavailable",
            message: "Payment commercial policy storage is not configured"
          });
        }
        throw error;
      }
    }
  );
}

function validatePolicyPatch(
  body: Partial<AdminPaymentCommercialPolicyPatchRequest> | undefined
): string | null {
  if (!body) return "Request body is required";
  if (!Number.isSafeInteger(body.minimumAmountMinor) || Number(body.minimumAmountMinor) < 1) {
    return "minimumAmountMinor must be a positive safe integer";
  }
  if (!Number.isInteger(body.platformFeeBps) || Number(body.platformFeeBps) < 0 || Number(body.platformFeeBps) > 9999) {
    return "platformFeeBps must be between 0 and 9999";
  }
  if (!Number.isInteger(body.referralShareOfPlatformFeeBps) || Number(body.referralShareOfPlatformFeeBps) < 0 || Number(body.referralShareOfPlatformFeeBps) > 10000) {
    return "referralShareOfPlatformFeeBps must be between 0 and 10000";
  }
  if (!Number.isInteger(body.quoteTtlSeconds) || Number(body.quoteTtlSeconds) < 60 || Number(body.quoteTtlSeconds) > 1800) {
    return "quoteTtlSeconds must be between 60 and 1800";
  }
  if (body.state !== "active" && body.state !== "inactive") return "state is invalid";
  if (typeof body.reason !== "string" || body.reason.trim().length < 3 || body.reason.length > 500) {
    return "reason must contain 3 to 500 characters";
  }
  return null;
}
