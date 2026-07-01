import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { parsePublicWebEnv } from "@veel/config/public";
import { createSupabaseServerClient } from "@/supabase/server";

const walletSessionCookieName = "veel_wallet_session_token";
type AppAccessReason =
  | "age_pending"
  | "age_required"
  | "blocked"
  | "identity_required"
  | "ready"
  | "wallet_required";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const tokenHash = requestUrl.searchParams.get("token_hash");
  const type = requestUrl.searchParams.get("type") as EmailOtpType | null;
  const next = safeNextPath(requestUrl.searchParams.get("next"));
  const redirectUrl = new URL(next, requestUrl.origin);

  if (code || (tokenHash && type)) {
    const supabase = await createSupabaseServerClient();
    const { data, error } = supabase
      ? await confirmSupabaseAuth(supabase, { code, tokenHash, type })
      : { data: null, error: new Error("Supabase is not configured") };

    if (!error) {
      const linkError = await linkWalletRecoveryIfPresent(request, data?.session?.access_token ?? null);
      if (linkError) {
        redirectUrl.pathname = "/";
        redirectUrl.search = "";
        redirectUrl.searchParams.set("mode", "login");
        redirectUrl.searchParams.set("error", linkError);
        return NextResponse.redirect(redirectUrl);
      }

      if (next.startsWith("/app/")) {
        const resolvedRedirect = await resolveRecoveryRedirect(requestUrl.origin, next, data?.session?.access_token ?? null);
        return NextResponse.redirect(resolvedRedirect);
      }

      return NextResponse.redirect(redirectUrl);
    }
  }

  redirectUrl.pathname = "/";
  redirectUrl.search = "";
  redirectUrl.searchParams.set("mode", "login");
  redirectUrl.searchParams.set("error", "auth_confirm_failed");
  return NextResponse.redirect(redirectUrl);
}

function safeNextPath(value: string | null) {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/";
}

async function confirmSupabaseAuth(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  params: { code: string | null; tokenHash: string | null; type: EmailOtpType | null }
) {
  if (!supabase) {
    return { error: new Error("Supabase is not configured") };
  }

  if (params.code) {
    return supabase.auth.exchangeCodeForSession(params.code);
  }

  if (params.tokenHash && params.type) {
    return supabase.auth.verifyOtp({ token_hash: params.tokenHash, type: params.type });
  }

  return { data: null, error: new Error("Missing Supabase auth confirmation parameters") };
}

async function linkWalletRecoveryIfPresent(request: NextRequest, supabaseAccessToken: string | null) {
  const walletSessionToken = request.cookies.get(walletSessionCookieName)?.value;

  if (!walletSessionToken || !supabaseAccessToken) {
    return null;
  }

  const env = parsePublicWebEnv(process.env);

  try {
    const response = await fetch(new URL("/v1/auth/recovery-link", env.NEXT_PUBLIC_API_BASE_URL), {
      body: JSON.stringify({ walletSessionToken }),
      cache: "no-store",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${supabaseAccessToken}`,
        "content-type": "application/json",
        "idempotency-key": crypto.randomUUID()
      },
      method: "POST"
    });

    return response.ok ? null : "recovery_link_failed";
  } catch {
    return "recovery_link_failed";
  }
}

async function resolveRecoveryRedirect(origin: string, next: string, supabaseAccessToken: string | null) {
  if (!supabaseAccessToken) {
    return landingRedirect(origin, { error: "auth_confirm_failed", mode: "login" });
  }

  const env = parsePublicWebEnv(process.env);

  try {
    const response = await fetch(new URL("/v1/session", env.NEXT_PUBLIC_API_BASE_URL), {
      cache: "no-store",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${supabaseAccessToken}`
      }
    });

    if (!response.ok) {
      return landingRedirect(origin, { error: "recovery_needs_wallet", mode: "onboarding", step: "wallet", next });
    }

    const session = (await response.json()) as {
      appAccessState?: {
        allowed?: boolean;
        reason?: AppAccessReason;
      };
    };

    if (session.appAccessState?.allowed) {
      return new URL(next, origin);
    }

    return recoveryRedirectForReason(origin, next, session.appAccessState?.reason);
  } catch {
    return landingRedirect(origin, { error: "recovery_needs_wallet", mode: "onboarding", step: "wallet", next });
  }
}

function recoveryRedirectForReason(origin: string, next: string, reason: AppAccessReason | undefined) {
  if (reason === "age_pending" || reason === "age_required") {
    return landingRedirect(origin, { mode: "onboarding", step: "age", next });
  }

  if (reason === "wallet_required" || reason === "identity_required") {
    return landingRedirect(origin, { error: "recovery_needs_wallet", mode: "onboarding", step: "wallet", next });
  }

  return landingRedirect(origin, { mode: "login", next });
}

function landingRedirect(origin: string, params: Record<string, string>) {
  const url = new URL("/", origin);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url;
}
