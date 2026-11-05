import { describe, expect, it, vi } from "vitest";
import { assignSameOriginPath, safeSameOriginPath } from "./safe-same-origin-path";

describe("safeSameOriginPath", () => {
  it.each([
    "/app/home",
    "/app/messages?conversation=one#latest",
    "/"
  ])("keeps same-origin path %s", (path) => {
    expect(safeSameOriginPath(path, "/fallback")).toBe(path);
  });

  it.each([
    "https://evil.example/path",
    "//evil.example/path",
    "/\\evil.example/path",
    "/%5cevil.example/path",
    "/%2fevil.example/path",
    "/%0aevil.example/path",
    "/app/home\nLocation: https://evil.example",
    "https://user@evil.example/path",
    "app/home",
    ""
  ])("rejects unsafe destination %j", (path) => {
    expect(safeSameOriginPath(path, "/fallback")).toBe("/fallback");
  });

  it("supports a null fallback for optional destinations", () => {
    expect(safeSameOriginPath("/\\evil.example", null)).toBeNull();
  });
});

describe("assignSameOriginPath", () => {
  it("preserves an approved same-origin path, query, and fragment", () => {
    const assign = vi.fn();
    vi.stubGlobal("window", { location: { assign } });

    try {
      assignSameOriginPath("/app/messages?conversation=one#latest", "/app/home");
      expect(assign).toHaveBeenCalledWith("/app/messages?conversation=one#latest");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each([
    "https://evil.example/phish",
    "//evil.example/phish",
    "/\\evil.example/phish",
    "/%2fevil.example/phish",
    "javascript:alert(1)",
    "/app/home\nLocation: https://evil.example"
  ])("assigns the local fallback for hostile destination %j", (destination) => {
    const assign = vi.fn();
    vi.stubGlobal("window", { location: { assign } });

    try {
      assignSameOriginPath(destination, "/app/home");
      expect(assign).toHaveBeenCalledWith("/app/home");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("revalidates the fallback instead of trusting a second redirect input", () => {
    const assign = vi.fn();
    vi.stubGlobal("window", { location: { assign } });

    try {
      assignSameOriginPath("https://evil.example/phish", "//fallback.example/phish");
      expect(assign).toHaveBeenCalledWith("/");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
