import type {
  OnrampSessionResource,
  StoredWalletLinkChallenge,
  WalletLinkChallenge,
  WalletResource
} from "./types.js";
import type { OnrampSessionRow, WalletChallengeRow, WalletRow } from "./wallet-repository-rows.js";

export function toOnrampSessionResource(row: OnrampSessionRow): OnrampSessionResource {
  return {
    id: row.id,
    provider: row.provider,
    launchUrl: row.launch_url,
    walletId: row.wallet_id,
    walletAddress: row.wallet_address,
    state: row.state,
    createdAt: row.created_at.toISOString(),
    expiresAt: row.expires_at ? row.expires_at.toISOString() : null
  };
}

export function toWalletResource(row: WalletRow): WalletResource {
  return {
    id: row.id,
    chain: row.chain,
    address: row.address,
    provider: row.provider,
    isPrimary: row.is_primary
  };
}

export function toWalletLinkChallenge(row: WalletChallengeRow): WalletLinkChallenge {
  return {
    id: row.id,
    chain: row.chain,
    address: row.address,
    provider: row.provider,
    message: row.message,
    expiresAt: row.expires_at.toISOString()
  };
}

export function toStoredWalletLinkChallenge(row: WalletChallengeRow): StoredWalletLinkChallenge {
  return {
    id: row.id,
    userId: row.user_id,
    chain: row.chain,
    provider: row.provider,
    address: row.address,
    message: row.message,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at
  };
}

export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}
