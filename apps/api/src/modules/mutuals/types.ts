import type { components } from "@veel/contracts";

export type ActivateMutualsRequest = components["schemas"]["ActivateMutualsRequest"];
export type MutualsFeedItem = components["schemas"]["MutualsFeedItem"];
export type MutualsFeedPage = components["schemas"]["MutualsFeedPage"];
export type Mutual = components["schemas"]["Mutual"];
export type MutualsPage = components["schemas"]["MutualsPage"];
export type MutualsProfile = components["schemas"]["MutualsProfile"];
export type MutualsInterestRequest = components["schemas"]["MutualsInterestRequest"];
export type MutualsInterestResult = components["schemas"]["MutualsInterestResult"];
export type UpdateMutualsPreferencesRequest = components["schemas"]["UpdateMutualsPreferencesRequest"];

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
  mutualId: string;
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
