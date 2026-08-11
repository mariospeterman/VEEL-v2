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

export function createAgeProviderWaterfall(env: ServerEnv): AgeProviderWaterfall {
  const verificationProviders = createVerificationProviderWaterfall(env);

  return {
    async createSession(input) {
      try {
        const session = await verificationProviders.createSession({
          ...input,
          purpose: "age_access"
        });

        return {
          provider: session.provider as "didit" | "yoti" | "sumsub" | "veriff" | "persona",
          providerReference: session.providerReference,
          launchUrl: session.launchUrl,
          expiresAt: session.expiresAt,
          rule: "over_18"
        };
      } catch (error) {
        if (error instanceof VerificationProviderHttpError) throw error;
        throw new AgeProviderUnavailableError();
      }
    }
  };
}
