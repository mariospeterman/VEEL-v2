import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const publicSurfaces = [
  { name: "landing", path: "/", heading: "Create without asking the algorithm for permission." },
  { name: "login", path: "/?mode=login", heading: "Log in." },
  { name: "onboarding", path: "/?mode=onboarding", heading: "Create your account." },
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

test("entry presents a direct wallet action without provider implementation copy", async ({ page }) => {
  await page.goto("/?mode=login", { waitUntil: "domcontentloaded" });

  const connect = page.getByRole("button", { name: "Connect wallet" });
  await expect(connect).toBeVisible();
  await expect(connect).toBeEnabled({ timeout: 30_000 });
  await expect(page.getByText(/powered by|google, email|passkey|solana wallet adapter/i)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Language" })).toHaveCount(0);

  await connect.click();
  await expect(page.getByRole("dialog", { name: /wallet.*solana|need a wallet/i })).toBeVisible();
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
  const retryForm = page.getByRole("button", { name: "Try again" }).locator("xpath=ancestor::form");
  await expect(retryForm).toHaveAttribute("method", "get");
  await expect(retryForm).not.toHaveAttribute("action", /.+/);
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

  try {
    await page.goto(`/offline-proof-${Date.now()}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "WeVid is offline" })).toBeVisible();
    await expect(page.getByText(/private content and account actions are never stored/i)).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
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
