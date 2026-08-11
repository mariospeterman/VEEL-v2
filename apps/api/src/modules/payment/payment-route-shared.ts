import { createHash } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { readIdempotencyKey } from "../../shared/idempotency.js";
import { unauthorizedResponse, verifyRequestSession } from "../auth/http-auth.js";
import type { AgeRepository } from "../age/types.js";
import type { ContentRepository } from "../content/types.js";
import type { SessionRepository, SupabaseAuthVerifier } from "../session/types.js";
import type { WalletRepository } from "../wallet/types.js";
import type { CreatePaymentIntentRequest, PaymentIntent, PaymentEvidenceRepository, PaymentRepository, PaymentSettlementVerifier, ProductType } from "./types.js";
import type { SettlementKind } from "./payment-amounts.js";

export interface RegisterPaymentRoutesOptions {
  authVerifier: SupabaseAuthVerifier;
  sessionRepository: SessionRepository;
  ageRepository: AgeRepository;
  walletRepository: WalletRepository;
  contentRepository: ContentRepository;
  paymentRepository: PaymentRepository;
  paymentEvidenceRepository: PaymentEvidenceRepository;
  settlementVerifier: PaymentSettlementVerifier;
}

const productTypes = new Set(["support"]);
export const paymentIntentTtlMs = 15 * 60 * 1000;

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

  if (!profile?.handle || !profile.displayName || ageStatus.state !== "verified" || !hasWallet) {
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
  creatorAmountMinor?: number;
  platformFeeAmountMinor?: number;
  allocationAmountMinor?: number;
}): PaymentIntent {
  return {
    id: intent.id,
    productType: intent.productType,
    amountMinor: intent.amountMinor,
    currency: intent.currency,
    state: intent.state,
    settlementKind: intent.settlementKind ?? "creator_split",
    creatorAmountMinor: intent.creatorAmountMinor ?? intent.amountMinor,
    platformFeeAmountMinor: intent.platformFeeAmountMinor ?? 0,
    allocationAmountMinor: intent.allocationAmountMinor ?? 0,
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
