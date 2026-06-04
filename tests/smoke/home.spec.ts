import { expect, test } from "@playwright/test";

test("renders the app shell and Home media card", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("link", { name: "VEEL" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recommended" })).toBeVisible();
  await expect(page.getByText("Late-night set build")).toBeVisible();
  await expect(page.locator("article").first().getByText("@maki")).toBeVisible();
  await expect(page.getByText("128 likes")).toBeVisible();
  await expect(page.locator("article img")).toBeVisible();
  await expect(page.getByText("Friday live studio")).toBeVisible();
  await expect(page.getByText("Livepeer")).toBeVisible();
  await expect(page.getByText("pass_required")).toBeVisible();
});

test("renders the content media viewer projection", async ({ page }) => {
  await page.goto("/content/00000000-0000-4000-8000-000000000040");

  await expect(page.getByRole("link", { name: "VEEL" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Media viewer" })).toBeVisible();
  await expect(page.getByText("Studio cut with a locked full playback state.")).toBeVisible();
  await expect(page.getByText("locked", { exact: true })).toBeVisible();
  await expect(page.getByText("not_ready")).toBeVisible();
  await expect(page.getByText("Payment sheet")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open wallet" })).toHaveAttribute(
    "href",
    /solana:/
  );
});

test("renders the messages and paid-message projection", async ({ page }) => {
  await page.goto("/messages");

  await expect(page.getByRole("link", { name: "VEEL" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();
  await expect(page.getByText("Visible message")).toBeVisible();
  await expect(page.getByText("Paid hello", { exact: true })).toBeVisible();
  await expect(page.getByText("pending_payment")).toBeVisible();
});

test("renders the activity and wallet transaction projection", async ({ page }) => {
  await page.goto("/activity");

  await expect(page.getByRole("link", { name: "VEEL" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Payments" })).toBeVisible();
  await expect(page.getByText("Wallet transactions")).toBeVisible();
  await expect(page.getByText("payment_intent").first()).toBeVisible();
  await expect(page.getByText("solana_devnet")).toBeVisible();
  await expect(page.getByText("confirmed").first()).toBeVisible();
});

test("renders the creator dashboard projection", async ({ page }) => {
  await page.goto("/profile");

  await expect(page.getByRole("link", { name: "VEEL" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Maki" })).toBeVisible();
  await expect(page.getByText("Creator dashboard")).toBeVisible();
  await expect(page.getByText("Monetisation readiness")).toBeVisible();
  await expect(page.getByText("creator_subscription")).toBeVisible();
  await expect(page.getByText("earnings_recipient_wallet_required")).toBeVisible();
});

test("renders the public creator profile projection", async ({ page }) => {
  await page.goto("/profile/maki");

  await expect(page.getByRole("link", { name: "VEEL" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Maki" })).toBeVisible();
  await expect(page.getByText("Creator profile", { exact: true })).toBeVisible();
  await expect(page.getByText("Building the first Veel v2 creator profile")).toBeVisible();
  await expect(page.getByText("Studio lighting test")).toBeVisible();
  await expect(page.locator("article img")).toBeVisible();
});

test("renders the admin payment unlock and provider ops projection", async ({ page }) => {
  await page.goto("/admin");

  await expect(page.getByRole("link", { name: "VEEL" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Payments and unlocks" })).toBeVisible();
  await expect(page.getByText("Admin ops")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Payments", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Unlocks", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Provider events", exact: true })).toBeVisible();
  await expect(page.getByText("content_unlock").first()).toBeVisible();
  await expect(page.getByText("payment.settlement")).toBeVisible();
  await expect(page.locator("span").getByText("processed", { exact: true })).toBeVisible();
});

test("renders the event ticket sheet projection", async ({ page }) => {
  await page.goto("/events/00000000-0000-4000-8000-0000000000e1");

  await expect(page.getByRole("link", { name: "VEEL" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Studio meetup" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ticket sheet" })).toBeVisible();
  await expect(page.getByText("General admission")).toBeVisible();
  await expect(page.getByText("public_sale")).toBeVisible();
});

test("renders the user ticket QR projection", async ({ page }) => {
  await page.goto("/tickets");

  await expect(page.getByRole("link", { name: "VEEL" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "My tickets" })).toBeVisible();
  await expect(page.getByText("QR token")).toBeVisible();
  await expect(page.getByText("veel_ticket_fixture")).toBeVisible();
  await expect(page.locator("span").getByText("active", { exact: true })).toBeVisible();
});
