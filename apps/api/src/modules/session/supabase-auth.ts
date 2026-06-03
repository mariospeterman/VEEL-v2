import { createClient } from "@supabase/supabase-js";
import type { ServerEnv } from "@veel/config";
import type { SupabaseAuthVerifier, VerifiedSupabaseSession } from "./types.js";

const missingSupabaseConfig = "SUPABASE_AUTH_NOT_CONFIGURED";

export class SupabaseAuthConfigurationError extends Error {
  constructor() {
    super(missingSupabaseConfig);
    this.name = "SupabaseAuthConfigurationError";
  }
}

export function createSupabaseAuthVerifier(config: ServerEnv): SupabaseAuthVerifier {
  const supabaseKey =
    config.SUPABASE_PUBLISHABLE_KEY ?? config.SUPABASE_SECRET_KEY ?? config.SUPABASE_SERVICE_ROLE_KEY;

  if (!config.SUPABASE_URL || !supabaseKey) {
    return {
      async verifyBearerToken() {
        throw new SupabaseAuthConfigurationError();
      }
    };
  }

  const supabase = createClient(config.SUPABASE_URL, supabaseKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false
    }
  });

  return {
    async verifyBearerToken(token: string): Promise<VerifiedSupabaseSession | null> {
      const { data, error } = await supabase.auth.getClaims(token);

      if (error || !data?.claims?.sub) {
        return null;
      }

      const claims = data.claims;

      return {
        supabaseUserId: claims.sub,
        email: typeof claims.email === "string" ? claims.email : null,
        role: typeof claims.role === "string" ? claims.role : null
      };
    }
  };
}
