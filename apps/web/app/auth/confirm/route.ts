import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { parsePublicWebEnv } from "@veel/config/public";
import { createSupabaseServerClient } from "@/supabase/server";

type AppAccessReason =
  | "age_pending"
  | "age_required"
  | "blocked"
  | "identity_required"
  | "ready"
  | "wallet_required";

const recoveryLinkIntentCookieName = "veel_recovery_link_intent";

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
      const exchange = await exchangeRecoveryIdentity(request, data?.session?.access_token ?? null);
      if (exchange.error) {
        redirectUrl.pathname = "/";
        redirectUrl.search = "";
        redirectUrl.searchParams.set("mode", "login");
        redirectUrl.searchParams.set("error", exchange.error);
        return NextResponse.redirect(redirectUrl);
      }

      let destination = redirectUrl;
      if (next.startsWith("/app/")) {
        destination = await resolveRecoveryRedirect(requestUrl.origin, next, exchange.applicationCookie);
      }

      const response = NextResponse.redirect(destination);
      for (const cookie of exchange.setCookies) response.headers.append("set-cookie", cookie);
      return response;
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

async function exchangeRecoveryIdentity(request: NextRequest, supabaseAccessToken: string | null) {
  if (!supabaseAccessToken) return { error: "auth_confirm_failed", setCookies: [], applicationCookie: null };

  const env = parsePublicWebEnv(process.env);

  try {
    const response = await fetch(new URL("/v1/auth/recovery/exchange", env.NEXT_PUBLIC_API_BASE_URL), {
      body: JSON.stringify({}),
      cache: "no-store",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${supabaseAccessToken}`,
        ...recoveryIntentCookieHeader(request),
        "content-type": "application/json",
        "idempotency-key": crypto.randomUUID()
      },
      method: "POST"
    });

    if (!response.ok) return { error: "recovery_exchange_failed", setCookies: [], applicationCookie: null };
    const setCookies = responseSetCookies(response.headers);
    const applicationCookie = setCookies.find((value) => value.startsWith("wevid_session=")) ?? null;
    return { error: null, setCookies, applicationCookie };
  } catch {
    return { error: "recovery_exchange_failed", setCookies: [], applicationCookie: null };
  }
}

function recoveryIntentCookieHeader(request: NextRequest) {
  const token = request.cookies.get(recoveryLinkIntentCookieName)?.value;
  return token
    ? { cookie: `${recoveryLinkIntentCookieName}=${encodeURIComponent(token)}` }
    : {};
}

async function resolveRecoveryRedirect(origin: string, next: string, applicationCookie: string | null) {
  if (!applicationCookie) {
    return landingRedirect(origin, { error: "auth_confirm_failed", mode: "login" });
  }

  const env = parsePublicWebEnv(process.env);

  try {
    const response = await fetch(new URL("/v1/session", env.NEXT_PUBLIC_API_BASE_URL), {
      cache: "no-store",
      headers: {
        accept: "application/json",
        cookie: applicationCookie.split(";", 1)[0] ?? ""
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

function responseSetCookies(headers: Headers): string[] {
  const withGetSetCookie = headers as Headers & { getSetCookie?: () => string[] };
  return withGetSetCookie.getSetCookie?.() ?? (headers.get("set-cookie") ? [headers.get("set-cookie") as string] : []);
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
