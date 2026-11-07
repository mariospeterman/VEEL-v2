import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("auth confirmation redirect", () => {
  it.each([
    "%2F%5Cevil.example",
    "%2F%255cevil.example",
    "%2F%252fevil.example"
  ])("fails on the trusted landing origin for unsafe next=%s", async (next) => {
    const response = await GET(new NextRequest(
      `https://wevid.example/auth/confirm?next=${next}`
    ));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://wevid.example/?error=auth_confirm_failed&mode=login"
    );
  });
});
