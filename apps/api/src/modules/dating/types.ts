import type { components } from "@veel/contracts";

export type ActivateDatingRequest = components["schemas"]["ActivateDatingRequest"];
export type DatingFeedItem = components["schemas"]["DatingFeedItem"];
export type DatingFeedPage = components["schemas"]["DatingFeedPage"];
export type DatingMatch = components["schemas"]["DatingMatch"];
export type DatingMatchPage = components["schemas"]["DatingMatchPage"];
export type DatingProfile = components["schemas"]["DatingProfile"];
export type DatingSwipeRequest = components["schemas"]["DatingSwipeRequest"];
export type DatingSwipeResult = components["schemas"]["DatingSwipeResult"];
export type UpdateDatingPreferencesRequest = components["schemas"]["UpdateDatingPreferencesRequest"];

export interface ActivateDatingInput {
  supabaseUserId: string;
  consentVersion: string;
}

export interface UpdateDatingPreferencesInput {
  supabaseUserId: string;
  body: UpdateDatingPreferencesRequest;
}

export interface ListDatingFeedInput {
  supabaseUserId: string;
  limit: number;
  cursor?: string;
}

export interface CreateDatingSwipeInput {
  supabaseUserId: string;
  idempotencyKey: string;
  requestHash: string;
  body: DatingSwipeRequest;
}

export interface ListDatingMatchesInput {
  supabaseUserId: string;
  limit: number;
  cursor?: string;
}

export interface ArchiveDatingMatchInput {
  supabaseUserId: string;
  matchId: string;
}

export interface DatingRepository {
  activate(input: ActivateDatingInput): Promise<DatingProfile>;
  updatePreferences(input: UpdateDatingPreferencesInput): Promise<DatingProfile | null>;
  listFeed(input: ListDatingFeedInput): Promise<DatingFeedPage | null>;
  createSwipe(input: CreateDatingSwipeInput): Promise<DatingSwipeResult | null>;
  listMatches(input: ListDatingMatchesInput): Promise<DatingMatchPage>;
  archiveMatch(input: ArchiveDatingMatchInput): Promise<DatingMatch | null>;
  close?(): Promise<void>;
}
