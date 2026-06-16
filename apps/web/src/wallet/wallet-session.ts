"use client";

const walletSessionKey = "veel-wallet-session";
export const walletSessionCookieName = "veel_wallet_session_token";

export interface WalletSessionRecord {
  accessToken: string;
  expiresAt: string;
  address: string;
  provider: string;
}

export function saveWalletSession(session: WalletSessionRecord) {
  window.localStorage.setItem(walletSessionKey, JSON.stringify(session));
  document.cookie = `${walletSessionCookieName}=${encodeURIComponent(session.accessToken)}; path=/; max-age=${cookieMaxAge(session.expiresAt)}; samesite=lax${window.location.protocol === "https:" ? "; secure" : ""}`;
}

export function getWalletSessionToken() {
  const session = getWalletSession();

  if (!session || Date.parse(session.expiresAt) <= Date.now()) {
    clearWalletSession();
    return null;
  }

  return session.accessToken;
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

function cookieMaxAge(expiresAt: string) {
  const seconds = Math.floor((Date.parse(expiresAt) - Date.now()) / 1000);
  return Math.max(0, seconds);
}
