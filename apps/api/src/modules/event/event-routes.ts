import type { FastifyInstance } from "fastify";
import { registerEventAccessPassRoutes } from "./event-access-pass-routes.js";
import { registerEventCoreRoutes } from "./event-core-routes.js";
import type { RegisterEventRoutesOptions } from "./event-route-shared.js";

export async function registerEventRoutes(
  app: FastifyInstance,
  options: RegisterEventRoutesOptions
): Promise<void> {
  await registerEventCoreRoutes(app, options);
  await registerEventAccessPassRoutes(app, options);
}
