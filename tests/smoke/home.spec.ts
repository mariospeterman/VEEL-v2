import { expect, test } from "@playwright/test";

const rawBackendCopy = /HTTP (401|403|404|429|500|503)|Missing or invalid bearer token|API is unavailable/;

test("renders the public landing with the current WEVID visual contract", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("link", { name: "WEVID home" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Create without asking the algorithm for permission." })).toBeVisible();
  await expect(page.getByRole("link", { name: /Start onboarding/ }).first()).toHaveAttribute("href", /\/enter\?mode=onboarding/);
  await expect(page.getByRole("link", { name: "Log in" }).first()).toHaveAttribute("href", /\/enter\?mode=login/);
  await expect(page.getByText("Public legal copy here is a product placeholder")).toHaveCount(0);
});

test("renders login and onboarding entry surfaces", async ({ page }) => {
  await page.goto("/enter?mode=login&next=%2Fapp%2Fhome", { waitUntil: "domcontentloaded", timeout: 20_000 });

  await expect(page.getByRole("heading", { name: "Log in to WEVID" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Wallet", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Embedded wallet", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recovery", exact: true })).toBeVisible();

  await page.goto("/enter?mode=onboarding&next=%2Fapp%2Fhome", { waitUntil: "domcontentloaded", timeout: 20_000 });

  await expect(page.getByRole("heading", { name: "Connect your wallet", level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: /Continue to profile/ })).toBeDisabled();
  await expect(page.getByText("Signing proves ownership only.")).toBeVisible();
});

test("renders the standalone age handoff without raw API/provider errors", async ({ page }) => {
  await page.goto("/age");

  await expect(page.getByRole("heading", { name: "Provider-backed 18+ gate" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Age status unavailable" })).toBeVisible();
  await expect(page.getByText(rawBackendCopy)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Start age verification" })).toBeDisabled();
});

test("enforces canonical app route ownership redirects", async ({ request }) => {
  const redirects: Array<[string, RegExp]> = [
    ["/activity", /\/app\/activity$/],
    ["/assistant", /\/app\/assistant$/],
    ["/create", /\/app\/create$/],
    ["/discover", /\/app\/bits$/],
    ["/messages", /\/app\/messages$/],
    ["/profile", /\/app\/profile$/],
    ["/settings", /\/app\/settings$/],
    ["/studio", /\/app\/studio$/],
    ["/subscriptions", /\/app\/subscriptions$/],
    ["/wallet", /\/app\/wallet$/]
  ];

  for (const [source, expected] of redirects) {
    const response = await request.get(source, { maxRedirects: 0 });
    expect(response.status()).toBeGreaterThanOrEqual(300);
    expect(response.status()).toBeLessThan(400);
    expect(response.headers().location ?? "").toMatch(expected);
  }
});

test("renders the canonical protected app home shell through /app", async ({ page }) => {
  await page.goto("/app/home", { waitUntil: "domcontentloaded", timeout: 45_000 });

  await expect(page.getByRole("link", { name: /WEVID/ }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: /Mixed media feed|Enter WEVID/ }).first()).toBeVisible();
  await expect(page.getByText(rawBackendCopy)).toHaveCount(0);
});

test("keeps content detail route reachable", async ({ page }) => {
  await page.goto("/content/00000000-0000-4000-8000-000000000040", { waitUntil: "domcontentloaded", timeout: 45_000 });
  await expect(page.getByRole("heading", { name: "Content unavailable" })).toBeVisible();
  await expect(page.getByText(rawBackendCopy)).toHaveCount(0);
});

test("keeps compatibility aliases intentional", async ({ request }) => {
  const mediaResponse = await request.get("/app/media/00000000-0000-4000-8000-000000000040", { maxRedirects: 0 });
  expect(mediaResponse.headers().location ?? "").toMatch(/\/content\/00000000-0000-4000-8000-000000000040$/);

  const streamResponse = await request.get("/app/stream/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa10", { maxRedirects: 0 });
  expect(streamResponse.headers().location ?? "").toMatch(/\/live\/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa10$/);

  const eventResponse = await request.get("/events/00000000-0000-4000-8000-0000000000e1", { maxRedirects: 0 });
  expect(eventResponse.headers().location ?? "").toMatch(/\/event-access\/00000000-0000-4000-8000-0000000000e1$/);

  const mutualsResponse = await request.get("/mutuals/mutuals", { maxRedirects: 0 });
  expect(mutualsResponse.headers().location ?? "").toMatch(/\/mutuals$/);
});

test("serves the browser push service worker with internal click handling", async ({ page }) => {
  const response = await page.goto("/veel-sw.js");
  const source = await page.locator("body").innerText();

  expect(response?.ok()).toBe(true);
  expect(source).toContain('self.addEventListener("push"');
  expect(source).toContain('self.addEventListener("notificationclick"');
  expect(source).toContain("safeInternalPath");
});
