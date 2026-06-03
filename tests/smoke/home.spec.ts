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
