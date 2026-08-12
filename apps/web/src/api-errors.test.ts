import { describe, expect, it } from "vitest";
import { ApiMutationError } from "./api-mutation-types";
import { mapApiFailure, safeMutationMessage } from "./api-errors";

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

  it("explains when a wallet action reached the browser but not the API", () => {
    expect(safeMutationMessage(new ApiMutationError("API is unavailable", 503), "Wallet connection")).toBe(
      "Wallet connected, but the WeVid API is not reachable from the browser. Check the API server and try again."
    );
  });

  it("does not claim non-wallet actions reached a wallet", () => {
    expect(safeMutationMessage(new ApiMutationError("API is unavailable", 503), "Profile setup")).toBe(
      "Profile setup could not reach the WeVid API from the browser. Check the API server and try again."
    );
  });
});
