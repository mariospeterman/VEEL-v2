import type { components } from "@veel/contracts";

export type WalletResource = components["schemas"]["Wallet"];
export type WalletChain = WalletResource["chain"];
export type WalletProvider = WalletResource["provider"];
export type ExternalWalletProvider = components["schemas"]["ExternalWalletProvider"];
export type CreateWalletLinkChallengeRequest =
  components["schemas"]["CreateWalletLinkChallengeRequest"];
export type WalletLinkChallenge = components["schemas"]["WalletLinkChallenge"];
export type LinkWalletRequest = components["schemas"]["LinkWalletRequest"];
export type CreateOnrampSessionRequest = components["schemas"]["CreateOnrampSessionRequest"];
export type OnrampSessionResource = components["schemas"]["OnrampSession"];

export interface WalletRepository {
  listWalletsBySupabaseUserId(supabaseUserId: string): Promise<WalletResource[]>;
  hasWalletBySupabaseUserId(supabaseUserId: string): Promise<boolean>;
  createLinkChallenge(input: CreateWalletChallengeInput): Promise<WalletLinkChallenge>;
  consumeVerifiedExternalWalletLink(input: ConsumeVerifiedExternalWalletLinkInput): Promise<WalletResource>;
  findLinkChallenge(input: FindWalletLinkChallengeInput): Promise<StoredWalletLinkChallenge | null>;
  findWalletForSupabaseUser(input: FindWalletForSupabaseUserInput): Promise<WalletResource | null>;
  setPrimaryWallet(input: SetPrimaryWalletInput): Promise<WalletResource>;
  findOnrampSessionByIdempotencyKey(
    input: FindOnrampSessionByIdempotencyKeyInput
  ): Promise<OnrampSessionResource | null>;
  recordOnrampSession(input: RecordOnrampSessionInput): Promise<OnrampSessionResource>;
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

export interface FindWalletForSupabaseUserInput {
  walletId: string;
  supabaseUserId: string;
}

export interface SetPrimaryWalletInput {
  walletId: string;
  supabaseUserId: string;
}

export interface FindOnrampSessionByIdempotencyKeyInput {
  supabaseUserId: string;
  idempotencyKey: string;
}

export interface RecordOnrampSessionInput {
  supabaseUserId: string;
  walletId: string;
  idempotencyKey: string;
  provider: string;
  providerSessionReferenceHash: string;
  walletAddress: string;
  chain: WalletChain;
  purchaseCurrency: "SOL" | "USDC";
  launchUrl: string;
  returnUrl: string | null;
  expiresAt: Date | null;
}

export interface CreateWalletOnrampSessionInput {
  supabaseUserId: string;
  wallet: WalletResource;
  idempotencyKey: string;
  returnUrl: string | null;
  clientIp: string;
}

export interface WalletOnrampProviderSession {
  provider: string;
  providerSessionReferenceHash: string;
  launchUrl: string;
  purchaseCurrency: "SOL" | "USDC";
  expiresAt: Date | null;
}

export interface WalletOnrampProviderAdapter {
  createSession(input: CreateWalletOnrampSessionInput): Promise<WalletOnrampProviderSession>;
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
