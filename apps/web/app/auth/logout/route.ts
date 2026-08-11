import { type NextRequest, NextResponse } from "next/server";
import { e2eAuthCookieName } from "@/supabase/auth-cookie";
import { createSupabaseServerClient } from "@/supabase/server";
import { walletSessionCookieName } from "@/wallet/wallet-session-cookie";

export async function POST(request: NextRequest) {
  await signOutSupabaseBestEffort();

  const response = NextResponse.json({ ok: true });
  expireCookie(response, walletSessionCookieName);
  expireCookie(response, e2eAuthCookieName);

  for (const cookie of request.cookies.getAll()) {
    if (cookie.name.startsWith("sb-")) {
      expireCookie(response, cookie.name);
    }
  }

  return response;
}

async function signOutSupabaseBestEffort() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return;

  await withTimeout(supabase.auth.signOut({ scope: "local" }), 900).catch(() => {});
}

function expireCookie(response: NextResponse, name: string) {
  response.cookies.set(name, "", {
    maxAge: 0,
    path: "/",
    sameSite: "lax"
  });
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("Logout step timed out")), timeoutMs);
    })
  ]);
}
