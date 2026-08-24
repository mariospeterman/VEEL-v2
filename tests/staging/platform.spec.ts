import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("serves the immutable public product without a mock runtime", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Create without asking the algorithm for permission." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue to WeVid" }).first()).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/mock api|e2e auth|fixture token/i);

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical")).toEqual([]);
});

test("serves API health and database readiness", async ({ request }) => {
  const apiUrl = process.env.API_URL;
  expect(apiUrl, "API_URL is required").toBeTruthy();
  const health = await request.get(new URL("/healthz", apiUrl).toString());
  expect(health.ok()).toBe(true);
  const readiness = await request.get(new URL("/readyz", apiUrl).toString());
  expect(readiness.ok()).toBe(true);
});

test("opens the protected shell through a real canonical session", async ({ context, page }) => {
  const rawCookie = process.env.STAGING_SESSION_COOKIE;
  test.skip(!rawCookie, "Operator checkpoint: STAGING_SESSION_COOKIE is not configured");
  const separator = rawCookie.indexOf("=");
  expect(separator).toBeGreaterThan(0);
  const appUrl = new URL(process.env.WEB_URL);
  await context.addCookies([{
    name: rawCookie.slice(0, separator),
    value: rawCookie.slice(separator + 1),
    domain: appUrl.hostname,
    path: "/",
    httpOnly: true,
    secure: appUrl.protocol === "https:",
    sameSite: "Lax"
  }]);
  await page.goto("/app/home", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("link", { name: "WeVid app home" }).first()).toBeVisible();
  await expect(page).toHaveURL(/\/app\/home/);
});
