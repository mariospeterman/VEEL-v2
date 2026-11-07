import type { components } from "@veel/contracts";
import type { SettlementKind } from "./payment-amounts.js";

export type PaymentSettlementFailureCode =
  | "not_found"
  | "block_time_missing"
  | "transient"
  | "transaction_failed"
  | "intent_expired_before_settlement"
  | "signed_transaction_expired"
  | "reference_missing"
  | "memo_missing"
  | "creator_split_paid_treasury"
  | "transfer_mismatch"
  | "invalid_expected_amounts"
  | "invalid_signature";

export type PaymentSettlementIntentState =
  | "submitted"
  | "confirmed"
  | "failed"
  | "expired";

export type CreatePaymentIntentRequest = components["schemas"]["CreatePaymentIntentRequest"];
export type PaymentIntent = components["schemas"]["PaymentIntent"];
export type ProductType = components["schemas"]["ProductType"];
export type SubmitPaymentSignatureRequest = components["schemas"]["SubmitPaymentSignatureRequest"];
export type AcceptPaymentIntentTermsRequest = components["schemas"]["AcceptPaymentIntentTermsRequest"];
export type TransactionRequest = components["schemas"]["TransactionRequest"];
export type TransactionRequestPostRequest = components["schemas"]["TransactionRequestPostRequest"];
export type TransactionRequestPostResponse = components["schemas"]["TransactionRequestPostResponse"];
export type WebhookReceipt = components["schemas"]["WebhookReceipt"];
export type AdminPaymentCommercialPolicy = components["schemas"]["AdminPaymentCommercialPolicy"];
export type AdminPaymentCommercialPolicyPatchRequest =
  components["schemas"]["AdminPaymentCommercialPolicyPatchRequest"];

export interface CreatePaymentIntentInput {
  supabaseUserId: string;
  idempotencyKey: string;
  requestHash: string;
  productType: ProductType;
  targetId: string;
  amountMinor: number;
  currency: "SOL" | "USDC";
  tokenMint?: string | null;
  tokenDecimals?: number | null;
  solanaCluster: "devnet" | "mainnet-beta";
  treasuryWallet: string;
  platformFeeWallet: string;
  minimumAmountMinor: number;
  platformFeeBps: number;
  referralShareOfPlatformFeeBps: number;
  settlementKind: SettlementKind;
  creatorUserId?: string | null;
  creatorWallet?: string | null;
  referenceAddress: string;
  quotedAt: Date;
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
  publicTransactionRequestUrl: string;
  storedTransactionRequestUrl: string;
  checkoutTokenHash: string;
}

export interface AcceptPaymentIntentTermsInput {
  supabaseUserId: string;
  paymentIntentId: string;
  idempotencyKey: string;
  requestHash: string;
  termsVersion: string;
  withdrawalWaiverVersion: string;
  immediateAccessAcknowledged: boolean;
}

export interface FindCheckoutPaymentIntentInput {
  checkoutTokenHash: string;
}

export interface RecordCheckoutPayerInput extends FindCheckoutPaymentIntentInput {
  buyerWallet: string;
}

export interface RecordPaymentSubmissionInput {
  supabaseUserId: string;
  paymentIntentId: string;
  idempotencyKey?: string;
  signature: string;
  settlement: PaymentSettlementResult;
  writeGuard?: {
    state: "pending" | "transaction_requested" | "submitted";
    submittedSignature: string | null;
  };
}

export interface FindPaymentSubmissionCommandReceiptInput {
  supabaseUserId: string;
  paymentIntentId: string;
  idempotencyKey: string;
  signature: string;
}

