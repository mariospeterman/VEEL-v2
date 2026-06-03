import type { components } from "@veel/contracts";

export type SessionState = components["schemas"]["SessionState"];
export type UserResource = components["schemas"]["User"];
export type AppAccessState = components["schemas"]["AppAccessState"];

export interface VerifiedSupabaseSession {
  supabaseUserId: string;
  email?: string | null;
  role?: string | null;
}

export interface SupabaseAuthVerifier {
  verifyBearerToken(token: string): Promise<VerifiedSupabaseSession | null>;
}

export interface SessionProfile {
  id: string;
  state: string;
  handle?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
}

export interface SessionRepository {
  ensureUserForSupabaseId(supabaseUserId: string): Promise<void>;
  findProfileBySupabaseUserId(supabaseUserId: string): Promise<SessionProfile | null>;
  close?(): Promise<void>;
}
