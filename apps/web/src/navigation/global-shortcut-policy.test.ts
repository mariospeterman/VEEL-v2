import { describe, expect, it, vi } from "vitest";
import { shouldIgnoreGlobalShortcut } from "./global-shortcut-policy";

function event(overrides: Partial<Parameters<typeof shouldIgnoreGlobalShortcut>[0]> = {}) {
  return {
    altKey: false,
    ctrlKey: false,
    defaultPrevented: false,
    isComposing: false,
    metaKey: false,
    shiftKey: false,
    target: null,
    ...overrides
  } as Parameters<typeof shouldIgnoreGlobalShortcut>[0];
}

describe("global shortcut policy", () => {
  it.each(["altKey", "ctrlKey", "metaKey", "shiftKey", "isComposing", "defaultPrevented"] as const)(
    "ignores %s keyboard events",
    (property) => expect(shouldIgnoreGlobalShortcut(event({ [property]: true }))).toBe(true)
  );

  it("ignores events from editable and interactive descendants", () => {
    const closest = vi.fn(() => ({ tagName: "TEXTAREA" }));
    expect(shouldIgnoreGlobalShortcut(event({ target: { closest } as unknown as EventTarget }))).toBe(true);
    expect(closest).toHaveBeenCalledWith(expect.stringContaining("textarea"));
  });

  it("allows an unmodified event outside interactive controls", () => {
    const target = { closest: vi.fn(() => null) } as unknown as EventTarget;
    expect(shouldIgnoreGlobalShortcut(event({ target }))).toBe(false);
  });
});
