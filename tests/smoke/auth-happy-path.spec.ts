import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

const e2eToken = "veel-e2e-token";
const contentId = "00000000-0000-4000-8000-000000000040";
const draftContentId = "00000000-0000-4000-8000-000000000041";
const mediaAssetId = "00000000-0000-4000-8000-000000000042";
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
      domain: "127.0.0.1",
      path: "/",
      httpOnly: false,
      sameSite: "Lax"
    }
  ]);
});

test("covers authenticated earnings setup, creation, and one-time checkout", async ({ page }) => {
  test.setTimeout(100_000);

  await gotoUntilVisible(page, "/app/home", () => page.getByRole("link", { name: "WeVid app home" }).first());
  await expect(page.getByRole("heading", { name: "Your feed" })).toBeVisible();
  await expect(page.getByRole("article", { name: "Post by Aria Moon" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "For you" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("link", { name: "Open post" })).toBeVisible();

  await page.goto("/app/profile");
  await expect(page.getByRole("heading", { name: "Aria Moon" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your media" })).toBeVisible();
  await expect(page.getByText("Please confirm the music rights.")).toBeVisible();
  await page.getByRole("button", { name: "Load more media" }).click();
  await expect(page.getByText("Older published post")).toBeVisible();
  await page.getByRole("button", { name: "Appeal decision" }).click();
  await page.getByLabel("Why should this be reviewed again?").fill("I own the recording and the music license.");
  await page.getByRole("button", { name: "Send appeal" }).click();
  await expect(page.getByText("appeal pending")).toBeVisible();
  await expect(page.getByText("Readiness score").locator("..")).toContainText("92%");
  await expect(page.getByText("no balances or social priority")).toBeVisible();

  await page.goto("/app/profile/earnings");
  await expect(page.getByRole("heading", { name: "Enable earnings" })).toBeVisible();
  await expect(page.getByLabel("Recipient wallet")).toHaveValue(wallet().id);
  await expect(page.getByRole("checkbox", { name: /Support/ })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: /Content unlocks/ })).toBeChecked();
  await page.getByRole("checkbox", { name: /Creator Earnings Terms/ }).check();
  await page.getByRole("button", { name: "Update earnings" }).click();
  await expect(page.getByText("Earnings are enabled.")).toBeVisible();

  await page.goto("/app/wallet");
  await expect(page.getByRole("heading", { name: "Funding and receipts" })).toBeVisible();
  await expect(page.getByText("Primary wallet")).toBeVisible();
  await expect(page.getByText("backend settlement only")).toBeVisible();
  await expect(page.getByText("Funding sessions do not unlock")).toBeVisible();

  await page.goto("/age");
  await expect(page.getByRole("heading", { name: "Confirm you're 18+" })).toBeVisible();
  await expect(page.getByText("Current status")).toBeVisible();
  await expect(page.getByText("verified", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start age verification" })).toBeEnabled();

  await page.goto("/app/home");
  await expect(page.getByRole("heading", { name: "Your feed" })).toBeVisible();
  await expect(page.getByRole("article", { name: "Post by Aria Moon" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open post" })).toBeVisible();

  await page.goto("/app/create");
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { name: "Share something" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Start with OBS" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Choose your video" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.cookie.includes("veel_e2e_access_token="))).toBe(true);

  await page.route("https://bunny.example.test/**", async (route) => {
    const method = route.request().method();
    if (method === "POST") {
      await route.fulfill({
        status: 201,
        headers: {
          "Access-Control-Allow-Origin": "http://127.0.0.1:3000",
          "Access-Control-Expose-Headers": "Location,Upload-Offset,Tus-Resumable",
          Location: "https://bunny.example.test/tus/studio-session/upload-1",
          "Tus-Resumable": "1.0.0"
        }
      });
      return;
    }
    if (method === "PATCH") {
      await route.fulfill({
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "http://127.0.0.1:3000",
          "Access-Control-Expose-Headers": "Upload-Offset,Tus-Resumable",
          "Upload-Offset": "10",
          "Tus-Resumable": "1.0.0"
        }
      });
      return;
    }
    await route.fulfill({ status: 200, headers: { "Upload-Offset": "0", "Tus-Resumable": "1.0.0" } });
  });

  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles({
    name: "studio-session.mp4",
    mimeType: "video/mp4",
    buffer: Buffer.from("mock-video")
  });
  await expect(page.locator("video")).toBeVisible();
  await page.getByLabel("Caption").fill("Behind the scenes from today's studio shoot.");
  await page.getByLabel("I have the right to upload and share this video, and it is safe-for-work.").check();
  await page.reload();
  await page.locator('input[type="file"]').setInputFiles({
    name: "studio-session.mp4",
    mimeType: "video/mp4",
    buffer: Buffer.from("mock-video")
  });
  await expect(page.getByLabel("Caption")).toHaveValue("Behind the scenes from today's studio shoot.");
  await expect(page.getByLabel("I have the right to upload and share this video, and it is safe-for-work.")).not.toBeChecked();
  await page.getByLabel("I have the right to upload and share this video, and it is safe-for-work.").check();
  await page.getByRole("button", { name: "Upload video" }).click();
  await expect(page.getByText("Preview ready")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Submit for review" }).click();
  await expect(page.getByText("Submitted. It remains private while review completes.")).toBeVisible();
  await expect(page.getByText(/Bunny|TUS|provider/i)).toHaveCount(0);
  const createLayout = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
  }));
  expect(createLayout.scrollWidth).toBe(createLayout.clientWidth);

  await page.goto(`/content/${contentId}`);
  await expect(page.getByRole("heading", { name: "Media viewer" })).toBeVisible();
  await expect(page.getByText("Access required")).toBeVisible();
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
  await expect(page.getByText("VEEL-0000000000004000")).toBeVisible();
  await expect(page.getByText("sent", { exact: true })).toHaveCount(2);
  await expect(page.getByText("ended after access")).toBeVisible();
  await expect(page.getByRole("button", { name: "Open review" })).toBeVisible();

  const protectedRequests = requests.filter((request) => request.path.startsWith("/v1/"));
  expect(protectedRequests.every((request) => request.authorization === `Bearer ${e2eToken}`)).toBe(true);
  expect(requests.some((request) => request.method === "POST" && request.path === "/v1/content" && request.idempotencyKey)).toBe(true);
  expect(requests.some((request) => request.method === "POST" && request.path === `/v1/content/${contentId}/unlock-intents` && request.idempotencyKey)).toBe(true);
  expect(requests.some((request) => request.method === "POST" && request.path === `/v1/payments/intents/${paymentIntentId}/consent` && request.idempotencyKey)).toBe(true);
  expect(requests.some((request) => request.method === "PATCH" && request.path === "/v1/profiles/me/creator-onboarding" && request.idempotencyKey)).toBe(true);
  expect(requests.some((request) => request.method === "GET" && request.path === "/v1/activity/payments")).toBe(true);

  await page.goto("/app/profile");
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "Create without asking the algorithm for permission." })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.cookie.includes("veel_e2e_access_token="))).toBe(false);
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

  const body = method === "POST" || method === "PATCH" ? await readJsonBody(request) : null;

  if (method === "POST" && url.pathname === "/v1/auth/wallet/logout") {
    response.writeHead(204);
    response.end();
    return;
  }

  if (method === "GET" && url.pathname === "/v1/session") {
    sendJson(response, 200, sessionState());
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
      launchUrl: "http://127.0.0.1:3000/age?provider=yoti-e2e",
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

  if (method === "GET" && url.pathname === `/v1/content/${contentId}`) {
    sendJson(response, 200, contentItem({ accessState: "locked" }));
    return;
  }

  if (method === "GET" && url.pathname === `/v1/content/${draftContentId}`) {
    sendJson(response, 200, contentItem({ id: draftContentId, accessState: "free", playbackState: "full" }));
    return;
  }

  if (method === "POST" && url.pathname === "/v1/content") {
    sendJson(response, 201, contentItem({
      id: draftContentId,
      accessState: "free",
      caption: stringField(body, "caption") ?? "Draft caption"
    }));
    return;
  }

  if (method === "POST" && url.pathname === "/v1/media/uploads") {
    sendJson(response, 201, {
      uploadUrl: "https://bunny.example.test/tus/studio-session",
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

  if (method === "PATCH" && url.pathname === `/v1/content/${draftContentId}`) {
    sendJson(response, 200, contentItem({ id: draftContentId, accessState: "free", playbackState: "full" }));
    return;
  }

  if (method === "POST" && url.pathname === `/v1/content/${draftContentId}/publish`) {
    sendJson(response, 200, contentItem({ id: draftContentId, accessState: "free", playbackState: "full" }));
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

function setCorsHeaders(response: ServerResponse) {
  response.setHeader("Access-Control-Allow-Origin", "http://127.0.0.1:3000");
  response.setHeader("Access-Control-Allow-Credentials", "true");
  response.setHeader("Access-Control-Allow-Headers", "authorization,content-type,idempotency-key,accept");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");
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
    caption: "Studio draft needing an update",
    posterUrl: null,
    visibility: "public",
    publicationState: "changes_requested",
    reviewState: "changes_requested",
    reviewMessage: "Please confirm the music rights.",
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
