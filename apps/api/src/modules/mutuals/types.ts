import type { components } from "@veel/contracts";

export type ActivateMutualsRequest = components["schemas"]["ActivateDatingRequest"];
export type MutualsFeedItem = components["schemas"]["DatingFeedItem"];
export type MutualsFeedPage = components["schemas"]["DatingFeedPage"];
export type Mutual = components["schemas"]["DatingMatch"];
export type MutualsPage = components["schemas"]["DatingMatchPage"];
export type MutualsProfile = components["schemas"]["DatingProfile"];
export type MutualsInterestRequest = components["schemas"]["DatingSwipeRequest"];
export type MutualsInterestResult = components["schemas"]["DatingSwipeResult"];
export type UpdateMutualsPreferencesRequest = components["schemas"]["UpdateDatingPreferencesRequest"];

export interface ActivateMutualsInput {
  supabaseUserId: string;
  consentVersion: string;
}

export interface UpdateMutualsPreferencesInput {
  supabaseUserId: string;
  body: UpdateMutualsPreferencesRequest;
}

export interface ListMutualsFeedInput {
  supabaseUserId: string;
  limit: number;
  cursor?: string;
}

export interface CreateMutualsInterestInput {
  supabaseUserId: string;
  idempotencyKey: string;
  requestHash: string;
  body: MutualsInterestRequest;
}

export interface ListMutualsInput {
  supabaseUserId: string;
  limit: number;
  cursor?: string;
}

export interface ArchiveMutualInput {
  supabaseUserId: string;
  matchId: string;
}

export interface MutualsRepository {
  activate(input: ActivateMutualsInput): Promise<MutualsProfile>;
  updatePreferences(input: UpdateMutualsPreferencesInput): Promise<MutualsProfile | null>;
  listFeed(input: ListMutualsFeedInput): Promise<MutualsFeedPage | null>;
  createInterest(input: CreateMutualsInterestInput): Promise<MutualsInterestResult | null>;
  listMutuals(input: ListMutualsInput): Promise<MutualsPage>;
  archiveMutual(input: ArchiveMutualInput): Promise<Mutual | null>;
  close?(): Promise<void>;
}
