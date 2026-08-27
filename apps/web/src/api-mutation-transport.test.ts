import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiMutationError } from "./api-mutation-types";
import { publicMutation } from "./api-mutation-transport";
import { readServerPublicWebEnv } from "./public-env";

afterEach(() => {
  globalThis.__WEVID_PUBLIC_ENV__ = undefined;
  vi.unstubAllGlobals();
});

describe("browser mutation cancellation", () => {
  it("passes the wallet flow AbortSignal to the underlying fetch", async () => {
    globalThis.__WEVID_PUBLIC_ENV__ = readServerPublicWebEnv({
      NODE_ENV: "test",
      NEXT_PUBLIC_API_BASE_URL: "http://127.0.0.1:4000"
    });
    vi.stubGlobal("window", { location: { href: "http://127.0.0.1:3000" } });

    const fetchMock = vi.fn((_input: URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) {
        reject(new Error("Missing AbortSignal"));
        return;
      }

      signal.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError")), { once: true });
    }));
    vi.stubGlobal("fetch", fetchMock);

    const controller = new AbortController();
    const request = publicMutation("/v1/auth/wallet/sessions", "POST", { proof: "test" }, controller.signal);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    controller.abort();

    await expect(request).rejects.toEqual(new ApiMutationError("API is unavailable", 503));
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
  });
});
