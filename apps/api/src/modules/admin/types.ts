import type { components } from "@veel/contracts";

export type AdminOpsSummary = components["schemas"]["AdminOpsSummary"];
export type AdminPaymentIntent = components["schemas"]["AdminPaymentIntent"];
export type AdminUnlock = components["schemas"]["AdminUnlock"];
export type AdminProviderEvent = components["schemas"]["AdminProviderEvent"];

export interface AdminRepository {
  hasAdminAccess(supabaseUserId: string): Promise<boolean>;
  getOpsSummary(): Promise<AdminOpsSummary>;
  listPaymentIntents(input: { query?: string; cursor?: string }): Promise<{
    items: AdminPaymentIntent[];
    nextCursor: string | null;
  }>;
  listUnlocks(input: { query?: string; cursor?: string }): Promise<{
    items: AdminUnlock[];
    nextCursor: string | null;
  }>;
  listProviderEvents(input: { cursor?: string }): Promise<{
    items: AdminProviderEvent[];
    nextCursor: string | null;
  }>;
  close?(): Promise<void>;
}
