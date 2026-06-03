import type { components } from "@veel/contracts";

export type WalletResource = components["schemas"]["Wallet"];
export type WalletChain = WalletResource["chain"];
export type WalletProvider = WalletResource["provider"];
export type ExternalWalletProvider = components["schemas"]["ExternalWalletProvider"];
export type CreateWalletLinkChallengeRequest =
  components["schemas"]["CreateWalletLinkChallengeRequest"];
export type WalletLinkChallenge = components["schemas"]["WalletLinkChallenge"];
export type LinkWalletRequest = components["schemas"]["LinkWalletRequest"];

export interface WalletRepository {
  listWalletsBySupabaseUserId(supabaseUserId: string): Promise<WalletResource[]>;
  hasWalletBySupabaseUserId(supabaseUserId: string): Promise<boolean>;
  createLinkChallenge(input: CreateWalletChallengeInput): Promise<WalletLinkChallenge>;
  consumeVerifiedExternalWalletLink(input: ConsumeVerifiedExternalWalletLinkInput): Promise<WalletResource>;
  findLinkChallenge(input: FindWalletLinkChallengeInput): Promise<StoredWalletLinkChallenge | null>;
  close?(): Promise<void>;
}

export interface CreateWalletChallengeInput {
  supabaseUserId: string;
  chain: WalletChain;
  provider: ExternalWalletProvider;
  address: string;
  message: string;
  nonceHash: string;
  expiresAt: Date;
}

export interface StoredWalletLinkChallenge {
  id: string;
  userId: string;
  chain: WalletChain;
  provider: ExternalWalletProvider;
  address: string;
  message: string;
  expiresAt: Date;
  consumedAt: Date | null;
}

export interface FindWalletLinkChallengeInput {
  challengeId: string;
  supabaseUserId: string;
}

export interface ConsumeVerifiedExternalWalletLinkInput {
  challengeId: string;
  supabaseUserId: string;
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
