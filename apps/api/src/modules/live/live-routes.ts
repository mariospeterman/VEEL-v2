import type { FastifyInstance } from "fastify";
import { registerLiveChatRoutes } from "./live-chat-routes.js";
import { registerLivePassRoutes } from "./live-pass-routes.js";
import type { RegisterLiveRoutesOptions } from "./live-route-shared.js";
import { registerLiveRoomRoutes } from "./live-room-routes.js";

export async function registerLiveRoutes(
  app: FastifyInstance,
  options: RegisterLiveRoutesOptions
): Promise<void> {
  await registerLiveRoomRoutes(app, options);
  await registerLivePassRoutes(app, options);
  await registerLiveChatRoutes(app, options);
}
