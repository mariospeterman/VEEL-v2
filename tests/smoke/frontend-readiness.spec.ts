import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const publicSurfaces = [
  { name: "landing", path: "/", heading: "Stop building on rented ground." },
  { name: "login", path: "/?mode=login", heading: "Continue to WeVid." },
  { name: "onboarding", path: "/?mode=onboarding", heading: "Continue to WeVid." },
  { name: "offline", path: "/offline", heading: "WeVid is offline" }
] as const;

test("public surfaces have no serious or critical automated accessibility violations", async ({ page }) => {
  for (const surface of publicSurfaces) {
    await page.goto(surface.path, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: surface.heading })).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    const blocking = results.violations.filter((violation) =>
      violation.impact === "serious" || violation.impact === "critical"
    );

    expect(blocking, formatViolations(blocking)).toEqual([]);
  }
});

test("entry presents visible provider choices without provider implementation copy", async ({ page }) => {
  await page.goto("/?mode=login", { waitUntil: "domcontentloaded" });

  const connect = page.getByRole("button", { name: /Choose (a )?wallet|More wallet/ });
  await expect(connect).toBeVisible({ timeout: 20_000 });
  await expect(connect).toBeEnabled({ timeout: 20_000 });
  await expect(page.getByText("Privy", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Create secure WeVid wallet|Create wallet|One secure setup/ })).toHaveCount(0);
  await expect(page.getByText(/powered by|solana wallet adapter/i)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Language" })).toHaveCount(0);

  await connect.click();
  await expect(page.getByRole("dialog", { name: /wallet.*solana|need a wallet/i })).toBeVisible();
});

test("a detected wallet connects, signs, and enters onboarding from one provider click", async ({ page }) => {
  await installMockSolanaWallet(page, "Phantom");
  let challengeRequests = 0;
  let sessionRequests = 0;

  await page.route("**/v1/auth/wallet/challenges", async (route) => {
    challengeRequests += 1;
    await route.fulfill({
      contentType: "application/json",
      json: {
        address: "11111111111111111111111111111111",
        chain: "solana_devnet",
        expiresAt: "2099-01-01T00:00:00.000Z",
        id: "00000000-0000-4000-8000-000000000901",
        message: "Sign this test ownership challenge.",
        provider: "phantom",
        purpose: "onboarding"
      },
      status: 201
    });
  });
  await page.route("**/v1/auth/wallet/sessions", async (route) => {
    sessionRequests += 1;
    await route.fulfill({ contentType: "application/json", json: { ok: true }, status: 201 });
  });
  await page.route("**/v1/session", async (route) => {
    await route.fulfill({ contentType: "application/json", json: { appAccessState: { allowed: false, reason: "identity_required" } }, status: 200 });
  });

  await page.goto("/?mode=onboarding", { waitUntil: "domcontentloaded" });
  const phantom = page.getByRole("button", { name: "Set up with Phantom" });
  await expect(phantom).toBeVisible({ timeout: 20_000 });
  await phantom.click();

  await expect(page.getByLabel("Handle")).toBeVisible();
  expect(challengeRequests).toBe(1);
  expect(sessionRequests).toBe(1);
  expect(await page.evaluate(() => (window as typeof window & { __wevidWalletTest?: { connect: number; sign: number } }).__wevidWalletTest)).toEqual({ connect: 1, sign: 1 });
});

test("a stalled wallet signature can be stopped without creating an account session", async ({ page }) => {
  await installMockSolanaWallet(page, "Phantom", true);
  let sessionRequests = 0;

  await page.route("**/v1/auth/wallet/challenges", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        address: "11111111111111111111111111111111",
        chain: "solana_devnet",
        expiresAt: "2099-01-01T00:00:00.000Z",
        id: "00000000-0000-4000-8000-000000000902",
        message: "Leave this test signature pending.",
        provider: "phantom",
        purpose: "onboarding"
      },
      status: 201
    });
  });
  await page.route("**/v1/auth/wallet/sessions", async (route) => {
    sessionRequests += 1;
    await route.fulfill({ contentType: "application/json", json: { ok: true }, status: 201 });
  });

  await page.goto("/?mode=onboarding", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Set up with Phantom" }).click();
  await expect(page.getByText(/check your wallet and sign the ownership message/i)).toBeVisible();

  const stop = page.getByRole("button", { name: "Stop and disconnect" });
  await expect(stop).toBeEnabled();
  await stop.click();

  await expect(page.getByText("Wallet disconnected.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Set up with Phantom" })).toBeEnabled();
  expect(sessionRequests).toBe(0);
});

test("offline recovery actions remain reachable on a short viewport", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 240 });
  await page.goto("/offline", { waitUntil: "domcontentloaded" });

  const offlinePage = page.locator(".offline-page");
  await expect(offlinePage).toHaveCSS("overflow-y", "auto");
  expect(await offlinePage.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);

  const recoveryLink = page.getByRole("link", { name: "Go to WeVid" });
  await recoveryLink.scrollIntoViewIfNeeded();
  await expect(recoveryLink).toBeInViewport();
  await expect(page.getByRole("link", { name: "Try again" })).toHaveAttribute("href", "/offline?retry=current");
});

