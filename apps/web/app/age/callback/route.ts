import { NextResponse, type NextRequest } from "next/server";
import { safeSameOriginPath } from "@/navigation/safe-same-origin-path";

export function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const next = safeSameOriginPath(requestUrl.searchParams.get("next"), "/app/home");
  const landingUrl = new URL("/", requestUrl.origin);
  landingUrl.searchParams.set("mode", "onboarding");
  landingUrl.searchParams.set("step", "age");
  landingUrl.searchParams.set("verification", "return");
  landingUrl.searchParams.set("next", next);
  if (requestUrl.searchParams.get("intent") === "adult") landingUrl.searchParams.set("intent", "adult");
  return NextResponse.redirect(landingUrl);
}
