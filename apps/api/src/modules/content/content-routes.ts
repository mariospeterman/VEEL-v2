import type { FastifyInstance } from "fastify";
import { registerContentCoreRoutes } from "./content-core-routes.js";
import type { RegisterContentRoutesOptions } from "./content-route-shared.js";
import { registerContentUploadRoutes } from "./content-upload-routes.js";
import { registerContentWebhookRoutes } from "./content-webhook-routes.js";

export async function registerContentRoutes(
  app: FastifyInstance,
  options: RegisterContentRoutesOptions
): Promise<void> {
  await registerContentWebhookRoutes(app, options);
  await registerContentCoreRoutes(app, options);
  await registerContentUploadRoutes(app, options);
}
