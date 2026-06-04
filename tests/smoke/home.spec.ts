import { expect, test } from "@playwright/test";

test("renders the app shell and Home media card", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("link", { name: "VEEL" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recommended" })).toBeVisible();
  await expect(page.getByText("Late-night set build")).toBeVisible();
  await expect(page.getByText("@maki")).toBeVisible();
  await expect(page.getByText("128 likes")).toBeVisible();
  await expect(page.locator("article img")).toBeVisible();
});

test("renders the content media viewer projection", async ({ page }) => {
  await page.goto("/content/00000000-0000-4000-8000-000000000040");

  await expect(page.getByRole("link", { name: "VEEL" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Media viewer" })).toBeVisible();
  await expect(page.getByText("Studio cut with a locked full playback state.")).toBeVisible();
  await expect(page.getByText("locked", { exact: true })).toBeVisible();
  await expect(page.getByText("not_ready")).toBeVisible();
});
