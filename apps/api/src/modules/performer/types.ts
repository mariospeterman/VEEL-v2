import type { VerificationProviderSession } from "../verification/types.js";

export type PerformerAllowedUse =
  | "capture"
  | "upload"
  | "distribution"
  | "monetisation"
  | "live"
  | "replay"
  | "promotion";

export interface PerformerConsentRequestResource {
  id: string;
  contentId: string;
  contentRevision: number;
  contentCaption: string | null;
  mediaType: string;
  rating: "adult" | "explicit";
  performerLabel: string;
  linkedUser: boolean;
  state: "pending" | "verification_required" | "accepted" | "rejected" | "expired" | "revoked" | "superseded";
  verificationState: string;
  allowedUses: PerformerAllowedUse[];
  expiresAt: string | null;
}

export interface CreatePerformerRequestResult {
  request: PerformerConsentRequestResource;
  invitationCreated: boolean;
}

export interface PerformerRepository {
  listForContent(input: { supabaseUserId: string; contentId: string }): Promise<PerformerConsentRequestResource[]>;
  createRequest(input: {
    supabaseUserId: string;
    contentId: string;
    performerHandle?: string | null;
    externalLabel?: string | null;
    allowedUses: PerformerAllowedUse[];
    invitationTokenHash?: string | null;
    invitationExpiresAt?: Date | null;
    idempotencyKey: string;
  }): Promise<CreatePerformerRequestResult | null>;
  findInvitation(input: { invitationTokenHash: string }): Promise<PerformerConsentRequestResource | null>;
  createVerificationSession(input: {
    invitationTokenHash: string;
    providerSession: VerificationProviderSession;
  }): Promise<string | null>;
  respondAsLinkedUser(input: {
    supabaseUserId: string;
    requestId: string;
    decision: "accept" | "reject";
  }): Promise<PerformerConsentRequestResource | null>;
  respondToInvitation(input: {
    invitationTokenHash: string;
    decision: "accept" | "reject";
  }): Promise<PerformerConsentRequestResource | null>;
  close?(): Promise<void>;
}
