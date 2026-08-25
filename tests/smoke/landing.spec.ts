import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("landing tells one honest creator story and keeps one Continue entry", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: "Stop building on rented ground." })).toBeVisible();
  await expect(page.getByText("The rented creator economy")).toBeVisible();
  await expect(page.getByText("10%", { exact: true })).toBeVisible();
  await expect(page.getByText("pay-to-rank mechanics", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Real interest requires both sides." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "From media to the door." })).toBeVisible();
  await expect(page.getByText("Product Offers · planned rollout")).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/53% of surveyed creators|1M\+|150\+ countries|99\.9%/i);

  await page.getByRole("button", { name: "Continue to WeVid" }).first().click();
  await expect(page.getByRole("dialog", { name: "Continue to WeVid." })).toBeVisible();
  await expect(page.getByText(/authenticate first.*choose whether to start onboarding/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "Use an existing wallet" })).toBeEnabled();
});

test("landing stays semantic, keyboard reachable, and free of horizontal overflow", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator("h1")).toHaveCount(1);
  const viewport = page.viewportSize();
  if (viewport && viewport.width <= 1040) {
    await expect(page.getByRole("button", { name: "Open navigation" })).toBeVisible();
  } else {
    await expect(page.getByRole("navigation", { name: "Landing navigation" })).toBeVisible();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical")).toEqual([]);
});

test("landing respects reduced motion and exposes crawlable release metadata", async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".landing-hero-media img")).toBeVisible();
  await expect(page.locator(".landing-hero-media img")).toHaveCSS("animation-name", "none");
  await expect(page.locator(".landing-hero-video")).toHaveCount(0);
  const structuredData = await page.locator('script[type="application/ld+json"]').textContent();
  expect(structuredData).toContain("SoftwareApplication");

  const robots = await request.get("/robots.txt");
  expect(robots.ok()).toBe(true);
  expect(await robots.text()).toContain("Sitemap:");
  const sitemap = await request.get("/sitemap.xml");
  expect(sitemap.ok()).toBe(true);
  expect(await sitemap.text()).toContain("/legal/privacy");
});
