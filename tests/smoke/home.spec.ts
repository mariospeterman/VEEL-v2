import { expect, test } from "@playwright/test";

const unavailableStatus = /HTTP (401|429|503)/;
const unavailableReason = /API is unavailable|Missing or invalid bearer token|Rate limit exceeded/;
const profileFallbackStatus = /HTTP (401|404|429|503)/;
const profileFallbackReason =
  /API is unavailable|Missing or invalid bearer token|Profile was not found|Rate limit exceeded/;

test("renders the app shell and Home media card", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("link", { name: "VEEL" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recommended" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Home feed unavailable" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Live rail unavailable" })).toBeVisible();
  await expect(page.getByText(unavailableStatus).first()).toBeVisible();
  await expect(page.getByText(unavailableReason).first()).toBeVisible();
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
  await expect(page.getByRole("heading", { name: "Age status unavailable" })).toBeVisible();
  await expect(page.getByText(unavailableStatus).first()).toBeVisible();
  await expect(page.getByText(unavailableReason).first()).toBeVisible();
  await expect(page.getByText("signature verified")).toBeVisible();
  await expect(page.getByText("normalized result only")).toBeVisible();
  await expect(page.getByText("Session launch URLs are created by the backend")).toBeVisible();
});

test("renders the content media viewer projection", async ({ page }) => {
  await page.goto("/content/00000000-0000-4000-8000-000000000040");

  await expect(page.getByRole("link", { name: "VEEL" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Content unavailable" })).toBeVisible();
  await expect(page.getByText(unavailableStatus)).toBeVisible();
  await expect(page.getByText(unavailableReason)).toBeVisible();
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
  await expect(page.getByRole("heading", { name: "Discover unavailable" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Discover sidebars unavailable" })).toBeVisible();
  await expect(page.getByText(unavailableStatus).first()).toBeVisible();
  await expect(page.getByText(unavailableReason).first()).toBeVisible();
});

test("renders the messages and paid-message projection", async ({ page }) => {
  await page.goto("/messages");

  await expect(page.getByRole("link", { name: "VEEL" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Messages unavailable" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Conversation unavailable" })).toBeVisible();
  await expect(page.getByText(unavailableStatus).first()).toBeVisible();
  await expect(page.getByText(unavailableReason).first()).toBeVisible();
});

test("renders the activity and wallet transaction projection", async ({ page }) => {
  await page.goto("/activity");

  await expect(page.getByRole("link", { name: "VEEL" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Payments" })).toBeVisible();
  await expect(page.getByText("Wallet transactions", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Payment activity unavailable" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Wallet transactions unavailable" })).toBeVisible();
  await expect(page.getByText(unavailableStatus).first()).toBeVisible();
  await expect(page.getByText(unavailableReason).first()).toBeVisible();
});

test("renders the wallet funding and primary-wallet projection", async ({ page }) => {
  await page.goto("/wallet");

  await expect(page.getByRole("link", { name: "VEEL" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Funding and receipts" })).toBeVisible();
  await expect(page.getByText("User-owned wallet funding")).toBeVisible();
  await expect(page.getByText("Funding sessions do not unlock")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Wallets unavailable" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Wallet transactions unavailable" })).toBeVisible();
  await expect(page.getByText(unavailableStatus).first()).toBeVisible();
  await expect(page.getByText(unavailableReason).first()).toBeVisible();
});

test("renders the creator dashboard projection", async ({ page }) => {
  await page.goto("/profile");

  await expect(page.getByRole("link", { name: "VEEL" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Creator dashboard unavailable" })).toBeVisible();
  await expect(page.getByText(unavailableStatus)).toBeVisible();
  await expect(page.getByText(unavailableReason)).toBeVisible();
});

test("renders the delegated subscription projection", async ({ page }) => {
  await page.goto("/subscriptions");

  await expect(page.getByRole("link", { name: "VEEL" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Auto-renewing access" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Subscription plans unavailable" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Subscriptions unavailable" })).toBeVisible();
  await expect(page.getByText(unavailableStatus).first()).toBeVisible();
  await expect(page.getByText(unavailableReason).first()).toBeVisible();
  await expect(page.getByText("Manual Solana Pay renewal is reserved")).toBeVisible();
});

test("renders the Studio organization dashboard projection", async ({ page }) => {
  await page.goto("/studio");

  await expect(page.getByRole("link", { name: "VEEL" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Organization dashboards" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Studio API unavailable" })).toBeVisible();
  await expect(page.getByText(unavailableStatus)).toBeVisible();
  await expect(page.getByText(unavailableReason)).toBeVisible();
  await expect(page.getByText("payout queues")).toBeVisible();
});

test("renders the settings projection", async ({ page }) => {
  await page.goto("/settings");

  await expect(page.getByRole("link", { name: "VEEL" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Account controls" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Security" })).toBeVisible();
  await expect(page.getByText("Settings API unavailable").first()).toBeVisible();
  await expect(page.getByText(unavailableStatus).first()).toBeVisible();
  await expect(page.getByText("privacy-safe only")).toBeVisible();
  await expect(page.getByText("Browser push", { exact: true })).toBeVisible();
  await expect(page.getByText("server-owned").first()).toBeVisible();
});

test("redirects documented app route aliases", async ({ page }) => {
  await page.goto("/app/settings");
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("heading", { name: "Account controls" })).toBeVisible();

  await page.goto("/app/studio");
  await expect(page).toHaveURL(/\/studio$/);
  await expect(page.getByRole("heading", { name: "Organization dashboards" })).toBeVisible();

  await page.goto("/app/stream/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa10");
  await expect(page).toHaveURL(/\/live\/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa10$/);
  await expect(page.getByRole("heading", { name: "Live room" })).toBeVisible();

  await page.goto("/event-access/00000000-0000-4000-8000-0000000000e1");
  await expect(page).toHaveURL(/\/event-access\/00000000-0000-4000-8000-0000000000e1$/);
  await expect(page.getByRole("heading", { name: "Event unavailable" })).toBeVisible();

  await page.goto("/events/00000000-0000-4000-8000-0000000000e1");
  await expect(page).toHaveURL(/\/event-access\/00000000-0000-4000-8000-0000000000e1$/);
  await expect(page.getByRole("heading", { name: "Event unavailable" })).toBeVisible();

  await page.goto("/mutuals/mutuals");
  await expect(page).toHaveURL(/\/mutuals$/);
  await expect(page.getByRole("heading", { name: "Mutuals", exact: true })).toBeVisible();

  await page.goto("/dating/matches");
  await expect(page).toHaveURL(/\/mutuals$/);
  await expect(page.getByRole("heading", { name: "Mutuals", exact: true })).toBeVisible();
});

test("renders the public creator profile projection", async ({ page }) => {
  await page.goto("/profile/maki");

  await expect(page.getByRole("link", { name: "VEEL" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Creator profile (not found|unavailable)/ })).toBeVisible();
  await expect(page.getByText(profileFallbackStatus)).toBeVisible();
  await expect(page.getByText(profileFallbackReason)).toBeVisible();
});

test("renders the admin payment unlock and provider ops projection", async ({ page }) => {
  await page.goto("/admin");

  await expect(page.getByRole("link", { name: "VEEL" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Payments and unlocks" })).toBeVisible();
  await expect(page.getByText("Admin ops")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Payments", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Unlocks", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Users content and reports", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Notification health", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Provider events", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Compliance ledger", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "DAC7 and CARF reports", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Organizations and KYB", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Support policy", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Refunds and disputes", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Data requests", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Audit log", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Feature flags", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "VAT and receipts", exact: true })).toBeVisible();
  await expect(page.getByText("Admin API unavailable").first()).toBeVisible();
  await expect(page.getByText(unavailableStatus).first()).toBeVisible();
  await expect(page.getByText(unavailableReason).first()).toBeVisible();
});

test("renders the Livepeer live room projection", async ({ page }) => {
  await page.goto("/live/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa10");

  await expect(page.getByRole("link", { name: "VEEL" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Live room unavailable" })).toBeVisible();
  await expect(page.getByText(unavailableStatus)).toBeVisible();
  await expect(page.getByText(unavailableReason)).toBeVisible();
});

test("renders the Event Access sheet projection", async ({ page }) => {
  await page.goto("/event-access/00000000-0000-4000-8000-0000000000e1");

  await expect(page.getByRole("link", { name: "VEEL" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Event unavailable" })).toBeVisible();
  await expect(page.getByText(unavailableStatus)).toBeVisible();
  await expect(page.getByText(unavailableReason)).toBeVisible();
});

test("renders the user Event Access pass projection", async ({ page }) => {
  await page.goto("/passes");

  await expect(page.getByRole("link", { name: "VEEL" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "My passes" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Passes unavailable" })).toBeVisible();
  await expect(page.getByText(unavailableStatus)).toBeVisible();
  await expect(page.getByText(unavailableReason)).toBeVisible();
});

test("renders the Mutuals feed projection", async ({ page }) => {
  await page.goto("/mutuals/feed");

  await expect(page.getByRole("link", { name: "VEEL" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Explicit Mutuals feed" })).toBeVisible();
  await expect(page.getByText("Mutuals safety")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Mutuals feed unavailable" })).toBeVisible();
  await expect(page.getByText(unavailableStatus)).toBeVisible();
  await expect(page.getByText(unavailableReason)).toBeVisible();
  await expect(page.getByText("explicit opt-in required")).toBeVisible();
});

test("renders the Mutuals list projection", async ({ page }) => {
  await page.goto("/mutuals");

  await expect(page.getByRole("link", { name: "VEEL" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Mutuals", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Mutuals unavailable" })).toBeVisible();
  await expect(page.getByText(unavailableStatus)).toBeVisible();
  await expect(page.getByText(unavailableReason)).toBeVisible();
});

test("renders the scoped assistant projection", async ({ page }) => {
  await page.goto("/assistant");

  await expect(page.getByRole("link", { name: "VEEL" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Scoped assistant" })).toBeVisible();
  await expect(page.getByText("Assistant API unavailable")).toBeVisible();
  await expect(page.getByText(unavailableStatus).first()).toBeVisible();
  await expect(page.getByText("explicit start only").first()).toBeVisible();
  await expect(page.getByText("required for admin actions")).toBeVisible();
});
