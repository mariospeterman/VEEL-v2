import { describe, expect, it } from "vitest";
import { safeProviderImageSource } from "./provider-image-source";

describe("safeProviderImageSource", () => {
  it("accepts base64 wallet-standard image data", () => {
    const icon = "data:image/svg+xml;base64,PHN2Zy8+";
    expect(safeProviderImageSource(icon)).toBe(icon);
  });

  it("rejects remote, scriptable, and unencoded sources", () => {
    expect(safeProviderImageSource("https://tracker.example/icon.png")).toBeUndefined();
    expect(safeProviderImageSource("data:text/html;base64,PHNjcmlwdD4=")).toBeUndefined();
    expect(safeProviderImageSource("data:image/svg+xml,<svg onload=alert(1) />")).toBeUndefined();
  });
});
