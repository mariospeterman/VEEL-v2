import { createHash } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { readIdempotencyKey } from "../../shared/idempotency.js";
import { unauthorizedResponse, verifyRequestSession } from "../auth/http-auth.js";
import type { AgeRepository } from "../age/types.js";
import type { ContentRepository } from "../content/types.js";
import type { SessionRepository, ApplicationSessionVerifier } from "../session/types.js";
import type { WalletRepository } from "../wallet/types.js";
import type { CreatePaymentIntentRequest, PaymentIntent, PaymentEvidenceRepository, PaymentRepository, PaymentSettlementVerifier, ProductType } from "./types.js";
import type { SettlementKind } from "./payment-amounts.js";

export interface RegisterPaymentRoutesOptions {
  authVerifier: ApplicationSessionVerifier;
  sessionRepository: SessionRepository;
  ageRepository: AgeRepository;
  walletRepository: WalletRepository;
  contentRepository: ContentRepository;
  paymentRepository: PaymentRepository;
  paymentEvidenceRepository: PaymentEvidenceRepository;
  settlementVerifier: PaymentSettlementVerifier;
}

const productTypes = new Set(["support"]);

type PaymentReadyAccessResult =
  | {
      ok: true;
      supabaseUserId: string;
    }
  | {
      ok: false;
      statusCode: 401 | 403;
      body: {
        code: string;
        message: string;
      };
    };

export async function verifyPaymentReadyAccess(
  request: FastifyRequest,
  options: RegisterPaymentRoutesOptions
): Promise<PaymentReadyAccessResult> {
  const verifiedSession = await verifyRequestSession(request, options.authVerifier);

  if (!verifiedSession) {
    return {
      ok: false,
      statusCode: 401,
      body: unauthorizedResponse("Missing or invalid bearer token")
    };
  }

  const profile = await options.sessionRepository.findProfileBySupabaseUserId(
    verifiedSession.supabaseUserId
  );
  const [ageStatus, hasWallet] = await Promise.all([
    options.ageRepository.findLatestAgeStatusBySupabaseUserId(verifiedSession.supabaseUserId),
    options.walletRepository.hasWalletBySupabaseUserId(verifiedSession.supabaseUserId)
  ]);

  if (profile?.state !== "active" || !profile.handle || !profile.displayName || ageStatus.state !== "verified" || !hasWallet) {
    return {
      ok: false,
      statusCode: 403,
      body: {
        code: "forbidden",
        message: "Payments require profile, age verification, and wallet readiness"
      }
    };
  }

  return {
    ok: true,
    supabaseUserId: verifiedSession.supabaseUserId
  };
}

export function validateCreatePaymentIntentRequest(
  body: Partial<CreatePaymentIntentRequest> | undefined,
  options?: { minimumAmountMinor?: number }
): string | null {
  if (!body || typeof body !== "object") {
    return "Request body is required";
  }

  if (typeof body.productType !== "string" || !productTypes.has(body.productType)) {
    return "Unsupported productType";
  }

  if (typeof body.targetId !== "string" || body.targetId.length === 0) {
    return "targetId is required";
  }

  if (!Number.isSafeInteger(body.amountMinor) || Number(body.amountMinor) <= 0) {
    return "amountMinor is required for payment intents";
  }

  if (
    options?.minimumAmountMinor !== undefined &&
    Number(body.amountMinor) < options.minimumAmountMinor
  ) {
    return `Support amount must be at least ${options.minimumAmountMinor} atomic units`;
  }

  if (
    body.referralToken !== undefined &&
    body.referralToken !== null &&
    (typeof body.referralToken !== "string" || body.referralToken.length === 0)
  ) {
    return "referralToken must be a non-empty string when provided";
  }

  return null;
}

export function requiredIdempotencyKey(request: FastifyRequest): string | null {
  return readIdempotencyKey(request);
}

