import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn()
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: mocks.createServerClient
}));

import { updateSupabaseSession } from "./proxy";

type CookieWrite = {
  name: string;
  value: string;
  options: {
    httpOnly?: boolean;
    path?: string;
  };
};

type ServerClientOptions = {
  cookies: {
    setAll(cookies: CookieWrite[], headers: Record<string, string>): void;
  };
};

describe("updateSupabaseSession", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    mocks.createServerClient.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("avoids a Supabase network client when no auth cookie exists", async () => {
    const response = await updateSupabaseSession(
      new NextRequest("http://localhost:3000/app/home")
    );

    expect(response.status).toBe(200);
    expect(mocks.createServerClient).not.toHaveBeenCalled();
  });

  it("validates the session and forwards refreshed cookies and cache headers", async () => {
    const getClaims = vi.fn().mockResolvedValue({ data: { claims: {} }, error: null });

    mocks.createServerClient.mockImplementation(
      (_url: string, _key: string, options: ServerClientOptions) => {
        options.cookies.setAll(
          [
            {
              name: "sb-project-auth-token",
              value: "refreshed-session",
              options: { httpOnly: true, path: "/" }
            }
          ],
          { "cache-control": "private, no-cache" }
        );

        return { auth: { getClaims } };
      }
    );

    const response = await updateSupabaseSession(
      new NextRequest("http://localhost:3000/settings", {
        headers: { cookie: "sb-project-auth-token=stale-session" }
      })
    );

    expect(mocks.createServerClient).toHaveBeenCalledWith(
      "https://example.supabase.co",
      "sb_publishable_test",
      expect.any(Object)
    );
    expect(getClaims).toHaveBeenCalledOnce();
    expect(response.cookies.get("sb-project-auth-token")?.value).toBe("refreshed-session");
    expect(response.headers.get("cache-control")).toBe("private, no-cache");
  });
});
