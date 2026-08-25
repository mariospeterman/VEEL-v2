import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

const e2eToken = "veel-e2e-token";
const e2eOrigin = new URL(process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000").origin;
const contentId = "00000000-0000-4000-8000-000000000040";
const draftContentId = "00000000-0000-4000-8000-000000000041";
const mediaAssetId = "00000000-0000-4000-8000-000000000042";
const imageDraftContentId = "00000000-0000-4000-8000-000000000043";
const imageMediaAssetId = "00000000-0000-4000-8000-000000000044";
const textContentId = "00000000-0000-4000-8000-000000000045";
const pollContentId = "00000000-0000-4000-8000-000000000046";
const pollOptionIds = [
  "00000000-0000-4000-8000-000000000047",
  "00000000-0000-4000-8000-000000000048"
] as const;
const paymentIntentId = "00000000-0000-4000-8000-000000000050";

let apiServer: Server;
const requests: Array<{ method: string; path: string; authorization: string | undefined; idempotencyKey: string | undefined }> = [];

test.beforeAll(async () => {
  apiServer = createServer(async (request, response) => {
    try {
      await handleApiRequest(request, response);
    } catch (error) {
      setCorsHeaders(response);
      sendJson(response, 500, { message: error instanceof Error ? error.message : "Mock API error" });
    }
  });

  await new Promise<void>((resolve) => {
    apiServer.listen(4000, "127.0.0.1", resolve);
  });
});

test.afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    apiServer.close((error) => (error ? reject(error) : resolve()));
  });
});

test.beforeEach(async ({ context }) => {
  requests.length = 0;
  await context.addCookies([
    {
      name: "veel_e2e_access_token",
      value: e2eToken,
      url: e2eOrigin,
      httpOnly: false,
      sameSite: "Lax"
    }
  ]);
});

