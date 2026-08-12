import { PublicKey } from "@solana/web3.js";
import type { ServerEnv } from "@veel/config";
import {
  checkSubscriptionProviderReadiness,
  getSubscriptionProviderConfig,
  isSupportedSubscriptionMint
} from "./subscription-provider-config.js";
import type {
  SubscriptionAuthorizationVerifier,
  SubscriptionAuthorizationVerificationResult,
  VerifySubscriptionAuthorizationInput
} from "./types.js";

export function createSolanaSubscriptionAuthorizationVerifier(
  env?: ServerEnv
): SubscriptionAuthorizationVerifier {
  const config = env ? getSubscriptionProviderConfig(env) : null;
  const readiness = env ? checkSubscriptionProviderReadiness(env) : null;

  return {
    async verifyAuthorization(input: VerifySubscriptionAuthorizationInput) {
      const requiredEvidence = [
        input.signature,
        input.setupReference,
        input.authorityAddress,
        input.delegationAddress,
        input.subscriberTokenAccount
      ];

      if (requiredEvidence.some((value) => !value)) {
        return failed("missing_authorization_evidence");
      }

      if (input.expiresAt.getTime() <= Date.now()) {
        return failed("intent_expired");
      }

      if (!config || readiness?.ok !== true) {
        const reason = readiness?.ok === false ? readiness.reason : "provider_not_configured";
        return failed(reason === "rpc_unavailable" ? "rpc_unavailable" : "provider_not_configured", {
          retryable: reason === "rpc_unavailable"
        });
      }

      if (input.provider !== "official_solana_subscription_program") {
        return failed("provider_not_configured");
      }

      if (input.tokenMint === "SOL" || input.tokenProgram === null) {
        return failed("unsupported_native_sol_subscription");
      }

      if (!isSupportedSubscriptionMint(config, input.tokenMint)) {
        return failed("unsupported_asset");
      }

      if (input.delegationProgramId !== config.programId) {
        return failed("program_id_mismatch");
      }

      if (input.collectorAddress && input.collectorAddress !== config.collectorWallet) {
        return failed("collector_mismatch");
      }

      if (input.merchantWallet && input.merchantWallet !== config.merchantWallet) {
        return failed("merchant_mismatch");
      }

      if (!isSolanaAddress(input.authorityAddress)) {
        return failed("authority_not_found");
      }

      if (!isSolanaAddress(input.delegationAddress)) {
        return failed("delegation_not_found");
      }

      if (!isSolanaAddress(input.subscriberTokenAccount)) {
        return failed("subscriber_mismatch");
      }

      if (!input.subscriberWallet || !isSolanaAddress(input.subscriberWallet)) {
        return failed("subscriber_mismatch");
      }

      return failed("provider_not_configured");
    }
  };
}

function failed(
  failureCode: NonNullable<SubscriptionAuthorizationVerificationResult["failureCode"]>,
  options: { retryable?: boolean } = {}
): SubscriptionAuthorizationVerificationResult {
  return {
    verified: false,
    failureCode,
    retryable: options.retryable ?? false
  };
}

function isSolanaAddress(value: string): boolean {
  try {
    // PublicKey construction is a format check only; no private key material is involved.
    new PublicKey(value);
    return true;
  } catch {
    return false;
  }
}
