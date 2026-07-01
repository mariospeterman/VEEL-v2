import { NextResponse, type NextRequest } from "next/server";

export function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const next = safeNextPath(requestUrl.searchParams.get("next")) ?? "/app/home";
  return NextResponse.redirect(new URL(next, requestUrl.origin));
}

function safeNextPath(value: string | null) {
  return value?.startsWith("/") && !value.startsWith("//") ? value : null;
}
