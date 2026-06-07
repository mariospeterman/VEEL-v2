import type { FastifyInstance } from "fastify";
import { registerContentUnlockPaymentRoutes } from "./payment-content-unlock-routes.js";
import { registerPaymentIntentRoutes } from "./payment-intent-routes.js";
import type { RegisterPaymentRoutesOptions } from "./payment-route-shared.js";
import { registerSolanaIndexerWebhookRoute } from "./payment-webhook-routes.js";

export type { RegisterPaymentRoutesOptions } from "./payment-route-shared.js";

export async function registerPaymentRoutes(
  app: FastifyInstance,
  options: RegisterPaymentRoutesOptions
): Promise<void> {
  await registerSolanaIndexerWebhookRoute(app, options);
  await registerPaymentIntentRoutes(app, options);
  await registerContentUnlockPaymentRoutes(app, options);
}
