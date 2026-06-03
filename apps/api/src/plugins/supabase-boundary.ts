import fp from "fastify-plugin";

export interface SupabaseBoundary {
  url?: string;
  hasServiceRoleKey: boolean;
}

declare module "fastify" {
  interface FastifyInstance {
    supabaseBoundary: SupabaseBoundary;
  }
}

export const supabaseBoundaryPlugin = fp(async (app) => {
  const boundary: SupabaseBoundary = {
    hasServiceRoleKey: Boolean(app.config.SUPABASE_SERVICE_ROLE_KEY)
  };

  if (app.config.SUPABASE_URL) {
    boundary.url = app.config.SUPABASE_URL;
  }

  app.decorate("supabaseBoundary", boundary);
});
