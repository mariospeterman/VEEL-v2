import { describe, expect, it } from "vitest";
import { safeSameOriginPath } from "./safe-same-origin-path";

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
