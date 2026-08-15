import type {
  EmbeddedWalletProviderAdapter,
  EmbeddedWalletProvisionRequest,
  EmbeddedWalletProvisionResult,
  WalletProvider
} from "./types.js";

export class EmbeddedWalletProviderNotConfiguredError extends Error {
  constructor(provider: WalletProvider) {
    super(`Embedded wallet provider is not configured: ${provider}`);
    this.name = "EmbeddedWalletProviderNotConfiguredError";
  }
}

export class UnconfiguredEmbeddedWalletProviderAdapter
  implements EmbeddedWalletProviderAdapter
{
  constructor(
    readonly provider: Extract<WalletProvider, "embedded_privy">
  ) {}

  async provisionWallet(
    _request: EmbeddedWalletProvisionRequest
  ): Promise<EmbeddedWalletProvisionResult> {
    throw new EmbeddedWalletProviderNotConfiguredError(this.provider);
  }
}
