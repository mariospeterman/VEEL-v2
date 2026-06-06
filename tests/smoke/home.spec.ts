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
  await expect(page.getByText("Livepeer", { exact: true })).toBeVisible();
  await expect(page.getByText("pass_required")).toBeVisible();
});

test("renders the enter onboarding projection", async ({ page }) => {
  await page.goto("/enter");

  await expect(page.getByRole("link", { name: "VEEL" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Identity, wallet, then age gate." })).toBeVisible();
  await expect(page.getByText("Email or passkey")).toBeVisible();
  await expect(page.getByText("External Solana wallet")).toBeVisible();
  await expect(page.getByRole("link", { name: "Continue" })).toHaveAttribute("href", "/age");
});

test("renders the age assurance projection", async ({ page }) => {
  await page.goto("/age");

  await expect(page.getByRole("link", { name: "VEEL" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Provider-backed 18+ gate" })).toBeVisible();
  await expect(page.getByText("signature verified")).toBeVisible();
  await expect(page.getByText("normalized result only")).toBeVisible();
  await expect(page.getByText("server-owned")).toBeVisible();
});

test("renders the content media viewer projection", async ({ page }) => {
  await page.goto("/content/00000000-0000-4000-8000-000000000040");

  await expect(page.getByRole("link", { name: "VEEL" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Media viewer" })).toBeVisible();
  await expect(page.getByText("Studio cut with a locked full playback state.")).toBeVisible();
  await expect(page.getByText("locked", { exact: true })).toBeVisible();
  await expect(page.getByText("not_ready")).toBeVisible();
  await expect(page.getByRole("button", { name: "Like" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Report content" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Block creator" })).toBeVisible();
  await expect(page.getByText("Payment sheet")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open wallet" })).toHaveAttribute(
    "href",
    /solana:/
  );
});

test("renders the create upload workspace projection", async ({ page }) => {
  await page.goto("/create");

  await expect(page.getByRole("link", { name: "VEEL" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Upload workspace" })).toBeVisible();
  await expect(page.getByText("POST /v1/content")).toBeVisible();
  await expect(page.getByText("Bunny TUS session")).toBeVisible();
  await expect(page.getByText("safe session headers only")).toBeVisible();
  await expect(page.locator("span").getByText("explicit", { exact: true })).toBeVisible();
});

test("renders the discover projection", async ({ page }) => {
  await page.goto("/discover");

  await expect(page.getByRole("link", { name: "VEEL" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Search and explore" })).toBeVisible();
  await expect(page.getByText("Studio lighting test #studio")).toBeVisible();
  await expect(page.getByRole("link", { name: "#studio" })).toBeVisible();
  await expect(page.getByText("Studio meetup")).toBeVisible();
  await expect(page.getByText("Friday live studio")).toBeVisible();
  await expect(page.getByText("pass_required")).toBeVisible();
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

test("renders the wallet funding and primary-wallet projection", async ({ page }) => {
  await page.goto("/wallet");

  await expect(page.getByRole("link", { name: "VEEL" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Funding and receipts" })).toBeVisible();
  await expect(page.getByText("Primary wallet")).toBeVisible();
  await expect(page.getByText("backend settlement only")).toBeVisible();
  await expect(page.getByText("User-owned wallet funding")).toBeVisible();
  await expect(page.getByText("Funding sessions do not unlock")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open funding session" })).toHaveAttribute(
    "href",
    /pay\.coinbase\.com/
  );
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

test("renders the delegated subscription projection", async ({ page }) => {
  await page.goto("/subscriptions");

  await expect(page.getByRole("link", { name: "VEEL" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Auto-renewing access" })).toBeVisible();
  await expect(page.getByText("delegated_solana_subscription").first()).toBeVisible();
  await expect(page.getByText("staging_required").first()).toBeVisible();
  await expect(page.getByText("Manual Solana Pay renewal is reserved")).toBeVisible();
});

test("renders the settings projection", async ({ page }) => {
  await page.goto("/settings");

  await expect(page.getByRole("link", { name: "VEEL" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Account controls" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Security" })).toBeVisible();
  await expect(page.getByText("Supabase verified")).toBeVisible();
  await expect(page.getByText("privacy-safe only")).toBeVisible();
  await expect(page.getByText("server-owned").first()).toBeVisible();
});

test("redirects documented app route aliases", async ({ page }) => {
  await page.goto("/app/settings");
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("heading", { name: "Account controls" })).toBeVisible();

  await page.goto("/app/stream/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa10");
  await expect(page).toHaveURL(/\/live\/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa10$/);
  await expect(page.getByRole("heading", { name: "Live room" })).toBeVisible();

  await page.goto("/event-access/00000000-0000-4000-8000-0000000000e1");
  await expect(page).toHaveURL(/\/events\/00000000-0000-4000-8000-0000000000e1$/);
  await expect(page.getByRole("heading", { name: "Studio meetup" })).toBeVisible();

  await page.goto("/mutuals/mutuals");
  await expect(page).toHaveURL(/\/dating\/matches$/);
  await expect(page.getByRole("heading", { name: "Mutuals" })).toBeVisible();
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
  await expect(page.getByRole("heading", { name: "Compliance ledger", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "DAC7 and CARF reports", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "VAT and receipts", exact: true })).toBeVisible();
  await expect(page.getByText("content_unlock").first()).toBeVisible();
  await expect(page.getByText("event_access_pass").first()).toBeVisible();
  await expect(page.getByText("R-2026-0001")).toBeVisible();
  await expect(page.getByText("payment.settlement")).toBeVisible();
  await expect(page.locator("span").getByText("processed", { exact: true })).toBeVisible();
});

test("renders the Livepeer live room projection", async ({ page }) => {
  await page.goto("/live/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa10");

  await expect(page.getByRole("link", { name: "VEEL" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Live room" })).toBeVisible();
  await expect(page.getByText("Friday live studio")).toBeVisible();
  await expect(page.getByText("Livepeer").first()).toBeVisible();
  await expect(page.getByText("pass_required").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Pass options" })).toBeVisible();
  await expect(page.getByText("backend-confirmed live pass settlement")).toBeVisible();
});

test("renders the event ticket sheet projection", async ({ page }) => {
  await page.goto("/events/00000000-0000-4000-8000-0000000000e1");

  await expect(page.getByRole("link", { name: "VEEL" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Studio meetup" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Access pass sheet" })).toBeVisible();
  await expect(page.getByText("General admission")).toBeVisible();
  await expect(page.getByText("public_sale")).toBeVisible();
});

test("renders the user ticket QR projection", async ({ page }) => {
  await page.goto("/tickets");

  await expect(page.getByRole("link", { name: "VEEL" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "My passes" })).toBeVisible();
  await expect(page.getByText("QR token")).toBeVisible();
  await expect(page.getByText("veel_ticket_fixture")).toBeVisible();
  await expect(page.locator("span").getByText("active", { exact: true })).toBeVisible();
});

test("renders the Mutuals feed projection", async ({ page }) => {
  await page.goto("/dating");

  await expect(page.getByRole("link", { name: "VEEL" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Explicit Mutuals feed" })).toBeVisible();
  await expect(page.getByText("Mutuals safety")).toBeVisible();
  await expect(page.getByText("Mutuals profile card")).toBeVisible();
  await expect(page.getByRole("button", { name: "Not interested" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Yes" })).toBeVisible();
});

test("renders the Mutuals list projection", async ({ page }) => {
  await page.goto("/dating/matches");

  await expect(page.getByRole("link", { name: "VEEL" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Mutuals" })).toBeVisible();
  await expect(page.getByText("Mutual match")).toBeVisible();
  await expect(page.locator("span").getByText("active", { exact: true })).toBeVisible();
});

test("renders the scoped assistant projection", async ({ page }) => {
  await page.goto("/assistant");

  await expect(page.getByRole("link", { name: "VEEL" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Scoped assistant" })).toBeVisible();
  await expect(page.getByText("creator_helper")).toBeVisible();
  await expect(page.getByText("draft_caption").first()).toBeVisible();
  await expect(page.getByText("prepare_refund_decision", { exact: true })).toBeVisible();
  await expect(page.getByText("required for admin actions")).toBeVisible();
});
