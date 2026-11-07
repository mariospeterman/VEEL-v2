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
      const claimsResult = await supabase.auth.getClaims(token);

      if (claimsResult.error || !claimsResult.data?.claims) {
        return null;
      }

      const userResult = await supabase.auth.getUser(token);
      if (userResult.error || !userResult.data.user) return null;

      return normalizeSupabaseRecoveryIdentity(
        claimsResult.data.claims as Record<string, unknown>,
        userResult.data.user
      );
    }
  };
}

export function normalizeSupabaseRecoveryIdentity(
  claims: Record<string, unknown>,
  user: {
    id?: unknown;
    aud?: unknown;
    role?: unknown;
    email?: unknown;
    is_anonymous?: unknown;
  },
  now = new Date()
): VerifiedRecoveryIdentity | null {
  const providerSubject = typeof claims.sub === "string" ? claims.sub : null;
  const providerSessionId = typeof claims.session_id === "string" ? claims.session_id : null;
  const audience = typeof claims.aud === "string"
    ? [claims.aud]
    : Array.isArray(claims.aud)
      ? claims.aud
      : [];

  if (
    !providerSubject ||
    !providerSessionId ||
    !isUuid(providerSubject) ||
    !isUuid(providerSessionId) ||
    user.id !== providerSubject ||
    !audience.includes("authenticated") ||
    claims.role !== "authenticated" ||
    claims.is_anonymous !== false ||
    user.aud !== "authenticated" ||
    (user.role !== undefined && user.role !== "authenticated") ||
    user.is_anonymous === true
  ) {
    return null;
  }

  if (
    typeof claims.email === "string" &&
    typeof user.email === "string" &&
    claims.email !== user.email
  ) {
    return null;
  }

  const authenticatedAt = newestAuthenticationTime(claims.amr, now);
  if (!authenticatedAt) return null;

  return {
    provider: "supabase",
    providerSubject,
    providerSessionId,
    authenticatedAt,
    email: typeof user.email === "string" ? user.email : null
  };
}

function newestAuthenticationTime(value: unknown, now: Date): Date | null {
  if (!Array.isArray(value) || value.length === 0) return null;

  let newestTimestamp = -1;
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const method = (entry as Record<string, unknown>).method;
    const timestamp = (entry as Record<string, unknown>).timestamp;
    if (
      typeof method !== "string" ||
      method.length === 0 ||
      typeof timestamp !== "number" ||
      !Number.isInteger(timestamp) ||
      timestamp <= 0
    ) {
      return null;
    }

    const timestampMs = timestamp * 1000;
    if (!Number.isSafeInteger(timestampMs) || timestampMs > now.getTime()) return null;
    if (method === "token_refresh" || method === "anonymous") continue;
    newestTimestamp = Math.max(newestTimestamp, timestampMs);
  }

  return newestTimestamp > 0 ? new Date(newestTimestamp) : null;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
