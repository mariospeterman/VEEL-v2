import type { ServerEnv } from "@veel/config";
import {
  createVerificationProviderWaterfall,
  VerificationProviderHttpError
} from "../verification/verification-provider-adapters.js";
import type { AgeProvider, AgeProviderWaterfall } from "./types.js";

export { VerificationProviderHttpError as AgeProviderHttpError } from "../verification/verification-provider-adapters.js";

export class AgeProviderUnavailableError extends Error {
  constructor() {
    super("AGE_PROVIDER_UNAVAILABLE");
    this.name = "AgeProviderUnavailableError";
  }
}

export class AgeProviderIntegrationPendingError extends Error {
  constructor(provider: AgeProvider) {
    super(`AGE_PROVIDER_INTEGRATION_PENDING:${provider}`);
    this.name = "AgeProviderIntegrationPendingError";
  }
}

export class AgeProviderCreateClaimLostError extends Error {
  constructor() {
    super("AGE_PROVIDER_CREATE_CLAIM_LOST");
    this.name = "AgeProviderCreateClaimLostError";
  }
}

export function createAgeProviderWaterfall(env: ServerEnv): AgeProviderWaterfall {
  const verificationProviders = createVerificationProviderWaterfall(env);

  return {
    async createSession(input) {
      try {
        const session = await verificationProviders.createSession({
          supabaseUserId: input.supabaseUserId,
          purpose: "age_access",
          providerPreference: input.providerPreference,
          idempotencyKey: input.idempotencyKey,
          callbackUrl: input.callbackUrl,
          webhookBaseUrl: input.webhookBaseUrl,
          ...(input.subjectReference !== undefined
            ? { subjectReference: input.subjectReference }
            : {}),
          ...(input.onProviderSelected
            ? { onProviderSelected: async (selection) => {
                await input.onProviderSelected!({
                provider: selection.provider,
                method: selection.method as "reusable_age" | "age_estimation" | "non_doc" | "doc_scan" | "gov_id_selfie",
                assuranceLevel: selection.assuranceLevel,
                reusable: selection.reusable
                });
              } }
            : {})
        });

        return {
          provider: session.provider as "didit" | "yoti" | "sumsub" | "veriff" | "persona",
          providerReference: session.providerReference,
          providerExternalUserId: session.providerExternalUserId ?? null,
          launchUrl: session.launchUrl,
          expiresAt: session.expiresAt,
          rule: "over_18"
        };
      } catch (error) {
        if (error instanceof AgeProviderCreateClaimLostError) throw error;
        if (error instanceof VerificationProviderHttpError) throw error;
        throw new AgeProviderUnavailableError();
      }
    },
    async reconcileSession(input) {
      if (!verificationProviders.reconcileSession) throw new AgeProviderUnavailableError();
      try {
        return await verificationProviders.reconcileSession({
          provider: input.provider,
          providerReference: input.providerReference,
          purpose: "age_access"
        });
      } catch (error) {
        if (error instanceof VerificationProviderHttpError) throw error;
        throw new AgeProviderUnavailableError();
      }
    }
  };
}
