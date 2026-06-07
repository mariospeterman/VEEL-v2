"use client";

import { parsePublicWebEnv } from "@veel/config";
import type { components } from "@veel/contracts";
import { createSupabaseBrowserClient } from "@/supabase/client";

export type User = components["schemas"]["User"];
export type CreateAgeSessionRequest = components["schemas"]["CreateAgeSessionRequest"];
export type AgeSession = components["schemas"]["AgeSession"];
export type UpdateProfileRequest = components["schemas"]["UpdateProfileRequest"];
export type CreateWalletLinkChallengeRequest =
  components["schemas"]["CreateWalletLinkChallengeRequest"];
export type WalletLinkChallenge = components["schemas"]["WalletLinkChallenge"];
export type LinkWalletRequest = components["schemas"]["LinkWalletRequest"];
export type Wallet = components["schemas"]["Wallet"];

export class ApiMutationError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = "ApiMutationError";
  }
}

export async function createAgeSession(body: CreateAgeSessionRequest): Promise<AgeSession> {
  return authenticatedMutation<AgeSession>("/v1/age/sessions", "POST", body);
}

export async function updateMyProfile(body: UpdateProfileRequest): Promise<User> {
  return authenticatedMutation<User>("/v1/profiles/me", "PATCH", body);
}

export async function createWalletLinkChallenge(
  body: CreateWalletLinkChallengeRequest
): Promise<WalletLinkChallenge> {
  return authenticatedMutation<WalletLinkChallenge>("/v1/wallets/link-challenges", "POST", body);
}

export async function linkWallet(body: LinkWalletRequest): Promise<Wallet> {
  return authenticatedMutation<Wallet>("/v1/wallets/link", "POST", body);
}

async function authenticatedMutation<T>(
  path: string,
  method: "PATCH" | "POST",
  body: unknown
): Promise<T> {
  const supabase = createSupabaseBrowserClient();
  const {
    data: { session }
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    throw new ApiMutationError("Create or restore a session before continuing.", 401);
  }

  const env = parsePublicWebEnv(process.env);
  const response = await fetch(new URL(path, env.NEXT_PUBLIC_API_BASE_URL), {
    body: JSON.stringify(body),
    cache: "no-store",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${session.access_token}`,
      "content-type": "application/json",
      "idempotency-key": mutationIdempotencyKey()
    },
    method
  });

  if (!response.ok) {
    throw new ApiMutationError(await errorMessage(response), response.status);
  }

  return (await response.json()) as T;
}

function mutationIdempotencyKey() {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

async function errorMessage(response: Response) {
  try {
    const body = (await response.json()) as { message?: unknown; code?: unknown };
    if (typeof body.message === "string" && body.message) return body.message;
    if (typeof body.code === "string" && body.code) return body.code;
  } catch {
    return response.statusText || "Request failed";
  }

  return response.statusText || "Request failed";
}
