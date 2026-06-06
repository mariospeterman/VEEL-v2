import type { components } from "@veel/contracts";

export type CreateRefundDisputeRequest = components["schemas"]["CreateRefundDisputeRequest"];
export type RefundDisputeRequest = components["schemas"]["RefundDisputeRequest"];
export type RefundDisputeRequestPage = components["schemas"]["RefundDisputeRequestPage"];

export interface ListRefundDisputeRequestsInput {
  supabaseUserId: string;
  cursor?: string;
}

export interface CreateRefundDisputeRequestInput {
  supabaseUserId: string;
  idempotencyKey: string;
  body: CreateRefundDisputeRequest;
}

export interface RefundRepository {
  listRequests(input: ListRefundDisputeRequestsInput): Promise<RefundDisputeRequestPage>;
  createRequest(input: CreateRefundDisputeRequestInput): Promise<RefundDisputeRequest | null>;
  close?(): Promise<void>;
}
