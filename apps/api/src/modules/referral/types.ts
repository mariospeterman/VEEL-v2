import type { components } from "@veel/contracts";

export type CreateReferralTokenRequest = components["schemas"]["CreateReferralTokenRequest"];
export type ReferralToken = components["schemas"]["ReferralToken"];
export type ReferralActivityPage = components["schemas"]["ReferralActivityPage"];

export interface ReferralRepository {
  createOrReuseToken(input: CreateReferralTokenInput): Promise<ReferralToken>;
  listActivity(input: ListReferralActivityInput): Promise<ReferralActivityPage>;
  close?(): Promise<void>;
}

export interface CreateReferralTokenInput {
  supabaseUserId: string;
  idempotencyKey: string;
  requestHash: string;
  token: string;
  targetType: "content" | "profile" | "event";
  targetId: string;
  channel: "external" | "partner" | "internal";
  url: string;
}

export interface ListReferralActivityInput {
  supabaseUserId: string;
  cursor?: string;
  limit: number;
}
