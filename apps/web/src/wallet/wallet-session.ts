"use client";

const walletSessionKey = "veel-wallet-session";

export interface WalletSessionRecord {
  expiresAt: string;
  address: string;
  provider: string;
}

export type SaveWalletSessionInput = WalletSessionRecord;

export function saveWalletSession(session: SaveWalletSessionInput) {
  window.localStorage.setItem(walletSessionKey, JSON.stringify(session));
}

export function getWalletSession(): WalletSessionRecord | null {
  try {
    const value = window.localStorage.getItem(walletSessionKey);
    return value ? (JSON.parse(value) as WalletSessionRecord) : null;
  } catch {
    return null;
  }
}

export function clearWalletSession() {
  window.localStorage.removeItem(walletSessionKey);
}
