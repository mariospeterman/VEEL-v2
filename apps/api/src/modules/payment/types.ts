import type { components } from "@veel/contracts";

export type CreatePaymentIntentRequest = components["schemas"]["CreatePaymentIntentRequest"];
export type PaymentIntent = components["schemas"]["PaymentIntent"];
export type ProductType = components["schemas"]["ProductType"];
export type SubmitPaymentSignatureRequest = components["schemas"]["SubmitPaymentSignatureRequest"];
export type TransactionRequest = components["schemas"]["TransactionRequest"];

export interface CreatePaymentIntentInput {
  supabaseUserId: string;
  idempotencyKey: string;
  requestHash: string;
  productType: ProductType;
  targetId: string;
  amountMinor: number;
  currency: "SOL";
  solanaCluster: "devnet" | "mainnet-beta";
  treasuryWallet: string;
  referenceAddress: string;
  expiresAt: Date;
}

export interface FindPaymentIntentInput {
  supabaseUserId: string;
  paymentIntentId: string;
}

export interface RecordTransactionRequestInput {
  supabaseUserId: string;
  paymentIntentId: string;
  transactionRequestUrl: string;
}

export interface RecordPaymentSubmissionInput {
  supabaseUserId: string;
  paymentIntentId: string;
  signature: string;
  settlement: PaymentSettlementResult;
}

export interface StoredPaymentIntent extends PaymentIntent {
  referenceAddress: string;
  treasuryWallet: string;
  solanaCluster: "devnet" | "mainnet-beta";
  expiresAt: Date;
  requestHash: string;
}

export interface PaymentRepository {
  createOrReuseIntent(input: CreatePaymentIntentInput): Promise<StoredPaymentIntent>;
  findIntent(input: FindPaymentIntentInput): Promise<StoredPaymentIntent | null>;
  recordTransactionRequest(input: RecordTransactionRequestInput): Promise<TransactionRequest | null>;
  recordSubmission(input: RecordPaymentSubmissionInput): Promise<void>;
  close?(): Promise<void>;
}

export interface PaymentSettlementInput {
  signature: string;
  referenceAddress: string;
  treasuryWallet: string;
  amountMinor: number;
}

export interface PaymentSettlementResult {
  confirmed: boolean;
  failureCode?: string;
}

export interface PaymentSettlementVerifier {
  verifyNativeSolTransfer(input: PaymentSettlementInput): Promise<PaymentSettlementResult>;
}
