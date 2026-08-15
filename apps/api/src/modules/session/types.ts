import type { components } from "@veel/contracts";

export type SessionState = components["schemas"]["SessionState"];
export type UserResource = components["schemas"]["User"];
export type AppAccessState = components["schemas"]["AppAccessState"];

export interface VerifiedApplicationSession {
  userId: string;
  /** @deprecated Canonical user-id compatibility alias for repositories pending the identity-parameter migration. */
  supabaseUserId: string;
  sessionId: string;
  authenticatedAt: Date;
  authenticationMethod: "wallet" | "supabase_recovery";
}

export interface ApplicationSessionVerifier {
  verifyToken(token: string): Promise<VerifiedApplicationSession | null>;
}

export interface VerifiedRecoveryIdentity {
  provider: "supabase";
  providerSubject: string;
  email: string | null;
}

export interface RecoveryIdentityVerifier {
  verifyToken(token: string): Promise<VerifiedRecoveryIdentity | null>;
}

export interface SessionProfile {
  id: string;
  state: string;
  handle?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
}

export interface SessionRepository {
  findProfileByUserId(userId: string): Promise<SessionProfile | null>;
  findProfileBySupabaseUserId(supabaseUserId: string): Promise<SessionProfile | null>;
  close?(): Promise<void>;
}
