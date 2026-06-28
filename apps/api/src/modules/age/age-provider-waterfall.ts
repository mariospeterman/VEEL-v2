import type { ServerEnv } from "@veel/config";
import {
  AgeProviderHttpError,
  createDiditAgeProviderAdapter,
  createMockAgeProviderAdapter,
  createPersonaAgeProviderAdapter,
  createSumsubAgeProviderAdapter,
  createVeriffAgeProviderAdapter,
  createYotiAgeProviderAdapter
} from "./age-provider-adapters.js";
import type {
  AgeProvider,
  AgeProviderAdapter,
  AgeProviderPreference,
  AgeProviderSession,
  AgeProviderWaterfall
} from "./types.js";

export { AgeProviderHttpError } from "./age-provider-adapters.js";

const reusableFirstOrder: AgeProvider[] = ["didit", "yoti", "persona"];
const explicitFallbackOrder: AgeProvider[] = ["didit", "yoti", "persona", "sumsub", "veriff"];

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
  return createStaticAgeProviderWaterfall([
    createMockAgeProviderAdapter(env),
    createDiditAgeProviderAdapter(env),
    createYotiAgeProviderAdapter(env),
    createPersonaAgeProviderAdapter(env),
    createSumsubAgeProviderAdapter(env),
    createVeriffAgeProviderAdapter(env)
  ]);
}

export function createStaticAgeProviderWaterfall(
  adapters: AgeProviderAdapter[]
): AgeProviderWaterfall {
  const adaptersByProvider = new Map<AgeProvider, AgeProviderAdapter[]>();

  for (const adapter of adapters) {
    adaptersByProvider.set(adapter.provider, [
      ...(adaptersByProvider.get(adapter.provider) ?? []),
      adapter
    ]);
  }

  return {
    async createSession(input): Promise<AgeProviderSession> {
      for (const provider of providerOrder(input.providerPreference)) {
        const providerAdapters = adaptersByProvider.get(provider) ?? [];

        for (const adapter of providerAdapters) {
          if (!adapter.isConfigured()) {
            continue;
          }

          try {
            return await adapter.createSession(input);
          } catch (error) {
            if (error instanceof AgeProviderHttpError && error.status >= 500) {
              continue;
            }

            throw error;
          }
        }
      }

      throw new AgeProviderUnavailableError();
    }
  };
}

function providerOrder(providerPreference: AgeProviderPreference): AgeProvider[] {
  if (providerPreference === "reusable_first") {
    return reusableFirstOrder;
  }

  return [
    providerPreference,
    ...explicitFallbackOrder.filter((provider) => provider !== providerPreference)
  ];
}
