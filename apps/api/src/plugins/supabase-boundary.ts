import fp from "fastify-plugin";

export interface SupabaseBoundary {
  url?: string;
  projectRef?: string;
  hasPublishableKey: boolean;
  hasSecretKey: boolean;
  hasServiceRoleKey: boolean;
}

declare module "fastify" {
  interface FastifyInstance {
    supabaseBoundary: SupabaseBoundary;
  }
}

export const supabaseBoundaryPlugin = fp(async (app) => {
  const boundary: SupabaseBoundary = {
    hasPublishableKey: Boolean(app.config.SUPABASE_PUBLISHABLE_KEY),
    hasSecretKey: Boolean(app.config.SUPABASE_SECRET_KEY),
    hasServiceRoleKey: Boolean(app.config.SUPABASE_SERVICE_ROLE_KEY)
  };

  if (app.config.SUPABASE_URL) {
    boundary.url = app.config.SUPABASE_URL;
  }

  if (app.config.SUPABASE_PROJECT_REF) {
    boundary.projectRef = app.config.SUPABASE_PROJECT_REF;
  }

  app.decorate("supabaseBoundary", boundary);
});
