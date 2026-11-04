import { readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import { describe, expect, it } from "vitest";

describe("provider dependency security boundaries", () => {
  it("keeps Coinbase SDK use on the Zod-free auth export", () => {
    const apiSource = sourceText("apps/api/src");
    const coinbaseImports = [
      ...apiSource.matchAll(/from\s+["'](@coinbase\/cdp-sdk[^"']*)["']/gu)
    ].map((match) => match[1]);

    expect(coinbaseImports).toEqual(["@coinbase/cdp-sdk/auth"]);
  });

  it("does not activate Privy or standalone x402 payment wrappers", () => {
    const webSource = sourceText("apps/web/app") + sourceText("apps/web/src");

    expect(webSource).not.toMatch(/from\s+["'][^"']*x402[^"']*["']/u);
    expect(webSource).not.toContain("wrapFetchWithPayment");
  });
});

function sourceText(root) {
  return sourceFiles(root).map((path) => readFileSync(path, "utf8")).join("\n");
}

function sourceFiles(root) {
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...sourceFiles(path));
    } else if ([".ts", ".tsx"].includes(extname(entry.name)) && !entry.name.includes(".test.")) {
      files.push(path);
    }
  }
  return files.sort();
}
