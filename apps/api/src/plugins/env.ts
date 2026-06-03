import { parseServerEnv, type ServerEnv } from "@veel/config";
import fp from "fastify-plugin";

declare module "fastify" {
  interface FastifyInstance {
    config: ServerEnv;
  }
}

export const envPlugin = fp(async (app) => {
  app.decorate("config", parseServerEnv(process.env));
});
