import type { ServerEnv } from "@veel/config";

export type SubscriptionProviderName =
  | "disabled"
  | "official_solana_subscription_program"
  | "mock_subscription_provider_dev_only";

export interface SubscriptionProviderConfig {
  enabled: boolean;
  provider: SubscriptionProviderName;
  programId: string;
  network: "devnet" | "mainnet-beta";
  rpcUrl: string | null;
  supportedMints: string[];
  defaultMint: string | null;
  collectorWallet: string | null;
  merchantWallet: string | null;
  requireOnchainVerification: boolean;
}

export type SubscriptionProviderReadiness =
  | { ok: true; config: SubscriptionProviderConfig }
  | { ok: false; reason: string; config: SubscriptionProviderConfig };

export function getSubscriptionProviderConfig(env: ServerEnv): SubscriptionProviderConfig {
  const defaultMint = env.SUBSCRIPTIONS_DEFAULT_MINT ?? env.SOLANA_SUBSCRIPTION_USDC_MINT ?? null;
  const collectorWallet =
    env.SUBSCRIPTIONS_COLLECTOR_WALLET ?? env.SOLANA_SUBSCRIPTION_COLLECTOR_WALLET ?? null;
  const supportedMints = (env.SUBSCRIPTIONS_SUPPORTED_MINTS ?? defaultMint ?? "")
    .split(",")
    .map((mint) => mint.trim())
    .filter(Boolean);

  return {
    enabled: env.SUBSCRIPTIONS_ENABLED,
    provider: env.SUBSCRIPTIONS_PROVIDER,
    programId: env.SUBSCRIPTIONS_SOLANA_PROGRAM_ID ?? env.SOLANA_SUBSCRIPTION_DELEGATION_PROGRAM_ID,
    network: env.SUBSCRIPTIONS_SOLANA_NETWORK,
    rpcUrl: env.SUBSCRIPTIONS_SOLANA_RPC_URL ?? env.SOLANA_RPC_URL ?? null,
    supportedMints,
    defaultMint,
    collectorWallet,
    merchantWallet: env.SUBSCRIPTIONS_MERCHANT_WALLET ?? collectorWallet,
    requireOnchainVerification: env.SUBSCRIPTIONS_REQUIRE_ONCHAIN_VERIFICATION
  };
}

export function checkSubscriptionProviderReadiness(
  env: ServerEnv
): SubscriptionProviderReadiness {
  const config = getSubscriptionProviderConfig(env);

  if (!config.enabled) {
    return { ok: false, reason: "subscriptions_disabled", config };
  }

  if (config.provider !== "official_solana_subscription_program") {
    return { ok: false, reason: "provider_not_configured", config };
  }

  if (!config.requireOnchainVerification) {
    return { ok: false, reason: "onchain_verification_required", config };
  }

  if (!config.programId) {
    return { ok: false, reason: "program_id_missing", config };
  }

  if (!config.rpcUrl) {
    return { ok: false, reason: "rpc_unavailable", config };
  }

  if (config.supportedMints.length === 0 || !config.defaultMint) {
    return { ok: false, reason: "supported_mint_missing", config };
  }

  if (!config.supportedMints.includes(config.defaultMint)) {
    return { ok: false, reason: "default_mint_not_supported", config };
  }

  if (!config.collectorWallet) {
    return { ok: false, reason: "collector_wallet_missing", config };
  }

  if (!config.merchantWallet) {
    return { ok: false, reason: "merchant_wallet_missing", config };
  }

  return { ok: true, config };
}

export function isSupportedSubscriptionMint(
  config: SubscriptionProviderConfig,
  mint: string | null | undefined
): boolean {
  return Boolean(mint && config.supportedMints.includes(mint));
}