test("covers authenticated earnings setup, creation, and one-time checkout", async ({ page }) => {
  test.setTimeout(150_000);

  await gotoUntilVisible(page, "/app/home", () => page.getByRole("link", { name: "WeVid app home" }).first());
  await expect(page.getByRole("article", { name: "Post by Aria Moon" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "For you" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("link", { name: "Open post" })).toBeVisible();

  await page.goto("/app/studio");
  await expect(page.getByRole("heading", { name: "Studio", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your media" })).toBeVisible();
  await expect(page.getByText("Please confirm the music rights.")).toBeVisible();
  await expect(page.getByRole("region", { name: "Media provenance review" })).toBeVisible();
  await expect(page.getByText("image · AI-generated")).toBeVisible();
  const provenanceReview = page.waitForRequest((request) =>
    request.method() === "POST" &&
    new URL(request.url()).pathname === `/v1/media/assets/${imageMediaAssetId}/provenance-review`
  );
  await page.getByRole("button", { name: "Confirm label" }).click();
  const provenanceRequest = await provenanceReview;
  expect(provenanceRequest.postDataJSON()).toEqual({ expectedCompositionRevision: 4, decision: "confirmed" });
  await expect(page.getByText("Provenance label confirmed.")).toBeVisible();
  await page.getByRole("button", { name: "Load more media" }).click();
  await expect(page.getByText("Older published post")).toBeVisible();
  await page.getByRole("button", { name: "Appeal decision" }).click();
  await page.getByLabel("Why should this be reviewed again?").fill("I own the recording and the music license.");
  await page.getByRole("button", { name: "Send appeal" }).click();
  await expect(page.getByText("appeal pending")).toBeVisible();
  await expect(page.getByText("Creator readiness").locator("..")).toContainText("92%");

  await page.goto("/app/profile/earnings");
  await expect(page.getByRole("heading", { name: "Enable earnings" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Creator analytics" })).toBeVisible();
  await expect(page.getByLabel("Recipient wallet")).toHaveValue(wallet().id);
  await expect(page.getByRole("checkbox", { name: /Support/ })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: /Content unlocks/ })).toBeChecked();
  await page.getByRole("checkbox", { name: /Creator Earnings Terms/ }).check();
  await page.getByRole("button", { name: "Update earnings" }).click();
  await expect(page.getByText("Earnings are enabled.")).toBeVisible();

  await page.goto("/app/wallet");
  await expect(page.getByRole("heading", { name: "Funding and receipts" })).toBeVisible();
  await expect(page.getByText("Primary wallet", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Access after confirmation")).toBeVisible();
  await expect(page.getByText("Funding alone does not unlock")).toBeVisible();

  await page.goto("/age");
  await expect(page.getByRole("heading", { name: "Confirm you're 18+" })).toBeVisible();
  await expect(page.getByText("Current status")).toBeVisible();
  await expect(page.getByText("verified", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start age verification" })).toBeEnabled();

  await page.goto("/app/home");
  await expect(page.getByRole("article", { name: "Post by Aria Moon" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open post" })).toBeVisible();

  await page.goto("/app/create");
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { name: "Create", exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Go live/ }).click();
  await expect(page.getByRole("heading", { name: "Start with OBS" })).toBeVisible();
  await page.getByRole("button", { name: /Photos or video/ }).click();
  await expect(page.getByRole("heading", { name: "Add photos or videos" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.cookie.includes("veel_e2e_access_token="))).toBe(true);

  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles({
    name: "studio-session.mp4",
    mimeType: "video/mp4",
    buffer: Buffer.from("mock-video")
  });
  await expect(page.locator("video")).toBeVisible();
  await page.getByLabel("Content rating").selectOption("adult");
  await page.getByLabel("Caption").fill("Behind the scenes from today's studio shoot.");
  await page.getByLabel(/every identifiable person is 18\+ and consented/).check();
  await page.reload();
  await page.getByRole("button", { name: /Photos or video/ }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: "studio-session.mp4",
    mimeType: "video/mp4",
    buffer: Buffer.from("mock-video")
  });
  await expect(page.getByLabel("Caption")).toHaveValue("Behind the scenes from today's studio shoot.");
  await expect(page.getByLabel("Content rating")).toHaveValue("adult");
  await expect(page.getByLabel(/every identifiable person is 18\+ and consented/)).not.toBeChecked();
  await page.getByLabel("Description").fill("Studio video preview");
  await page.getByLabel(/every identifiable person is 18\+ and consented/).check();
  await page.getByRole("button", { name: "Upload media" }).click();
  await expect(page.getByText("Stored privately", { exact: true })).toBeVisible({ timeout: 15_000 });
  await page.getByLabel("Content rating").selectOption("explicit");
  await expect(page.getByLabel(/every identifiable person is 18\+ and consented/)).not.toBeChecked();
  await page.getByLabel(/every identifiable person is 18\+ and consented/).check();
  const metadataUpdate = page.waitForRequest((request) =>
    request.method() === "PATCH" &&
    new URL(request.url()).pathname === `/v1/content/${draftContentId}` &&
    request.postDataJSON()?.nsfwLabel === "explicit"
  );
  await page.getByRole("button", { name: "Review and submit" }).click();
  await metadataUpdate;
  await expect(page.getByRole("button", { name: "Submitted for review" })).toBeVisible();
  await expect(page.getByText(/Bunny|TUS|provider/i)).toHaveCount(0);
  const createLayout = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
  }));
  expect(createLayout.scrollWidth).toBe(createLayout.clientWidth);

  await page.goto(`/content/${contentId}`);
  await expect(page.getByRole("heading", { name: "Aria Moon’s post" })).toBeVisible();
  await expect(page.getByText("Locked media")).toBeVisible();
  await page.getByRole("button", { name: "Unlock content" }).click();
  await expect(page.getByText("The wallet approval is not payment proof.")).toBeVisible();
  await expect(page.getByText("25 SOL", { exact: true })).toBeVisible();
  await expect(page.getByText("21.25 SOL", { exact: true })).toBeVisible();
  await page.getByLabel(/I accept the checkout terms/).check();
  await page.getByLabel(/I request immediate digital access/).check();
  await page.getByRole("button", { name: "Continue to wallet" }).click();
  await expect(page.getByText("Scan the QR code or open the wallet request.")).toBeVisible();
  await expect(page.getByRole("img", { name: "Wallet checkout QR code" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open wallet" })).toHaveAttribute(
    "href",
    "solana:https://wallet.example.test/request/content-unlock"
  );

  await page.goto("/app/activity");
  await expect(page.getByRole("heading", { name: "Payments" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your last 30 days" })).toBeVisible();
  await expect(page.getByText("VEEL-0000000000004000")).toBeVisible();
  await expect(page.getByText("Sent", { exact: true })).toHaveCount(2);
  await expect(page.getByText("ended after access")).toBeVisible();
  await expect(page.getByRole("button", { name: "Open review" })).toBeVisible();

  const protectedRequests = requests.filter((request) =>
    request.path.startsWith("/v1/") && request.path !== "/v1/telemetry/web-vitals"
  );
  expect(protectedRequests.every((request) => request.authorization === `Bearer ${e2eToken}`)).toBe(true);
  expect(requests.some((request) => request.method === "POST" && request.path === "/v1/content" && request.idempotencyKey)).toBe(true);
  expect(requests.some((request) => request.method === "POST" && request.path === `/v1/content/${contentId}/unlock-intents` && request.idempotencyKey)).toBe(true);
  expect(requests.some((request) => request.method === "POST" && request.path === `/v1/payments/intents/${paymentIntentId}/consent` && request.idempotencyKey)).toBe(true);
  expect(requests.some((request) => request.method === "PATCH" && request.path === "/v1/profiles/me/creator-onboarding" && request.idempotencyKey)).toBe(true);
  expect(requests.some((request) => request.method === "GET" && request.path === "/v1/activity/payments")).toBe(true);

  await page.goto("/app/profile");
  await page.locator("summary").filter({ hasText: "Account menu" }).click();
  await page.getByRole("button", { name: "Log out" }).click();
  await page.waitForURL(/\/$/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Create without asking the algorithm for permission." })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.cookie.includes("veel_e2e_access_token="))).toBe(false);
});

test("creates text and poll posts through the canonical composer", async ({ page }) => {
  await gotoUntilVisible(page, "/app/create", () => page.getByRole("heading", { name: "Create", exact: true }));

  await expect(page.getByRole("button", { name: /Photos or video/ })).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: /Write something/ }).click();
  await expect(page.getByRole("button", { name: /Write something/ })).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("Your post").fill("A text post owned by the canonical content API.");
  await page.getByLabel("Who can see it after approval?").selectOption("followers");
  await page.getByLabel(/I have the right to share this post/).check();
  const textCreate = page.waitForRequest((request) => {
    if (request.method() !== "POST" || new URL(request.url()).pathname !== "/v1/content") return false;
    const body = request.postDataJSON();
    return body?.mediaType === "text" && body?.bodyText === "A text post owned by the canonical content API.";
  });
  await page.getByRole("button", { name: "Submit for review" }).click();
  await textCreate;
  await expect(page.getByRole("heading", { name: "Submitted for review" })).toBeVisible();

  await gotoUntilVisible(page, "/app/create", () => page.getByRole("heading", { name: "Create", exact: true }));
  await page.getByRole("button", { name: /^Poll/ }).click();
  await page.getByLabel("Question").fill("Which format should come next?");
  await page.locator("#poll-option-0").fill("Photo");
  await page.locator("#poll-option-1").fill("Carousel");
  await page.getByRole("button", { name: "Add choice" }).click();
  await page.locator("#poll-option-2").fill("Long-form video");
  await page.getByLabel(/I have the right to share this post/).check();
  const pollCreate = page.waitForRequest((request) => {
    if (request.method() !== "POST" || new URL(request.url()).pathname !== "/v1/content") return false;
    const body = request.postDataJSON();
    return body?.mediaType === "poll" &&
      body?.poll?.question === "Which format should come next?" &&
      JSON.stringify(body?.poll?.options) === JSON.stringify(["Photo", "Carousel", "Long-form video"]);
  });
  await page.getByRole("button", { name: "Submit for review" }).click();
  await pollCreate;
  await expect(page.getByRole("heading", { name: "Submitted for review" })).toBeVisible();
});

test("builds an accessible private photo draft and explains its fail-closed review gate", async ({ page }) => {
  await gotoUntilVisible(page, "/app/create", () => page.getByRole("heading", { name: "Create", exact: true }));
  await page.getByRole("button", { name: /Photos or video/ }).click();
  await expect(page.getByRole("heading", { name: "Add photos or videos" })).toBeVisible();

  await page.locator('input[type="file"]').setInputFiles({
    name: "sanitized-fixture.png",
    mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64")
  });
  await page.getByLabel("Description").fill("A small red test image");
  await page.getByLabel("Caption").fill("A private photo draft");
  await page.getByLabel(/I have the right to share this media/).check();

  const imageUpload = page.waitForRequest((request) =>
    request.method() === "POST" &&
    new URL(request.url()).pathname === `/v1/content/${imageDraftContentId}/image-assets` &&
    request.headers()["content-type"] === "image/png"
  );
  const assetUpdate = page.waitForRequest((request) =>
    request.method() === "PATCH" &&
    new URL(request.url()).pathname === `/v1/media/assets/${imageMediaAssetId}` &&
    request.postDataJSON()?.altText === "A small red test image"
  );
  await page.getByRole("button", { name: "Upload media" }).click();
  await imageUpload;
  await assetUpdate;
  await expect(page.getByText("Stored privately", { exact: true })).toBeVisible();
  await expect(page.getByText(/Publication stays blocked until/)).toBeVisible();
  await page.getByRole("button", { name: "Review and submit" }).click();
  await expect(page.getByText("Photos are still completing safety review", { exact: true })).toBeVisible();
  const assetRemoval = page.waitForRequest((request) =>
    request.method() === "DELETE" &&
    new URL(request.url()).pathname === `/v1/media/assets/${imageMediaAssetId}` &&
    request.postDataJSON()?.reason === "creator_removed"
  );
  await page.getByRole("button", { name: "Remove" }).click();
  await assetRemoval;
  await expect(page.getByText("Media removed.", { exact: true })).toBeVisible();
  await expect(page.getByText("Stored privately", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/BUNNY_STORAGE|provider_asset|stored_private/i)).toHaveCount(0);
});

test("creates one ordered mixed-media carousel without a second format chooser", async ({ page }) => {
  await gotoUntilVisible(page, "/app/create", () => page.getByRole("heading", { name: "Create", exact: true }));
  await page.getByRole("button", { name: /Photos or video/ }).click();
  await expect(page.getByRole("heading", { name: "Add photos or videos" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Photos One image/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Video Resumable/ })).toHaveCount(0);

  await page.locator('input[type="file"]').setInputFiles([
    {
      name: "mixed-photo.png",
      mimeType: "image/png",
      buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64")
    },
    { name: "mixed-video.mp4", mimeType: "video/mp4", buffer: Buffer.from("mock-video") }
  ]);
  await expect(page.getByText("Photo 1", { exact: true })).toBeVisible();
  await expect(page.getByText("Video 2", { exact: true })).toBeVisible();
  await page.getByLabel("Description").nth(0).fill("A red test image");
  await page.getByLabel("Description").nth(1).fill("A studio test video");
  await page.getByLabel(/I have the right to share this media/).check();

  const carouselCreate = page.waitForRequest((request) =>
    request.method() === "POST" &&
    new URL(request.url()).pathname === "/v1/content" &&
    request.postDataJSON()?.mediaType === "carousel"
  );
  const imageUpload = page.waitForRequest((request) =>
    request.method() === "POST" &&
    new URL(request.url()).pathname === `/v1/content/${imageDraftContentId}/image-assets`
  );
  const videoUpload = page.waitForRequest((request) =>
    request.method() === "POST" && new URL(request.url()).pathname === "/v1/media/uploads"
  );
  await page.getByRole("button", { name: "Upload media" }).click();
  await Promise.all([carouselCreate, imageUpload, videoUpload]);
  await expect(page.getByText("Stored privately", { exact: true })).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Review and submit" })).toBeEnabled();
});

test("renders canonical text and poll posts and accepts backend-confirmed votes", async ({ page }) => {
  await page.goto(`/content/${textContentId}`);
  await expect(page.getByText("A structured text post with a real consumer renderer.")).toBeVisible();

  await page.goto(`/content/${pollContentId}`);
  await expect(page.getByRole("heading", { name: "What should we publish next?" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Photo/ })).toHaveAttribute("aria-pressed", "false");

  const confirmedVote = page.waitForRequest((request) =>
    request.method() === "POST" &&
    new URL(request.url()).pathname === `/v1/content/${pollContentId}/poll-votes` &&
    request.postDataJSON()?.optionId === pollOptionIds[1]
  );
  await page.getByRole("button", { name: /Carousel/ }).click();
  await confirmedVote;
  await expect(page.getByRole("button", { name: /Carousel/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("1 vote", { exact: true })).toBeVisible();

  await page.goto("/profile/ariamoon");
  await expect(page.getByRole("heading", { name: "Aria Moon" })).toBeVisible();
  await expect(page.getByText("A structured text post with a real consumer renderer.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "What should we publish next?" })).toBeVisible();
});

test("shows and updates audited payment commercial policy overrides", async ({ page }) => {
  await page.goto("/admin/analytics", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: "Analytics projection health" })).toBeVisible();
  await expect(page.getByText("matched", { exact: true })).toBeVisible();

  const analyticsForm = page.getByRole("button", { name: "Queue projection job" }).locator("..");
  await analyticsForm.getByLabel("Start date").fill("2026-08-01");
  await analyticsForm.getByLabel("End date").fill("2026-08-07");
  await analyticsForm.getByLabel("Audit reason").fill("Rebuild bounded analytics facts");
  await analyticsForm.getByRole("button", { name: "Queue projection job" }).click();
  await expect.poll(() => requests.some((request) =>
    request.method === "POST" &&
    request.path === "/v1/admin/analytics/jobs" &&
    Boolean(request.idempotencyKey)
  )).toBe(true);

  await page.goto("/admin/payments", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: "Payments and unlocks" })).toBeVisible();
  await expect(page.getByText("Overrides apply only to new quotes.")).toBeVisible();
  await expect(page.getByText("support · SOL")).toBeVisible();
  await expect(page.getByText("Revision 3")).toBeVisible();

  const policyForm = page.getByRole("button", { name: "Save policy" }).locator("..");
  await policyForm.getByLabel("Minimum atomic amount").fill("2000000");
  await policyForm.getByLabel("Audit reason").fill("Raise the support floor after finance review");
  await policyForm.getByRole("button", { name: "Save policy" }).click();

  await expect.poll(() => requests.some((request) =>
    request.method === "PATCH" &&
    request.path === "/v1/admin/payments/commercial-policies/support/SOL" &&
    Boolean(request.idempotencyKey)
  )).toBe(true);

  await page.setViewportSize({ width: 320, height: 640 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByText("support · SOL")).toBeVisible();
  const layout = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
  }));
  expect(layout.scrollWidth).toBe(layout.clientWidth);

  await page.goto("/admin/settings", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("safety.content_creation_abuse_policy", { exact: true })).toBeVisible();
  const flagForm = page.getByRole("button", { name: "Save feature flag" }).locator("..");
  const policyJson = '{"maxDraftsPerHour":12,"enabled":true}';
  const policyJsonField = flagForm.getByLabel("Policy JSON");
  await policyJsonField.evaluate((element, value) => {
    if (!(element instanceof HTMLTextAreaElement)) {
      throw new TypeError("Policy JSON control must be a textarea");
    }
    element.defaultValue = value;
    element.value = value;
  }, policyJson);
  await expect(policyJsonField).toHaveValue(policyJson);
  await flagForm.getByLabel("Audit reason").fill("Tune the reviewed content creation safety threshold");
  await flagForm.getByRole("button", { name: "Save feature flag" }).click();
  await expect.poll(() => requests.some((request) =>
    request.method === "PATCH" &&
    request.path === "/v1/admin/feature-flags/safety.content_creation_abuse_policy" &&
    Boolean(request.idempotencyKey)
  )).toBe(true);
});

async function gotoUntilVisible(page: Page, path: string, readyLocator: () => Locator) {
  let lastError: unknown = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto(path);

    try {
      await expect(readyLocator()).toBeVisible({ timeout: 5_000 });
      return;
    } catch (error) {
      lastError = error;
      await page.waitForTimeout(1_000);
    }
  }

  throw lastError;
}

async function handleApiRequest(request: IncomingMessage, response: ServerResponse) {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", "http://127.0.0.1:4000");

  if (url.pathname.startsWith("/tus/")) {
    await handleTusRequest(request, response, method, url);
    return;
  }

  setCorsHeaders(response);

  if (method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  requests.push({
    method,
    path: url.pathname,
    authorization: request.headers.authorization,
    idempotencyKey: typeof request.headers["idempotency-key"] === "string" ? request.headers["idempotency-key"] : undefined
  });

  if (request.headers.authorization !== `Bearer ${e2eToken}`) {
    sendJson(response, 401, { message: "Missing or invalid bearer token" });
    return;
  }

  const requestHasBody = method === "POST" || method === "PATCH";
  const contentType = request.headers["content-type"] ?? "";
  const body = requestHasBody && contentType.includes("application/json")
    ? await readJsonBody(request)
    : null;
  if (requestHasBody && !contentType.includes("application/json")) {
    await readRawBody(request);
  }

  if (method === "POST" && url.pathname === "/v1/auth/wallet/logout") {
    response.writeHead(204);
    response.end();
    return;
  }

  if (method === "GET" && url.pathname === "/v1/session") {
    sendJson(response, 200, sessionState());
    return;
  }

  if (method === "GET" && url.pathname === "/v1/admin/me") {
    sendJson(response, 200, {
      userId: user().id,
      roles: ["owner"],
      permissions: [
        "admin.overview.read",
        "admin.payments.read",
        "admin.payment_policy.write",
        "admin.analytics.read",
        "admin.analytics.recompute",
        "admin.feature_flags.read",
        "admin.feature_flags.write"
      ]
    });
    return;
  }

  if (method === "GET" && url.pathname === "/v1/admin/payments/commercial-policies") {
    sendJson(response, 200, { items: [paymentCommercialPolicy()], nextCursor: null });
    return;
  }

  if (method === "GET" && url.pathname === "/v1/admin/analytics/health") {
    sendJson(response, 200, {
      projectionKey: "analytics_core",
      definitionVersion: 1,
      state: "healthy",
      dataThrough: "2026-08-23T12:00:00.000Z",
      lagSeconds: 15,
      queuedJobCount: 0,
      leasedJobCount: 0,
      retryJobCount: 0,
      deadLetterJobCount: 0,
      latestReconciliationState: "matched",
      latestReconciliationVariance: 0,
      suppressionCountToday: 2
    });
    return;
  }

  if (method === "GET" && url.pathname === "/v1/admin/feature-flags") {
    sendJson(response, 200, { items: [adminFeatureFlag()] });
    return;
  }

  if (method === "POST" && url.pathname === "/v1/analytics/query") {
    const metricKeys = Array.isArray(body?.metricKeys)
      ? body.metricKeys.filter((key): key is string => typeof key === "string")
      : [];
    const dimensions = body && typeof body.dimensions === "object" && body.dimensions ? body.dimensions : {};
    sendJson(response, 200, {
      scope: body?.scope,
      window: body?.window,
      comparisonWindow: body?.comparisonWindow ?? null,
      granularity: body?.granularity ?? "total",
      timezone: "UTC",
      dataThrough: "2026-08-23T12:00:00.000Z",
      generatedAt: "2026-08-23T12:00:15.000Z",
      freshness: "fresh",
      metrics: metricKeys.map((metricKey) => ({
        metricKey,
        definitionVersion: 1,
        label: analyticsLabel(metricKey),
        unit: metricKey.includes("_minor")
          ? "minor_units"
          : metricKey.includes("rate") || metricKey.includes("conversion")
            ? "ratio"
            : metricKey.includes("seconds")
              ? "seconds"
              : "count",
        dimensions,
        points: [{
          bucketDate: null,
          value: metricKey.includes("rate") || metricKey.includes("conversion") ? 0.5 : "12",
          numerator: null,
          denominator: null,
          sampleSize: "12",
          privacyDecision: "released"
        }],
        comparisonValue: null,
        deltaPercent: null
      })),
      insights: []
    });
    return;
  }

  if (method === "POST" && url.pathname === "/v1/admin/analytics/jobs") {
    sendJson(response, 202, {
      id: "00000000-0000-4000-8000-000000000099",
      jobType: body?.jobType ?? "backfill",
      state: "queued",
      window: body?.window ?? { startDate: "2026-08-01", endDate: "2026-08-07" },
      createdAt: "2026-08-23T12:00:00.000Z"
    });
    return;
  }

  if (method === "PATCH" && url.pathname === "/v1/admin/payments/commercial-policies/support/SOL") {
    sendJson(response, 200, {
      ...paymentCommercialPolicy(),
      ...body,
      revision: 4,
      updatedAt: "2026-08-16T14:05:00.000Z"
    });
    return;
  }
  if (method === "PATCH" && url.pathname === "/v1/admin/feature-flags/safety.content_creation_abuse_policy") {
    sendJson(response, 200, { ...adminFeatureFlag(), ...body, updatedAt: "2026-08-24T21:00:00.000Z" });
    return;
  }

  if (method === "GET" && url.pathname === "/v1/profiles/me/creator-dashboard") {
    sendJson(response, 200, creatorDashboard());
    return;
  }

  if (method === "GET" && url.pathname === "/v1/profiles/me/creator-onboarding") {
    sendJson(response, 200, creatorOnboarding());
    return;
  }

  if (method === "PATCH" && url.pathname === "/v1/profiles/me/creator-onboarding") {
    sendJson(response, 200, creatorOnboarding());
    return;
  }

  if (method === "GET" && url.pathname === "/v1/content/mine") {
    sendJson(response, 200, url.searchParams.has("cursor")
      ? { items: [olderCreatorMediaItem()], nextCursor: null }
      : { items: [creatorMediaItem()], nextCursor: "2026-08-15T12:01:00.000Z" });
    return;
  }

  if (method === "POST" && url.pathname === `/v1/content/${draftContentId}/moderation-appeals`) {
    sendJson(response, 201, {
      id: "00000000-0000-4000-8000-000000000043",
      contentId: draftContentId,
      state: "submitted",
      reason: stringField(body, "reason"),
      createdAt: "2026-08-15T12:02:00.000Z"
    });
    return;
  }

  if (method === "POST" && url.pathname === `/v1/media/assets/${imageMediaAssetId}/provenance-review`) {
    sendJson(response, 200, {
      compositionRevision: 5,
      asset: {
        id: imageMediaAssetId,
        kind: "image",
        position: 0,
        provider: "bunny",
        providerState: "stored_private",
        posterUrl: null,
        mimeType: "image/webp",
        widthPixels: 1280,
        heightPixels: 720,
        durationMs: null,
        altText: null,
        requiredForRelease: true,
        isCover: false,
        focalPointX: null,
        focalPointY: null,
        originClassification: "ai_generated",
        visibleLabelState: "ai_generated",
        provenanceReviewState: body?.decision ?? "confirmed",
        machineReadableMarkingState: "pending"
      }
    });
    return;
  }

  if (method === "GET" && url.pathname === "/v1/verification/status") {
    sendJson(response, 200, verificationStatus());
    return;
  }

  if (method === "GET" && url.pathname === "/v1/wallets") {
    sendJson(response, 200, { items: [wallet()] });
    return;
  }

  if (method === "GET" && url.pathname === "/v1/activity/wallet-transactions") {
    sendJson(response, 200, { items: [walletTransaction()], nextCursor: null });
    return;
  }

  if (method === "GET" && url.pathname === "/v1/activity/payments") {
    sendJson(response, 200, { items: [paymentActivityItem()], nextCursor: null });
    return;
  }

  if (method === "GET" && url.pathname === "/v1/age/status") {
    sendJson(response, 200, { state: "verified", provider: "yoti" });
    return;
  }

  if (method === "POST" && url.pathname === "/v1/age/sessions") {
    sendJson(response, 201, {
      id: "00000000-0000-4000-8000-000000000060",
      provider: "yoti",
      launchUrl: `${e2eOrigin}/age?provider=yoti-e2e`,
      expiresAt: "2026-06-12T10:45:00.000Z"
    });
    return;
  }

  if (method === "GET" && url.pathname === "/v1/content/feed") {
    sendJson(response, 200, {
      items: [contentItem({ accessState: "free" })],
      nextCursor: null,
      mode: url.searchParams.get("mode") ?? "recommended",
      surface: url.searchParams.get("surface") ?? "home",
      rankingVersion: "deterministic_v1",
      generatedAt: "2026-08-15T12:00:00.000Z"
    });
    return;
  }

  if (method === "POST" && url.pathname === "/v1/feed/impressions") {
    sendJson(response, 202, { accepted: true });
    return;
  }

  if (method === "GET" && url.pathname === "/v1/discover/search") {
    sendJson(response, 200, {
      content: [contentItem({ accessState: "free" })],
      creators: [user()],
      hashtags: [{ slug: "studio", displayName: "Studio", state: "active" }],
      events: [],
      liveRooms: [liveRoom()],
      nextCursor: null
    });
    return;
  }

  if (method === "GET" && url.pathname === "/v1/profiles/ariamoon") {
    sendJson(response, 200, {
      user: user(),
      bio: "Independent creator",
      locationLabel: null,
      links: [],
      stats: {
        contentCount: 2,
        liveRoomCount: 0,
        confirmedPaymentCount: 0,
        followerCount: 12,
        followingCount: 4
      },
      monetisation: {
        supportEnabled: false,
        contentUnlocksEnabled: false,
        livePassesEnabled: false,
        paidMessagesEnabled: false,
        subscriptionsEnabled: false,
        membershipOffer: null
      },
      recentContent: [textContentItem(), pollContentItem()]
    });
    return;
  }

  if (method === "GET" && url.pathname === `/v1/follows/${user().id}`) {
    sendJson(response, 200, {
      userId: user().id,
      following: false,
      followerCount: 12,
      followingCount: 4
    });
    return;
  }

  if (method === "GET" && url.pathname === `/v1/content/${contentId}`) {
    sendJson(response, 200, contentItem({ accessState: "locked" }));
    return;
  }

  if (method === "GET" && url.pathname === `/v1/content/${draftContentId}`) {
    sendJson(response, 200, videoDraftContentItem());
    return;
  }

  if (method === "GET" && url.pathname === `/v1/content/${imageDraftContentId}`) {
    sendJson(response, 200, imageDraftContentItem());
    return;
  }

  if (method === "GET" && url.pathname === `/v1/content/${textContentId}`) {
    sendJson(response, 200, textContentItem());
    return;
  }

  if (method === "GET" && url.pathname === `/v1/content/${pollContentId}`) {
    sendJson(response, 200, pollContentItem());
    return;
  }

  if (method === "POST" && url.pathname === `/v1/content/${pollContentId}/poll-votes`) {
    sendJson(response, 200, pollContentItem(pollOptionIds[1]).poll);
    return;
  }

  if (method === "POST" && url.pathname === "/v1/content") {
    if (body?.mediaType === "image" || body?.mediaType === "carousel") {
      sendJson(response, 201, imageDraftContentItem(1));
      return;
    }
    if (body?.mediaType === "bit" || body?.mediaType === "clip" || body?.mediaType === "vod") {
      sendJson(response, 201, videoDraftContentItem(1));
      return;
    }
    sendJson(response, 201, contentItem({
      id: draftContentId,
      accessState: "free",
      caption: stringField(body, "caption") ?? "Draft caption"
    }));
    return;
  }


  if (method === "POST" && url.pathname === `/v1/content/${imageDraftContentId}/image-assets`) {
    sendJson(response, 201, {
      mediaAssetId: imageMediaAssetId,
      kind: "image",
      mimeType: "image/png",
      widthPixels: 1,
      heightPixels: 1,
      releaseState: "awaiting_safety_evidence"
    });
    return;
  }

  if (method === "PATCH" && url.pathname === `/v1/media/assets/${imageMediaAssetId}`) {
    sendJson(response, 200, {
      compositionRevision: 3,
      asset: imageDraftContentItem().mediaAssets[0]
    });
    return;
  }

  if (method === "DELETE" && url.pathname === `/v1/media/assets/${imageMediaAssetId}`) {
    sendJson(response, 200, {
      mediaAssetId: imageMediaAssetId,
      compositionRevision: 4,
      cleanupState: "completed"
    });
    return;
  }

  if (method === "POST" && url.pathname === "/v1/media/uploads") {
    sendJson(response, 201, {
      uploadUrl: "http://127.0.0.1:4000/tus/studio-session",
      provider: "bunny",
      mediaAssetId,
      headers: {
        AuthorizationSignature: "bunny-session-signature",
        AuthorizationExpire: "1781261100"
      },
      expiresAt: "2026-06-12T10:45:00.000Z"
    });
    return;
  }

  if (method === "POST" && url.pathname === `/v1/media/assets/${mediaAssetId}/sync`) {
    sendJson(response, 202, {});
    return;
  }

  if (method === "PATCH" && url.pathname === `/v1/media/assets/${mediaAssetId}`) {
    sendJson(response, 200, {
      compositionRevision: 3,
      asset: videoDraftMediaAsset()
    });
    return;
  }

  if (method === "PATCH" && url.pathname === `/v1/content/${draftContentId}`) {
    sendJson(response, 200, videoDraftContentItem());
    return;
  }

  if (method === "POST" && url.pathname === `/v1/content/${draftContentId}/publish`) {
    sendJson(response, 200, videoDraftContentItem());
    return;
  }

  if (method === "PATCH" && url.pathname === `/v1/content/${imageDraftContentId}`) {
    sendJson(response, 200, imageDraftContentItem());
    return;
  }

  if (method === "POST" && url.pathname === `/v1/content/${imageDraftContentId}/publish`) {
    sendJson(response, 409, { code: "conflict", message: "Photos are still completing safety review" });
    return;
  }

  if (method === "POST" && url.pathname === `/v1/content/${contentId}/unlock-intents`) {
    sendJson(response, 201, {
      state: "payment_required",
      contentId,
      paymentIntent: paymentIntent()
    });
    return;
  }

  if (method === "POST" && url.pathname === `/v1/payments/intents/${paymentIntentId}/consent`) {
    sendJson(response, 200, paymentIntent());
    return;
  }

  if (method === "GET" && url.pathname === `/v1/payments/intents/${paymentIntentId}/transaction-request`) {
    sendJson(response, 200, {
      transactionRequestUrl: "solana:https://wallet.example.test/request/content-unlock",
      checkoutUrl: "https://wallet.example.test/request/content-unlock",
      qrDataUrl: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxyZWN0IHdpZHRoPSIxIiBoZWlnaHQ9IjEiLz48L3N2Zz4=",
      expiresAt: "2026-06-12T10:45:00.000Z"
    });
    return;
  }

  sendJson(response, 404, { message: `Unhandled test route: ${method} ${url.pathname}` });
}

async function handleTusRequest(
  request: IncomingMessage,
  response: ServerResponse,
  method: string,
  url: URL
) {
  setTusCorsHeaders(response);
  if (method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }
  if (method === "POST" && url.pathname === "/tus/studio-session") {
    await readRawBody(request);
    response.writeHead(201, {
      Location: "http://127.0.0.1:4000/tus/studio-session/upload-1",
      "Tus-Resumable": "1.0.0"
    });
    response.end();
    return;
  }
  if (method === "PATCH" && url.pathname === "/tus/studio-session/upload-1") {
    const body = await readRawBody(request);
    const offset = Number(request.headers["upload-offset"] ?? 0) + body.length;
    response.writeHead(204, { "Tus-Resumable": "1.0.0", "Upload-Offset": String(offset) });
    response.end();
    return;
  }
  if (method === "HEAD" && url.pathname === "/tus/studio-session/upload-1") {
    response.writeHead(200, {
      "Tus-Resumable": "1.0.0",
      "Upload-Length": "10",
      "Upload-Offset": "0"
    });
    response.end();
    return;
  }
  sendJson(response, 404, { message: `Unhandled TUS test route: ${method} ${url.pathname}` });
}

function setCorsHeaders(response: ServerResponse) {
  response.setHeader("Access-Control-Allow-Origin", e2eOrigin);
  response.setHeader("Access-Control-Allow-Credentials", "true");
  response.setHeader("Access-Control-Allow-Headers", "authorization,content-type,idempotency-key,accept");
  response.setHeader("Access-Control-Allow-Methods", "DELETE,GET,POST,PATCH,OPTIONS");
}

function setTusCorsHeaders(response: ServerResponse) {
  response.setHeader("Access-Control-Allow-Origin", e2eOrigin);
  response.setHeader(
    "Access-Control-Allow-Headers",
    "authorizationexpire,authorizationsignature,content-type,tus-resumable,upload-length,upload-metadata,upload-offset"
  );
  response.setHeader("Access-Control-Allow-Methods", "HEAD,OPTIONS,PATCH,POST");
  response.setHeader("Access-Control-Expose-Headers", "Location,Upload-Length,Upload-Offset,Tus-Resumable");
}

function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) as Record<string, unknown> : {};
}

async function readRawBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function stringField(body: unknown, key: string) {
  if (!body || typeof body !== "object" || !(key in body)) {
    return null;
  }

  const value = (body as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

function user() {
  return {
    id: "00000000-0000-4000-8000-000000000010",
    handle: "ariamoon",
    displayName: "Aria Moon",
    avatarUrl: null,
    badges: [
      { key: "age_verified", label: "Age verified", group: "trust" },
      { key: "studio", label: "Studio", group: "creator" }
    ]
  };
}

function sessionState() {
  return {
    authenticated: true,
    appAccessState: { allowed: true, reason: "ready" },
    user: user()
  };
}

function wallet() {
  return {
    id: "00000000-0000-4000-8000-000000000020",
    chain: "solana_devnet",
    address: "So11111111111111111111111111111111111111112",
    provider: "embedded_privy",
    isPrimary: true
  };
}

function walletTransaction() {
  return {
    id: "00000000-0000-4000-8000-000000000021",
    chain: "solana_devnet",
    direction: "outgoing",
    amountMinor: 25,
    currency: "SOL",
    state: "submitted",
    source: "payment_intent",
    paymentIntentId,
    walletId: wallet().id,
    signature: "5rQ5mockedWalletSignature"
  };
}

function paymentActivityItem() {
  return {
    id: paymentIntentId,
    kind: "payment",
    title: "Payment confirmed",
    state: "confirmed",
    productType: "content_unlock",
    targetId: contentId,
    amountMinor: 25,
    currency: "SOL",
    paymentIntentId,
    signature: "5rQ5mockedWalletSignature",
    referenceAddress: "So11111111111111111111111111111111111111112",
    receiptId: "00000000-0000-4000-8000-000000000051",
    receiptNumber: "VEEL-0000000000004000",
    receiptState: "issued",
    inAppConfirmationState: "sent",
    emailConfirmationState: "sent",
    withdrawalRightStatus: "waived_after_immediate_access",
    supportReviewAvailable: true,
    latestRefundRequestState: null,
    createdAt: "2026-06-12T10:00:00.000Z",
    confirmedAt: "2026-06-12T10:00:10.000Z"
  };
}

function creatorDashboard() {
  return {
    creator: user(),
    readiness: {
      state: "active",
      earningState: "ready",
      kycState: "verified",
      taxProfileState: "verified",
      recipientWalletState: "linked",
      readinessScore: 92,
      canMonetize: true,
      nextAction: null,
      policyBoundary: "creator_records_only_no_balances_payout_queue_or_social_priority",
      blockedReasons: []
    },
    earnings: {
      currency: "SOL",
      creatorEarningsMinor: 1240,
      platformFeesMinor: 120,
      referralCommissionsMinor: 35,
      confirmedPaymentCount: 18
    },
    products: [
      {
        productType: "content_unlock",
        enabled: true,
        confirmedPaymentCount: 12,
        amountMinor: 25,
        currency: "SOL"
      }
    ],
    recentActivity: []
  };
}

function creatorMediaItem() {
  return {
    id: draftContentId,
    mediaType: "clip",
    distributionMode: "post",
    caption: "Studio draft needing an update",
    posterUrl: null,
    visibility: "private",
    publicationState: "changes_requested",
    reviewState: "changes_requested",
    reviewMessage: "Please confirm the music rights.",
    compositionRevision: 4,
    provenanceAssets: [{
      mediaAssetId: imageMediaAssetId,
      kind: "image",
      originClassification: "ai_generated",
      visibleLabelState: "ai_generated",
      reviewState: "pending",
      machineReadableMarkingState: "pending"
    }],
    createdAt: "2026-08-15T12:00:00.000Z",
    updatedAt: "2026-08-15T12:01:00.000Z"
  };
}

function olderCreatorMediaItem() {
  return {
    ...creatorMediaItem(),
    id: "00000000-0000-4000-8000-000000000044",
    caption: "Older published post",
    publicationState: "published",
    reviewState: "approved",
    reviewMessage: null,
    createdAt: "2026-08-14T12:00:00.000Z",
    updatedAt: "2026-08-14T12:01:00.000Z"
  };
}

function creatorOnboarding() {
  return {
    state: "ready",
    canStartEarning: true,
    readinessScore: 92,
    nextAction: null,
    policyBoundary: "creator_records_only_no_balances_payout_queue_or_social_priority",
    configuration: {
      recipientWalletId: wallet().id,
      earningsTermsVersion: "wevid-creator-earnings-v1",
      products: {
        support: true,
        contentUnlocks: true,
        eventAccessAndLive: false,
        paidMessages: true
      }
    },
    steps: [
      { key: "profile", label: "Profile", state: "complete", required: true, actionHref: "/app/profile" },
      { key: "wallet", label: "Wallet", state: "complete", required: true, actionHref: "/app/wallet" },
      { key: "age", label: "Age", state: "complete", required: true, actionHref: "/age" }
    ]
  };
}

function verificationStatus() {
  return {
    capabilities: {
      canAccessApp: true,
      canCreateProfile: true,
      canViewAgeRestrictedContent: true,
      canStartCreatorOnboarding: true,
      canCreateDraft: true,
      canUploadMedia: true,
      canPublishMedia: true,
      canPublishAdultMedia: true,
      canMonetize: true,
      canReceiveCreatorProceeds: true,
      canAccessCreatorDashboard: true,
      canCreateOrganization: true,
      canAccessStudio: true,
      canInviteTeam: false,
      canUseTeamPublishing: false,
      canUseAllocationWallets: false,
      canUseComplianceExports: false,
      canAccessEnterprise: false
    },
    missingRequirements: [],
    nextBestAction: "creator_ready",
    verificationSummary: {
      ageAccess: verificationRecord("age_access", "didit", "portable_age_credential", "age_over_18"),
      adultPublisherEligibility: verificationRecord(
        "adult_publisher_eligibility",
        "didit",
        "gov_id_selfie",
        "documentary"
      ),
      creatorKyc: verificationRecord("creator_kyc", "didit", "gov_id_selfie", "documentary"),
      orgKyb: null
    }
  };
}

function verificationRecord(purpose: string, provider: string, method: string, assuranceLevel: string) {
  return {
    subjectType: "user",
    subjectId: user().id,
    purpose,
    status: "valid",
    provider,
    method,
    assuranceLevel,
    verifiedAt: "2026-06-03T22:00:00.000Z",
    expiresAt: null,
    reusable: true
  };
}

function liveRoom() {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa10",
    title: "Live now with access-gated chat",
    creator: user(),
    state: "live",
    accessState: "pass_required",
    playback: {
      state: "teaser",
      url: null,
      provider: "livepeer",
      resourceType: null,
      expiresAt: null
    },
    teaserSecondsRemaining: 45,
    passOptions: [{ durationMinutes: 30, amountMinor: 10, currency: "SOL" }],
    chat: { enabled: true, accessState: "pass_required" },
    replayContentId: null
  };
}

function contentItem(overrides: {
  id?: string;
  accessState: "free" | "locked";
  caption?: string;
  playbackState?: "blocked" | "full";
}) {
  return {
    id: overrides.id ?? contentId,
    creator: user(),
    mediaType: "clip",
    distributionMode: "post",
    caption: overrides.caption ?? "Studio sunrise session",
    posterUrl: null,
    playback: {
      state: overrides.playbackState ?? (overrides.accessState === "locked" ? "blocked" : "full"),
      url: overrides.accessState === "locked" ? null : "https://media.example.test/studio.mp4",
      provider: overrides.accessState === "locked" ? "none" : "bunny",
      resourceType: overrides.accessState === "locked" ? null : "direct",
      expiresAt: null
    },
    accessState: overrides.accessState,
    nsfwLabel: "adult",
    engagement: {
      liked: false,
      saved: false,
      likeCount: 128,
      commentCount: 24,
      shareCount: 8
    },
    viewerFollowingCreator: false
  };
}

function videoDraftMediaAsset() {
  return {
    id: mediaAssetId,
    kind: "video",
    position: 0,
    provider: "bunny",
    providerState: "ready",
    posterUrl: null,
    playback: {
      state: "full",
      url: "https://media.example.test/studio.mp4",
      provider: "bunny",
      resourceType: "direct",
      expiresAt: null
    },
    mimeType: "video/mp4",
    widthPixels: null,
    heightPixels: null,
    durationMs: 60_000,
    altText: "Studio video preview",
    requiredForRelease: true,
    isCover: false,
    focalPointX: null,
    focalPointY: null,
    originClassification: "human_created",
    visibleLabelState: "none"
  };
}

function videoDraftContentItem(compositionRevision = 2) {
  return {
    ...contentItem({ id: draftContentId, accessState: "free", playbackState: "full" }),
    compositionRevision,
    mediaAssets: [videoDraftMediaAsset()]
  };
}

function imageDraftContentItem(compositionRevision = 2) {
  return {
    ...contentItem({ id: imageDraftContentId, accessState: "free", caption: "A private photo draft" }),
    mediaType: "image",
    compositionRevision,
    playback: null,
    mediaAssets: [{
      id: imageMediaAssetId,
      kind: "image",
      position: 0,
      provider: "bunny",
      providerState: "stored_private",
      posterUrl: null,
      mimeType: "image/png",
      widthPixels: 1,
      heightPixels: 1,
      durationMs: null,
      altText: "A small red test image",
      requiredForRelease: true,
      isCover: false,
      focalPointX: null,
      focalPointY: null,
      originClassification: "human_created",
      visibleLabelState: "none"
    }]
  };
}

function textContentItem() {
  return {
    ...contentItem({ id: textContentId, accessState: "free" }),
    mediaType: "text",
    bodyText: "A structured text post with a real consumer renderer.",
    caption: null,
    playback: null
  };
}

function pollContentItem(viewerOptionId: string | null = null) {
  return {
    ...contentItem({ id: pollContentId, accessState: "free" }),
    mediaType: "poll",
    caption: null,
    playback: null,
    poll: {
      question: "What should we publish next?",
      options: [
        { id: pollOptionIds[0], position: 0, text: "Photo", voteCount: 0 },
        { id: pollOptionIds[1], position: 1, text: "Carousel", voteCount: viewerOptionId ? 1 : 0 }
      ],
      state: "open",
      totalVoteCount: viewerOptionId ? 1 : 0,
      closesAt: null,
      viewerOptionId
    }
  };
}

function paymentIntent() {
  return {
    id: paymentIntentId,
    productType: "content_unlock",
    amountMinor: 25_000_000_000,
    currency: "SOL",
    state: "pending",
    settlementKind: "creator_split",
    creatorSideProceedsMinor: 21_250_000_000,
    creatorAmountMinor: 21_250_000_000,
    enterpriseManagementAmountMinor: 0,
    platformFeeGrossMinor: 3_750_000_000,
    platformFeeAmountMinor: 3_750_000_000,
    referralAmountMinor: 0,
    refundPolicy: {
      termsVersion: "veel-terms-v1",
      withdrawalWaiverVersion: "instant-digital-access-v1",
      withdrawalWaiverRequired: true,
      withdrawalWaiverAcceptedAt: null,
      durableConfirmationRequired: true,
      refundValueBasis: "original_crypto_amount"
    }
  };
}

function paymentCommercialPolicy() {
  return {
    id: "00000000-0000-4000-8000-000000000052",
    productType: "support",
    currency: "SOL",
    minimumAmountMinor: 1_000_000,
    platformFeeBps: 1_000,
    referralShareOfPlatformFeeBps: 2_000,
    quoteTtlSeconds: 900,
    state: "active",
    revision: 3,
    reason: "Initial finance-approved launch policy",
    updatedBySupabaseUserId: "00000000-0000-4000-8000-000000000001",
    updatedAt: "2026-08-16T14:00:00.000Z"
  };
}

function adminFeatureFlag() {
  return {
    key: "safety.content_creation_abuse_policy",
    value: { maxDraftsPerHour: 10, enabled: true },
    category: "safety",
    policyBoundary: "software_policy_only_no_payment_access_or_social_priority",
    state: "active",
    updatedAt: "2026-08-16T14:00:00.000Z"
  };
}

function analyticsLabel(metricKey: string) {
  return metricKey
    .split(".")
    .at(-1)!
    .replaceAll("_", " ")
    .replace(/^./, (character) => character.toUpperCase());
}
