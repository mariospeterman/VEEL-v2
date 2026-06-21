import type { components } from "@veel/contracts";
import type { SettlementKind } from "./payment-amounts.js";

export type CreatePaymentIntentRequest = components["schemas"]["CreatePaymentIntentRequest"];
export type PaymentIntent = components["schemas"]["PaymentIntent"];
export type ProductType = components["schemas"]["ProductType"];
export type SubmitPaymentSignatureRequest = components["schemas"]["SubmitPaymentSignatureRequest"];
export type TransactionRequest = components["schemas"]["TransactionRequest"];
export type TransactionRequestPostRequest = components["schemas"]["TransactionRequestPostRequest"];
export type TransactionRequestPostResponse = components["schemas"]["TransactionRequestPostResponse"];
export type WebhookReceipt = components["schemas"]["WebhookReceipt"];

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
  platformFeeWallet: string;
  platformFeeBps: number;
  settlementKind: SettlementKind;
  creatorUserId?: string | null;
  creatorWallet?: string | null;
  allocationWallet?: string | null;
  allocationAmountMinor?: number | null;
  referenceAddress: string;
  expiresAt: Date;
  referralToken?: string | null;
}

export interface CreateServerPricedPaymentIntentInput extends Omit<CreatePaymentIntentInput, "amountMinor"> {
  amountMinor: number;
}

export interface FindPaymentIntentInput {
  supabaseUserId: string;
  paymentIntentId: string;
}

export interface RecordTransactionRequestInput {
  supabaseUserId: string;
  paymentIntentId: string;
  transactionRequestUrl: string;
  buyerWallet?: string | null;
}

export interface RecordPaymentSubmissionInput {
  supabaseUserId: string;
  paymentIntentId: string;
  signature: string;
  settlement: PaymentSettlementResult;
}

export interface StoredPaymentIntent extends PaymentIntent {
  targetId: string;
  referenceAddress: string;
  treasuryWallet: string;
  settlementKind: SettlementKind;
  buyerWallet: string | null;
  creatorWallet: string;
  platformFeeWallet: string;
  allocationWallet: string | null;
  totalAmountMinor: number;
  creatorAmountMinor: number;
  platformFeeAmountMinor: number;
  allocationAmountMinor: number;
  solanaCluster: "devnet" | "mainnet-beta";
  expiresAt: Date;
  requestHash: string;
  withdrawalWaiverRequired: boolean;
  withdrawalWaiverAcceptedAt: Date | null;
  withdrawalWaiverVersion: string | null;
  termsVersion: string | null;
  durableConfirmationRequired: boolean;
  refundValueBasis: "original_crypto_amount" | "fiat_value_at_purchase" | "manual_resolution";
}

export interface PaymentRepository {
  createOrReuseIntent(input: CreatePaymentIntentInput): Promise<StoredPaymentIntent>;
  findIntent(input: FindPaymentIntentInput): Promise<StoredPaymentIntent | null>;
  recordTransactionRequest(input: RecordTransactionRequestInput): Promise<TransactionRequest | null>;
  recordSubmission(input: RecordPaymentSubmissionInput): Promise<void>;
  close?(): Promise<void>;
}

export interface ProviderPaymentIntentMatch {
  supabaseUserId: string;
  intent: StoredPaymentIntent;
}

export interface RecordSolanaProviderEventInput {
  providerEventId: string;
  eventType: string;
  signature: string;
  referenceAddresses: string[];
  authorizationHash: string | null;
}

export interface UpdateSolanaProviderEventInput {
  providerEventId: string;
  normalizedState: "processed" | "ignored" | "failed";
}

export interface PaymentEvidenceRepository {
  recordSolanaProviderEvent(input: RecordSolanaProviderEventInput): Promise<boolean>;
  findIntentByReference(input: { referenceAddresses: string[] }): Promise<ProviderPaymentIntentMatch | null>;
  updateSolanaProviderEvent(input: UpdateSolanaProviderEventInput): Promise<void>;
  close?(): Promise<void>;
}

export interface PaymentSettlementInput {
  signature: string;
  referenceAddress: string;
  memo: string;
  settlementKind: SettlementKind;
  buyerWallet?: string | null;
  creatorWallet: string;
  platformFeeWallet: string;
  allocationWallet?: string | null;
  treasuryWallet?: string | null;
  totalAmountMinor: number;
  creatorAmountMinor: number;
  platformFeeAmountMinor: number;
  allocationAmountMinor: number;
}

export interface PaymentSettlementResult {
  confirmed: boolean;
  failureCode?: string;
}

export interface PaymentSettlementVerifier {
  verifyNativeSolTransfer(input: PaymentSettlementInput): Promise<PaymentSettlementResult>;
}
