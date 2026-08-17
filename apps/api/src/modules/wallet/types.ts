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
  listWalletsByUserId?(userId: string): Promise<WalletResource[]>;
  hasWalletByUserId?(userId: string): Promise<boolean>;
  /** @deprecated Legacy provider-subject lookups for unmigrated route modules. */
  listWalletsBySupabaseUserId(supabaseUserId: string): Promise<WalletResource[]>;
  hasWalletBySupabaseUserId(supabaseUserId: string): Promise<boolean>;
  createLinkChallenge(input: CreateWalletChallengeInput): Promise<WalletLinkChallenge>;
  consumeVerifiedExternalWalletLink(input: ConsumeVerifiedExternalWalletLinkInput): Promise<SecuredWalletMutationResult>;
  findLinkChallenge(input: FindWalletLinkChallengeInput): Promise<StoredWalletLinkChallenge | null>;
  findWalletForUser?(input: FindWalletForUserInput): Promise<WalletResource | null>;
  /** @deprecated Legacy provider-subject lookup for unmigrated test/runtime composition. */
  findWalletForSupabaseUser?(input: FindWalletForSupabaseUserInput): Promise<WalletResource | null>;
  setPrimaryWallet(input: SetPrimaryWalletInput): Promise<SecuredWalletMutationResult>;
  findOnrampSessionByIdempotencyKey(
    input: FindOnrampSessionByIdempotencyKeyInput
  ): Promise<OnrampSessionResource | null>;
  recordOnrampSession(input: RecordOnrampSessionInput): Promise<OnrampSessionResource>;
  close?(): Promise<void>;
}

export interface CreateWalletChallengeInput {
  userId: string;
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
  userId: string;
}

export interface ConsumeVerifiedExternalWalletLinkInput {
  challengeId: string;
  userId: string;
  sessionToken: string;
}

export interface FindWalletForUserInput {
  walletId: string;
  userId: string;
}

export interface FindWalletForSupabaseUserInput {
  walletId: string;
  supabaseUserId: string;
}

export interface SetPrimaryWalletInput {
  walletId: string;
  userId: string;
  sessionToken: string;
}

export interface SecuredWalletMutationResult {
  wallet: WalletResource;
  session: {
    accessToken: string;
    expiresAt: Date;
  };
}

export interface FindOnrampSessionByIdempotencyKeyInput {
  userId: string;
  idempotencyKey: string;
}

export interface RecordOnrampSessionInput {
  userId: string;
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
  userId: string;
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
  userId: string;
  chain: Extract<WalletChain, "solana_devnet" | "solana_mainnet">;
}

export interface EmbeddedWalletProvisionResult {
  provider: Extract<WalletProvider, "embedded_privy">;
  providerWalletReference: string;
  address: string;
  chain: WalletChain;
}

export interface EmbeddedWalletProviderAdapter {
  readonly provider: Extract<WalletProvider, "embedded_privy">;
  provisionWallet(
    request: EmbeddedWalletProvisionRequest
  ): Promise<EmbeddedWalletProvisionResult>;
}

export function listWalletsForUser(
  repository: WalletRepository,
  userId: string
): Promise<WalletResource[]> {
  if (repository.listWalletsByUserId) {
    return repository.listWalletsByUserId(userId);
  }

  return repository.listWalletsBySupabaseUserId(userId);
}

export function hasWalletForUser(
  repository: WalletRepository,
  userId: string
): Promise<boolean> {
  if (repository.hasWalletByUserId) {
    return repository.hasWalletByUserId(userId);
  }

  return repository.hasWalletBySupabaseUserId(userId);
}

export function findWalletForUser(
  repository: WalletRepository,
  input: FindWalletForUserInput
): Promise<WalletResource | null> {
  if (repository.findWalletForUser) {
    return repository.findWalletForUser(input);
  }

  if (repository.findWalletForSupabaseUser) {
    return repository.findWalletForSupabaseUser({
      walletId: input.walletId,
      supabaseUserId: input.userId
    });
  }

  return Promise.resolve(null);
}
