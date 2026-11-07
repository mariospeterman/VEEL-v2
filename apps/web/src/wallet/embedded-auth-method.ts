export type EmbeddedAuthMethod = "email" | "google" | "discord" | "twitter" | "passkey";

export const embeddedAuthResumeKey = "wevid:privy-auth-resume";

export const embeddedAuthMethods: ReadonlyArray<{
  label: string;
  method: EmbeddedAuthMethod;
  logo: "email" | "google" | "discord" | "x" | "passkey";
  status: string;
}> = [
  { label: "Email", method: "email", logo: "email", status: "One-time code" },
  { label: "Google", method: "google", logo: "google", status: "Continue securely" },
  { label: "Discord", method: "discord", logo: "discord", status: "Continue securely" },
  { label: "X", method: "twitter", logo: "x", status: "Continue securely" },
  { label: "Passkey", method: "passkey", logo: "passkey", status: "Device protected" }
];

export function readEmbeddedAuthResume(purpose: "login" | "onboarding"): EmbeddedAuthMethod | null {
  try {
    const raw = window.sessionStorage.getItem(embeddedAuthResumeKey);
    if (!raw) return null;
    const value = JSON.parse(raw) as { method?: unknown; purpose?: unknown };
    if (value.purpose !== purpose || !isEmbeddedAuthMethod(value.method)) return null;
    return value.method;
  } catch {
    return null;
  }
}

export function rememberEmbeddedAuthResume(method: EmbeddedAuthMethod, purpose: "login" | "onboarding") {
  window.sessionStorage.setItem(embeddedAuthResumeKey, JSON.stringify({ method, purpose }));
}

export function clearEmbeddedAuthResume() {
  window.sessionStorage.removeItem(embeddedAuthResumeKey);
}

function isEmbeddedAuthMethod(value: unknown): value is EmbeddedAuthMethod {
  return value === "email" || value === "google" || value === "discord" || value === "twitter" || value === "passkey";
}
