import { createHash } from "node:crypto";
import { generateJwt } from "@coinbase/cdp-sdk/auth";
import type { ServerEnv } from "@veel/config";
import type {
  CreateWalletOnrampSessionInput,
  WalletOnrampProviderAdapter,
  WalletOnrampProviderSession
} from "./types.js";

const coinbaseOnrampHost = "api.cdp.coinbase.com";
const coinbaseOnrampPath = "/platform/v2/onramp/sessions";

export class WalletOnrampProviderNotConfiguredError extends Error {
  constructor() {
    super("WALLET_ONRAMP_PROVIDER_NOT_CONFIGURED");
    this.name = "WalletOnrampProviderNotConfiguredError";
  }
}

export class WalletOnrampProviderError extends Error {
  constructor(message = "WALLET_ONRAMP_PROVIDER_ERROR") {
    super(message);
    this.name = "WalletOnrampProviderError";
  }
}

export function createWalletOnrampProvider(env: ServerEnv): WalletOnrampProviderAdapter {
  if (
    env.ONRAMP_PROVIDER === "coinbase" &&
    env.COINBASE_CDP_API_KEY_ID &&
    env.COINBASE_CDP_API_KEY_SECRET
  ) {
    return new CoinbaseWalletOnrampProvider(env);
  }

  return new UnconfiguredWalletOnrampProvider();
}

export class UnconfiguredWalletOnrampProvider implements WalletOnrampProviderAdapter {
  async createSession(): Promise<WalletOnrampProviderSession> {
    throw new WalletOnrampProviderNotConfiguredError();
  }
}

class CoinbaseWalletOnrampProvider implements WalletOnrampProviderAdapter {
  constructor(private readonly env: ServerEnv) {}

  async createSession(
    input: CreateWalletOnrampSessionInput
  ): Promise<WalletOnrampProviderSession> {
    const baseUrl = new URL(this.env.COINBASE_CDP_API_BASE_URL);
    const requestPath = coinbaseOnrampPath;
    const token = await generateJwt({
      apiKeyId: this.env.COINBASE_CDP_API_KEY_ID ?? "",
      apiKeySecret: this.env.COINBASE_CDP_API_KEY_SECRET ?? "",
      requestMethod: "POST",
      requestHost: baseUrl.host || coinbaseOnrampHost,
      requestPath,
      expiresIn: 120
    });

    const response = await fetch(new URL(requestPath, baseUrl), {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "application/json"
      },
      body: JSON.stringify({
        purchaseCurrency: this.env.ONRAMP_PURCHASE_CURRENCY,
        destinationNetwork: this.env.COINBASE_ONRAMP_DESTINATION_NETWORK,
        destinationAddress: input.wallet.address,
        redirectUrl: input.returnUrl ?? undefined,
        clientIp: input.clientIp,
        partnerUserRef: `veel-${input.wallet.id}`
      })
    });

    if (!response.ok) {
      throw new WalletOnrampProviderError(`COINBASE_ONRAMP_${response.status}`);
    }

    const payload = (await response.json()) as { session?: { onrampUrl?: string } };
    const launchUrl = payload.session?.onrampUrl;

    if (!launchUrl) {
      throw new WalletOnrampProviderError("COINBASE_ONRAMP_MISSING_URL");
    }

    return {
      provider: "coinbase",
      providerSessionReferenceHash: hashProviderReference(launchUrl),
      launchUrl,
      purchaseCurrency: this.env.ONRAMP_PURCHASE_CURRENCY,
      expiresAt: null
    };
  }
}

function hashProviderReference(reference: string): string {
  return createHash("sha256").update(reference).digest("hex");
}
