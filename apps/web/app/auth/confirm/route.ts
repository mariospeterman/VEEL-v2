import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/supabase/server";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const tokenHash = requestUrl.searchParams.get("token_hash");
  const type = requestUrl.searchParams.get("type") as EmailOtpType | null;
  const next = safeNextPath(requestUrl.searchParams.get("next"));
  const redirectUrl = new URL(next, requestUrl.origin);

  if (code || (tokenHash && type)) {
    const supabase = await createSupabaseServerClient();
    const { error } = supabase
      ? await confirmSupabaseAuth(supabase, { code, tokenHash, type })
      : { error: new Error("Supabase is not configured") };

    if (!error) {
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

  return { error: new Error("Missing Supabase auth confirmation parameters") };
}
