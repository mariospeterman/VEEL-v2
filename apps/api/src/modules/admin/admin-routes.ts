import type { FastifyInstance } from "fastify";
import type { RegisterAdminRoutesOptions } from "./admin-route-auth.js";
import { registerAdminComplianceRoutes } from "./admin-compliance-routes.js";
import { registerAdminEventProviderRoutes } from "./admin-event-provider-routes.js";
import { registerAdminModerationRoutes } from "./admin-moderation-routes.js";
import { registerAdminOpsRoutes } from "./admin-ops-routes.js";
import { registerAdminOrganizationRoutes } from "./admin-organization-routes.js";
import { registerAdminReviewRoutes } from "./admin-review-routes.js";

export async function registerAdminRoutes(
  app: FastifyInstance,
  options: RegisterAdminRoutesOptions
): Promise<void> {
  registerAdminOpsRoutes(app, options);
  registerAdminModerationRoutes(app, options);
  registerAdminReviewRoutes(app, options);
  registerAdminEventProviderRoutes(app, options);
  registerAdminComplianceRoutes(app, options);
  registerAdminOrganizationRoutes(app, options);
}
