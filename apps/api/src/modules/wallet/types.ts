import type { components } from "@veel/contracts";

export type WalletResource = components["schemas"]["Wallet"];
export type WalletChain = WalletResource["chain"];
export type WalletProvider = WalletResource["provider"];

export interface WalletRepository {
  listWalletsBySupabaseUserId(supabaseUserId: string): Promise<WalletResource[]>;
  hasWalletBySupabaseUserId(supabaseUserId: string): Promise<boolean>;
  close?(): Promise<void>;
}

export interface EmbeddedWalletProvisionRequest {
  supabaseUserId: string;
  chain: Extract<WalletChain, "solana_devnet" | "solana_mainnet">;
}

export interface EmbeddedWalletProvisionResult {
  provider: Extract<WalletProvider, "embedded_privy" | "embedded_turnkey">;
  providerWalletReference: string;
  address: string;
  chain: WalletChain;
}

export interface EmbeddedWalletProviderAdapter {
  readonly provider: Extract<WalletProvider, "embedded_privy" | "embedded_turnkey">;
  provisionWallet(
    request: EmbeddedWalletProvisionRequest
  ): Promise<EmbeddedWalletProvisionResult>;
}
