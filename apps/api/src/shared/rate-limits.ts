import type { RouteShorthandOptions } from "fastify";
import { contractRouteSchema } from "./openapi-route-schema.js";

type MutationRateLimitPreset =
  | "walletMutation"
  | "paymentMutation"
  | "accessMutation"
  | "messageMutation"
  | "socialMutation"
  | "mutualsMutation"
  | "ageMutation"
  | "adminMutation";

const mutationRateLimitPresets: Record<
  MutationRateLimitPreset,
  {
    max: number;
    timeWindow: string;
  }
> = {
  walletMutation: { max: 20, timeWindow: "1 minute" },
  paymentMutation: { max: 12, timeWindow: "1 minute" },
  accessMutation: { max: 20, timeWindow: "1 minute" },
  messageMutation: { max: 30, timeWindow: "1 minute" },
  socialMutation: { max: 40, timeWindow: "1 minute" },
  mutualsMutation: { max: 30, timeWindow: "1 minute" },
  ageMutation: { max: 8, timeWindow: "1 minute" },
  adminMutation: { max: 30, timeWindow: "1 minute" }
};

export function mutationRateLimit(
  preset: MutationRateLimitPreset,
  operationId?: string
): RouteShorthandOptions {
  return {
    ...(operationId ? { schema: contractRouteSchema(operationId) } : {}),
    config: {
      rateLimit: mutationRateLimitPresets[preset]
    }
  };
}
