"use client";

const walletSessionKey = "veel-wallet-session";
export const walletSessionCookieName = "veel_wallet_session_token";

export interface WalletSessionRecord {
  expiresAt: string;
  address: string;
  provider: string;
}

export function saveWalletSession(session: WalletSessionRecord) {
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
  document.cookie = `${walletSessionCookieName}=; path=/; max-age=0; samesite=lax`;
}
