"use client";

import { walletSessionCookieName } from "./wallet-session-cookie";

const walletSessionKey = "veel-wallet-session";
export { walletSessionCookieName };

export interface WalletSessionRecord {
  expiresAt: string;
  address: string;
  provider: string;
}

export interface SaveWalletSessionInput extends WalletSessionRecord {
  accessToken: string;
}

export function saveWalletSession(session: SaveWalletSessionInput) {
  const { accessToken, ...storedSession } = session;
  window.localStorage.setItem(walletSessionKey, JSON.stringify(storedSession));
  document.cookie = walletSessionCookie(accessToken, session.expiresAt);
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
  document.cookie = expiredWalletSessionCookie();
}

function walletSessionCookie(token: string, expiresAt: string) {
  const expiresAtMs = Date.parse(expiresAt);
  const maxAge = Number.isFinite(expiresAtMs)
    ? Math.max(0, Math.floor((expiresAtMs - Date.now()) / 1000))
    : 0;
  const parts = [
    `${walletSessionCookieName}=${encodeURIComponent(token)}`,
    "path=/",
    `max-age=${maxAge}`,
    "samesite=lax"
  ];

  if (window.location.protocol === "https:") {
    parts.push("secure");
  }

  return parts.join("; ");
}

function expiredWalletSessionCookie() {
  const parts = [`${walletSessionCookieName}=`, "path=/", "max-age=0", "samesite=lax"];

  if (window.location.protocol === "https:") {
    parts.push("secure");
  }

  return parts.join("; ");
}