export function hashPaymentIntentRequest(body: {
  productType: ProductType;
  targetId: string;
  amountMinor?: number | null;
  currency?: "SOL" | "USDC" | null;
  livePassDurationMinutes?: 30 | 60 | 180 | null;
  referralToken?: string | null;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        productType: body.productType,
        targetId: body.targetId,
        amountMinor: body.amountMinor ?? null,
        currency: body.currency ?? null,
        livePassDurationMinutes: body.livePassDurationMinutes ?? null,
        referralToken: body.referralToken ?? null
      })
    )
    .digest("hex");
}

export function toPaymentIntentResponse(intent: {
  id: string;
  productType: ProductType;
  amountMinor: number;
  currency: "SOL" | "USDC";
  state: PaymentIntent["state"];
  withdrawalWaiverRequired?: boolean;
  withdrawalWaiverAcceptedAt?: Date | null;
  withdrawalWaiverVersion?: string | null;
  termsVersion?: string | null;
  durableConfirmationRequired?: boolean;
  refundValueBasis?: PaymentIntent["refundPolicy"]["refundValueBasis"];
  settlementKind?: SettlementKind;
  creatorSideProceedsMinor?: number;
  creatorAmountMinor?: number;
  enterpriseManagementAmountMinor?: number;
  platformFeeGrossMinor?: number;
  platformFeeAmountMinor?: number;
  referralAmountMinor?: number;
  minimumAmountMinor?: number;
  platformFeeBps?: number;
  referralShareOfPlatformFeeBps?: number;
  quotedAt?: Date;
  expiresAt?: Date;
  commercialPolicySource?: "environment_default" | "admin_override" | "legacy_environment_default";
  commercialPolicyRevision?: number;
}): PaymentIntent {
  return {
    id: intent.id,
    productType: intent.productType,
    amountMinor: intent.amountMinor,
    currency: intent.currency,
    state: intent.state,
    settlementKind: intent.settlementKind ?? "creator_split",
    creatorSideProceedsMinor: intent.creatorSideProceedsMinor ?? intent.amountMinor,
    creatorAmountMinor: intent.creatorAmountMinor ?? intent.amountMinor,
    enterpriseManagementAmountMinor: intent.enterpriseManagementAmountMinor ?? 0,
    platformFeeGrossMinor: intent.platformFeeGrossMinor ?? intent.platformFeeAmountMinor ?? 0,
    platformFeeAmountMinor: intent.platformFeeAmountMinor ?? 0,
    referralAmountMinor: intent.referralAmountMinor ?? 0,
    quote: {
      minimumAmountMinor: intent.minimumAmountMinor ?? 1,
      platformFeeBps: intent.platformFeeBps ?? 0,
      referralShareOfPlatformFeeBps: intent.referralShareOfPlatformFeeBps ?? 0,
      quotedAt: (intent.quotedAt ?? new Date(0)).toISOString(),
      expiresAt: (intent.expiresAt ?? new Date(0)).toISOString(),
      policySource: intent.commercialPolicySource ?? "legacy_environment_default",
      policyRevision: intent.commercialPolicyRevision ?? 0
    },
    refundPolicy: {
      withdrawalWaiverRequired: intent.withdrawalWaiverRequired ?? true,
      withdrawalWaiverAcceptedAt: intent.withdrawalWaiverAcceptedAt?.toISOString() ?? null,
      withdrawalWaiverVersion: intent.withdrawalWaiverVersion ?? "instant-digital-access-v1",
      termsVersion: intent.termsVersion ?? "veel-terms-v1",
      durableConfirmationRequired: intent.durableConfirmationRequired ?? true,
      refundValueBasis: intent.refundValueBasis ?? "manual_resolution"
    }
  };
}

export function validationResponse(message: string) {
  return {
    code: "validation_failed",
    message
  };
}

export function notFoundResponse(message: string) {
  return {
    code: "not_found",
    message
  };
}

export function serviceUnavailableResponse(message: string) {
  return {
    code: "service_unavailable",
    message
  };
}
