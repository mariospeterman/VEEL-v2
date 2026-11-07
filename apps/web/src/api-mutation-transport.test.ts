import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiMutationError } from "./api-mutation-types";
import {
  authenticatedEmptyMutation,
  authenticatedGet,
  publicMutation
} from "./api-mutation-transport";
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

  it("keeps an empty mutation pending until its response body completes and cancels that body", async () => {
    globalThis.__WEVID_PUBLIC_ENV__ = readServerPublicWebEnv({
      NODE_ENV: "test",
      NEXT_PUBLIC_API_BASE_URL: "http://127.0.0.1:4000"
    });
    vi.stubGlobal("window", { location: { href: "http://127.0.0.1:3000" } });
    vi.stubGlobal("document", { cookie: "" });

    let bodyStarted = false;
    const fetchMock = vi.fn((_input: URL, init?: RequestInit) => {
      const signal = init?.signal;
      if (!signal) throw new Error("Missing AbortSignal");
      const body = new ReadableStream({
        start(controller) {
          bodyStarted = true;
          signal.addEventListener("abort", () => {
            controller.error(new DOMException("Cancelled", "AbortError"));
          }, { once: true });
        }
      });
      return Promise.resolve(new Response(body, { status: 202 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const controller = new AbortController();
    const request = authenticatedEmptyMutation(
      "/v1/payments/intents/payment-1/submissions",
      "POST",
      { signature: "signature-1" },
      "command-1",
      controller.signal
    );
    await vi.waitFor(() => expect(bodyStarted).toBe(true));
    let settled = false;
    void request.then(
      () => { settled = true; },
      () => { settled = true; }
    );
    await Promise.resolve();
    expect(settled).toBe(false);

    controller.abort();
    await expect(request).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
  });

  it("bounds authenticated session JSON including a body that stalls after headers", async () => {
    globalThis.__WEVID_PUBLIC_ENV__ = readServerPublicWebEnv({
      NODE_ENV: "test",
      NEXT_PUBLIC_API_BASE_URL: "http://127.0.0.1:4000"
    });
    vi.stubGlobal("window", { location: { href: "http://127.0.0.1:3000" } });
    vi.stubGlobal("document", { cookie: "" });

    let bodyStarted = false;
    const fetchMock = vi.fn((_input: URL, init?: RequestInit) => {
      const signal = init?.signal;
      if (!signal) throw new Error("Missing AbortSignal");
      const body = new ReadableStream({
        start(controller) {
          bodyStarted = true;
          signal.addEventListener("abort", () => {
            controller.error(new DOMException("Cancelled", "AbortError"));
          }, { once: true });
        }
      });
      return Promise.resolve(new Response(body, {
        headers: { "content-type": "application/json" },
        status: 200
      }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const controller = new AbortController();
    const request = authenticatedGet("/v1/session", controller.signal);
    await vi.waitFor(() => expect(bodyStarted).toBe(true));
    controller.abort();

    await expect(request).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
  });
});
