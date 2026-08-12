import type { NextRequest } from "next/server";
import { updateSupabaseSession } from "@/supabase/proxy";

export async function proxy(request: NextRequest) {
  return updateSupabaseSession(request);
}

export const config = {
  matcher: [
    "/admin/:path*",
    "/age/:path*",
    "/app/:path*",
    "/auth/:path*",
    "/content/:path*",
    "/event-access/:path*",
    "/live/:path*",
    "/mutuals/:path*",
    "/oauth/:path*",
    "/passes/:path*"
  ]
};