test("manifest, install icons, and service worker meet the public PWA contract", async ({ request }) => {
  const manifestResponse = await request.get("/manifest.webmanifest");
  expect(manifestResponse.ok()).toBe(true);
  const manifest = await manifestResponse.json() as {
    display: string;
    icons: Array<{ purpose?: string; sizes: string; src: string }>;
    scope: string;
  };

  expect(manifest.display).toBe("standalone");
  expect(manifest.scope).toBe("/");
  expect(manifest.icons).toEqual(expect.arrayContaining([
    expect.objectContaining({ sizes: "192x192", src: "/pwa-icon-192.png" }),
    expect.objectContaining({ sizes: "512x512", src: "/pwa-icon-512.png" }),
    expect.objectContaining({ purpose: "maskable", sizes: "512x512" })
  ]));

  for (const icon of manifest.icons) {
    const response = await request.get(icon.src);
    expect(response.ok()).toBe(true);
    expect(response.headers()["content-type"]).toContain("image/png");
    expect(pngDimensions(await response.body())).toEqual(icon.sizes.split("x").map(Number));
  }

  const workerResponse = await request.get("/veel-sw.js");
  expect(workerResponse.ok()).toBe(true);
  expect(workerResponse.headers()["cache-control"]).toContain("no-store");
  expect(workerResponse.headers()["service-worker-allowed"]).toBe("/");
  const worker = await workerResponse.text();
  expect(worker).toContain("request.mode === \"navigate\"");
  expect(worker).toContain("OFFLINE_URL");
  expect(worker).not.toContain("cache.put(request, response)");
});

test("installed Chromium serves the privacy-safe offline document", async ({ browserName, context, page }) => {
  test.skip(browserName !== "chromium", "Playwright service-worker control is proven in Chromium; target-device WebKit proof remains a staging gate.");

  await page.goto("/offline");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(() => navigator.serviceWorker.controller?.scriptURL.endsWith("/veel-sw.js") === true);
  await context.setOffline(true);

  const retryPath = `/offline-proof-${Date.now()}?mode=onboarding&step=profile`;
  try {
    await page.goto(retryPath, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "WeVid is offline" })).toBeVisible();
    await expect(page.getByText(/private content and account actions are never stored/i)).toBeVisible();
    await expect(page.getByRole("link", { name: "Try again" })).toHaveAttribute("href", retryPath);
  } finally {
    await context.setOffline(false);
  }

  await page.getByRole("link", { name: "Try again" }).click();
  await expect.poll(() => {
    const currentUrl = new URL(page.url());
    return currentUrl.pathname + currentUrl.search;
  }).toBe(retryPath);
});

function pngDimensions(bytes: Buffer) {
  expect(bytes.subarray(1, 4).toString("ascii")).toBe("PNG");
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

function formatViolations(violations: Array<{ id: string; impact: string | null; nodes: Array<{ target: unknown }> }>) {
  return violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    targets: violation.nodes.map((node) => node.target)
  }));
}

async function installMockSolanaWallet(page: Page, name: string, pendingSignature = false) {
  await page.addInitScript(({ walletName, keepSignaturePending }) => {
    const walletTestState = { connect: 0, sign: 0 };
    (window as typeof window & { __wevidWalletTest?: typeof walletTestState }).__wevidWalletTest = walletTestState;
    const listeners = new Set<(properties: { accounts?: readonly unknown[] }) => void>();
    let accounts: readonly unknown[] = [];
    const account = Object.freeze({
      address: "11111111111111111111111111111111",
      chains: ["solana:devnet"],
      features: ["solana:signMessage", "solana:signTransaction"],
      icon: undefined,
      label: "WeVid test wallet",
      publicKey: new Uint8Array(32)
    });
    const wallet = {
      get accounts() {
        return accounts;
      },
      chains: ["solana:devnet"],
      features: {
        "solana:signMessage": {
          signMessage: async (...inputs: Array<{ message: Uint8Array }>) => {
            walletTestState.sign += 1;
            if (keepSignaturePending) {
              await new Promise<never>(() => undefined);
            }
            return inputs.map(({ message }) => ({ signature: new Uint8Array(64), signedMessage: message }));
          },
          version: "1.0.0"
        },
        "solana:signTransaction": {
          signTransaction: async (...inputs: Array<{ transaction: Uint8Array }>) => inputs.map(({ transaction }) => ({ signedTransaction: transaction })),
          supportedTransactionVersions: ["legacy"],
          version: "1.0.0"
        },
        "standard:connect": {
          connect: async () => {
            walletTestState.connect += 1;
            accounts = [account];
            for (const listener of listeners) listener({ accounts });
            return { accounts };
          },
          version: "1.0.0"
        },
        "standard:disconnect": {
          disconnect: async () => {
            accounts = [];
            for (const listener of listeners) listener({ accounts });
          },
          version: "1.0.0"
        },
        "standard:events": {
          on: (_event: string, listener: (properties: { accounts?: readonly unknown[] }) => void) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
          },
          version: "1.0.0"
        }
      },
      icon: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      name: walletName,
      version: "1.0.0"
    };

    window.addEventListener("wallet-standard:app-ready", ((event: CustomEvent<{ register: (...wallets: unknown[]) => void }>) => {
      event.detail.register(wallet);
    }) as EventListener);
  }, { keepSignaturePending: pendingSignature, walletName: name });
}
