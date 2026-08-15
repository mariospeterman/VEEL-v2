import { createClient } from "@supabase/supabase-js";
import type { ServerEnv } from "@veel/config";
import type { WalletAuthRepository } from "../auth/wallet-auth-repository.js";
import type {
  ApplicationSessionVerifier,
  RecoveryIdentityVerifier,
  VerifiedRecoveryIdentity
} from "./types.js";

const missingSupabaseConfig = "SUPABASE_AUTH_NOT_CONFIGURED";

export class SupabaseAuthConfigurationError extends Error {
  constructor() {
    super(missingSupabaseConfig);
    this.name = "SupabaseAuthConfigurationError";
  }
}

export function createApplicationSessionVerifier(
  walletAuthRepository: WalletAuthRepository
): ApplicationSessionVerifier {
  return {
    async verifyToken(token) {
      if (!token.startsWith("wevid_session_")) {
        return null;
      }

      return walletAuthRepository.verifySessionToken(token);
    }
  };
}

export function createSupabaseRecoveryVerifier(config: ServerEnv): RecoveryIdentityVerifier {
  const supabaseKey =
    config.SUPABASE_PUBLISHABLE_KEY ?? config.SUPABASE_SECRET_KEY ?? config.SUPABASE_SERVICE_ROLE_KEY;

  if (!config.SUPABASE_URL || !supabaseKey) {
    return {
      async verifyToken() {
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
    async verifyToken(token: string): Promise<VerifiedRecoveryIdentity | null> {
      const { data, error } = await supabase.auth.getClaims(token);

      if (error || !data?.claims?.sub) {
        return null;
      }

      return {
        provider: "supabase",
        providerSubject: data.claims.sub,
        email: typeof data.claims.email === "string" ? data.claims.email : null
      };
    }
  };
}
