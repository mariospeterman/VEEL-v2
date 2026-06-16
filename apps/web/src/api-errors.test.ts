import { describe, expect, it } from "vitest";
import { mapApiFailure } from "./api-errors";

describe("mapApiFailure", () => {
  it.each([
    [401, "unauthenticated", "Sign in to continue"],
    [403, "forbidden", "Access is not available"],
    [404, "not_found", "Nothing found"],
    [429, "rate_limited", "Too many attempts"],
    [503, "service_unavailable", "Service temporarily unavailable"]
  ])("maps %s to %s", (status, kind, title) => {
    expect(mapApiFailure({ ok: false, status, message: "Missing or invalid bearer token" })).toMatchObject({
      kind,
      title
    });
  });

  it("does not expose raw backend auth detail in safe copy", () => {
    const mapped = mapApiFailure({ ok: false, status: 401, message: "Missing or invalid bearer token" }, "Home");

    expect(mapped.message).not.toContain("bearer");
    expect(mapped.debugMessage).toBe("Missing or invalid bearer token");
  });

  it("maps the local fetch fallback to a connection problem", () => {
    expect(mapApiFailure({ ok: false, status: 503, message: "API is unavailable" })).toMatchObject({
      kind: "network",
      title: "Service temporarily unavailable"
    });
  });
});
