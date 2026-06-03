import type { ServerEnv } from "@veel/config";
import type {
  AgeProvider,
  AgeProviderAdapter,
  AgeProviderPreference,
  AgeProviderSession,
  AgeProviderSessionRequest,
  AgeProviderWaterfall
} from "./types.js";

const reusableFirstOrder: AgeProvider[] = ["yoti", "sumsub", "veriff", "persona"];

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
    new PendingProviderAdapter("yoti", isYotiConfigured(env)),
    new PendingProviderAdapter("sumsub", isSumsubConfigured(env)),
    new PendingProviderAdapter("veriff", isVeriffConfigured(env)),
    new PendingProviderAdapter("persona", isPersonaConfigured(env))
  ]);
}

export function createStaticAgeProviderWaterfall(
  adapters: AgeProviderAdapter[]
): AgeProviderWaterfall {
  const adaptersByProvider = new Map(adapters.map((adapter) => [adapter.provider, adapter]));

  return {
    async createSession(input): Promise<AgeProviderSession> {
      for (const provider of providerOrder(input.providerPreference)) {
        const adapter = adaptersByProvider.get(provider);

        if (!adapter?.isConfigured()) {
          continue;
        }

        return adapter.createSession(input);
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
    ...reusableFirstOrder.filter((provider) => provider !== providerPreference)
  ];
}

function isYotiConfigured(env: ServerEnv): boolean {
  return (
    (env.AGE_VERIFICATION_DRIVER === "yoti" ||
      env.AGE_VERIFICATION_DRIVER === "yoti_digital_id") &&
    Boolean(env.YOTI_SDK_ID && env.YOTI_API_TOKEN)
  );
}

function isSumsubConfigured(env: ServerEnv): boolean {
  return (
    env.AGE_VERIFICATION_DRIVER === "sumsub" &&
    Boolean(env.SUMSUB_APP_TOKEN && env.SUMSUB_SECRET_KEY && env.SUMSUB_LEVEL_NAME)
  );
}

function isVeriffConfigured(env: ServerEnv): boolean {
  return env.AGE_VERIFICATION_DRIVER === "veriff" && Boolean(env.VERIFF_API_KEY);
}

function isPersonaConfigured(env: ServerEnv): boolean {
  return (
    env.AGE_VERIFICATION_DRIVER === "persona" &&
    Boolean(env.PERSONA_API_KEY && env.PERSONA_TEMPLATE_ID)
  );
}

class PendingProviderAdapter implements AgeProviderAdapter {
  constructor(
    public readonly provider: AgeProvider,
    private readonly configured: boolean
  ) {}

  isConfigured(): boolean {
    return this.configured;
  }

  async createSession(_input: AgeProviderSessionRequest): Promise<AgeProviderSession> {
    throw new AgeProviderIntegrationPendingError(this.provider);
  }
}