export interface StoredPaymentIntent extends PaymentIntent {
  targetId: string;
  referenceAddress: string;
  treasuryWallet: string;
  settlementKind: SettlementKind;
  buyerWallet: string | null;
  creatorWallet: string;
  enterpriseWallet: string | null;
  platformFeeWallet: string;
  referralWallet: string | null;
  totalAmountMinor: number;
  creatorSideProceedsMinor: number;
  creatorAmountMinor: number;
  enterpriseManagementAmountMinor: number;
  platformFeeGrossMinor: number;
  platformFeeAmountMinor: number;
  referralAmountMinor: number;
  tokenMint?: string | null;
  tokenDecimals?: number | null;
  solanaCluster: "devnet" | "mainnet-beta";
  expiresAt: Date;
  quotedAt: Date;
  minimumAmountMinor: number;
  platformFeeBps: number;
  referralShareOfPlatformFeeBps: number;
  commercialPolicySource: "environment_default" | "admin_override" | "legacy_environment_default";
  commercialPolicyRevision: number;
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
  findCheckoutIntent(input: FindCheckoutPaymentIntentInput): Promise<StoredPaymentIntent | null>;
  acceptCheckoutTerms?(input: AcceptPaymentIntentTermsInput): Promise<StoredPaymentIntent | null>;
  recordTransactionRequest(
    input: RecordTransactionRequestInput
  ): Promise<Pick<TransactionRequest, "transactionRequestUrl" | "expiresAt"> | null>;
  recordCheckoutPayer(input: RecordCheckoutPayerInput): Promise<StoredPaymentIntent | null>;
  hasSubmissionCommandReceipt?(
    input: FindPaymentSubmissionCommandReceiptInput
  ): Promise<boolean>;
  recordSubmission(input: RecordPaymentSubmissionInput): Promise<void>;
  close?(): Promise<void>;
}

export interface PaymentCommercialPolicyRepository {
  listOverrides(): Promise<{ items: AdminPaymentCommercialPolicy[] }>;
  updateOverride(input: {
    supabaseUserId: string;
    productType: AdminPaymentCommercialPolicy["productType"];
    currency: AdminPaymentCommercialPolicy["currency"];
    body: AdminPaymentCommercialPolicyPatchRequest;
    idempotencyKey: string;
    requestHash: string;
  }): Promise<AdminPaymentCommercialPolicy>;
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
  provider?: "helius" | "solana_indexer";
  providerEventId: string;
  normalizedState: "processed" | "ignored" | "failed";
}

export interface PaymentEvidenceRepository {
  recordSolanaProviderEvent(input: RecordSolanaProviderEventInput): Promise<boolean>;
  findIntentByReference(input: {
    referenceAddresses: string[];
    includeConfirmed?: boolean;
    submissionSignature?: string;
  }): Promise<ProviderPaymentIntentMatch | null>;
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
  enterpriseWallet?: string | null;
  platformFeeWallet: string;
  referralWallet?: string | null;
  treasuryWallet?: string | null;
  totalAmountMinor: number;
  creatorAmountMinor: number;
  enterpriseManagementAmountMinor: number;
  platformFeeAmountMinor: number;
  referralAmountMinor: number;
  currency: "SOL" | "USDC";
  tokenMint?: string | null;
  tokenDecimals?: number | null;
  expiresAt: Date;
}

export interface PaymentSettlementResult {
  confirmed: boolean;
  failureCode?: PaymentSettlementFailureCode;
  blockTime?: Date;
}

/**
 * Maps normalized, backend-verified settlement evidence onto canonical intent state. Missing,
 * incomplete, and transient provider evidence stays recoverable. A finalized transaction whose
 * immutable facts cannot satisfy the intent is terminal; expiry is kept distinct for client copy.
 */
export function paymentIntentStateForSettlement(
  input: Pick<PaymentSettlementResult, "confirmed" | "failureCode">
): PaymentSettlementIntentState {
  if (input.confirmed) return "confirmed";

  switch (input.failureCode) {
    case "intent_expired_before_settlement":
    case "signed_transaction_expired":
      return "expired";
    case "transaction_failed":
    case "reference_missing":
    case "memo_missing":
    case "creator_split_paid_treasury":
    case "transfer_mismatch":
    case "invalid_expected_amounts":
    case "invalid_signature":
      return "failed";
    case "not_found":
    case "block_time_missing":
    case "transient":
    case undefined:
      return "submitted";
  }

  return "submitted";
}

export interface PaymentSettlementVerifier {
  verifyTransfer(
    input: PaymentSettlementInput,
    options?: { signal?: AbortSignal }
  ): Promise<PaymentSettlementResult>;
  verifyTransactionExpiry?(
    input: {
      signature: string;
      signedTransactionBase64: string;
      buyerWallet: string | null;
    },
    options?: { signal?: AbortSignal }
  ): Promise<
    | { state: "expired" }
    | { state: "active" | "observed" | "invalid" }
  >;
}
