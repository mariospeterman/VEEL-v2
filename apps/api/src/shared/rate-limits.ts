import type { RouteShorthandOptions } from "fastify";

type MutationRateLimitPreset =
  | "walletMutation"
  | "paymentMutation"
  | "accessMutation"
  | "messageMutation"
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
  mutualsMutation: { max: 30, timeWindow: "1 minute" },
  ageMutation: { max: 8, timeWindow: "1 minute" },
  adminMutation: { max: 30, timeWindow: "1 minute" }
};

export function mutationRateLimit(preset: MutationRateLimitPreset): RouteShorthandOptions {
  return {
    config: {
      rateLimit: mutationRateLimitPresets[preset]
    }
  };
}
