import type {
  OnrampSessionResource,
  StoredWalletLinkChallenge,
  WalletResource
} from "./types.js";

export interface WalletRow {
  id: string;
  user_id?: string;
  chain: WalletResource["chain"];
  address: string;
  provider: WalletResource["provider"];
  is_primary: boolean;
}

export interface WalletChallengeRow {
  id: string;
  user_id: string;
  chain: StoredWalletLinkChallenge["chain"];
  provider: StoredWalletLinkChallenge["provider"];
  address: string;
  message: string;
  expires_at: Date;
  consumed_at: Date | null;
}

export interface OnrampSessionRow {
  id: string;
  provider: string;
  launch_url: string;
  wallet_id: string;
  wallet_address: string;
  state: OnrampSessionResource["state"];
  created_at: Date;
  expires_at: Date | null;
}
