import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearEmbeddedAuthResume,
  embeddedAuthResumeKey,
  readEmbeddedAuthResume,
  rememberEmbeddedAuthResume
} from "./embedded-auth-method";

describe("embedded auth resume", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resumes only the same purpose and a known method", () => {
    const storage = memoryStorage();
    vi.stubGlobal("window", { sessionStorage: storage });

    rememberEmbeddedAuthResume("google", "login");
    expect(readEmbeddedAuthResume("login")).toBe("google");
    expect(readEmbeddedAuthResume("onboarding")).toBeNull();
  });

  it("fails closed for malformed state and clears completed flows", () => {
    const storage = memoryStorage();
    vi.stubGlobal("window", { sessionStorage: storage });

    storage.setItem(embeddedAuthResumeKey, JSON.stringify({ method: "unknown", purpose: "login" }));
    expect(readEmbeddedAuthResume("login")).toBeNull();

    rememberEmbeddedAuthResume("discord", "onboarding");
    clearEmbeddedAuthResume();
    expect(storage.getItem(embeddedAuthResumeKey)).toBeNull();
  });
});

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    get length() {
      return values.size;
    },
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    }
  };
}
