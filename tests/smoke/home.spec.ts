import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { expect, test } from "@playwright/test";
import type { BrowserContext } from "@playwright/test";

const rawBackendCopy = /HTTP (401|403|404|429|500|503)|Missing or invalid bearer token|API is unavailable/;
const e2eToken = "veel-e2e-token";
const firstConversationId = "00000000-0000-4000-8000-000000000081";
const secondConversationId = "00000000-0000-4000-8000-000000000082";
const unavailableConversationId = "00000000-0000-4000-8000-000000000083";
let apiServer: Server;

test.beforeAll(async () => {
  apiServer = createServer(async (request, response) => {
    try {
      await handleApiRequest(request, response);
    } catch (error) {
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

async function addE2eCookie(context: BrowserContext) {
  await context.addCookies([
    {
      name: "veel_e2e_access_token",
      value: e2eToken,
      url: "http://127.0.0.1:3000",
      httpOnly: false,
      sameSite: "Lax"
    }
  ]);
}

test("renders the public landing with the current WeVid visual contract", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("link", { name: "WeVid home" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Create without asking the algorithm for permission." })).toBeVisible();
  await expect(page.getByRole("button", { name: /Start onboarding/ }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Log in" }).first()).toBeVisible();
  await expect(page.getByText("Public legal copy here is a product placeholder")).toHaveCount(0);
});

test("renders inline login and onboarding entry surfaces", async ({ page }) => {
  await page.goto("/?mode=login", { waitUntil: "domcontentloaded", timeout: 20_000 });

  await expect(page.getByRole("heading", { name: "Log in." })).toBeVisible();
  await expect(
    page
      .getByRole("button", { name: "Continue" })
      .or(page.getByRole("button", { name: "Connect wallet" }))
      .first()
  ).toBeVisible();
  await expect(page.getByText("Privy", { exact: true })).toHaveCount(0);

  await page.goto("/?mode=onboarding", { waitUntil: "domcontentloaded", timeout: 20_000 });

  await expect(page.getByRole("heading", { name: "Create your account." })).toBeVisible();
  await expect(page.getByText("Choose how to continue. Your wallet stays under your control.")).toBeVisible();

  await page.getByRole("button", { name: /Connect wallet/ }).click();
  await expect(page.getByRole("dialog", { name: /wallet.*Solana|need a wallet/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Create your account." })).toBeVisible();
  await expect(page.locator(".landing-progress-topic")).toHaveText("Onboarding");
});

test("renders a deep-linked onboarding step without an entrance-animation delay", async ({ page }) => {
  await page.goto("/?mode=onboarding&step=profile&next=%2Fapp%2Fhome", {
    waitUntil: "domcontentloaded",
    timeout: 20_000
  });

  await expect(page.getByRole("heading", { name: "Create your account." })).toBeVisible();
  await expect(page.getByLabel("Handle")).toBeVisible();
  await expect(page.locator(".landing-auth-inline")).toHaveCSS("opacity", "1");
  await expect(page.locator(".landing-auth-inline")).toHaveCSS("visibility", "visible");
});

test("renders the standalone age handoff without raw API/provider errors", async ({ page }) => {
  await page.goto("/age");

  await expect(page.getByRole("heading", { name: "Confirm you're 18+" })).toBeVisible();
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

test("renders the canonical protected app home shell through /app", async ({ context, page }) => {
  await addE2eCookie(context);
  await page.goto("/app/home", { waitUntil: "domcontentloaded", timeout: 45_000 });

  await expect(page.getByRole("link", { name: "WeVid app home" }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: /Your feed|Enter WeVid/ }).first()).toBeVisible();
  await expect(page.getByText(rawBackendCopy)).toHaveCount(0);
});

test("retries Realtime token acquisition after a transient API failure", async ({ context, page }) => {
  await addE2eCookie(context);
  let tokenRequests = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/v1/realtime/token")) tokenRequests += 1;
  });
  await page.goto("/app/home", { waitUntil: "domcontentloaded", timeout: 45_000 });

  await expect.poll(() => tokenRequests, { timeout: 8_000 }).toBeGreaterThanOrEqual(2);
});

test("follows from the real Home feed and renders the immersive Bits surface", async ({ context, page }) => {
  await addE2eCookie(context);
  await page.goto("/app/home", { waitUntil: "domcontentloaded", timeout: 45_000 });

  await expect(page.getByRole("article", { name: "Post by Aria Moon" }).first()).toBeVisible();
  await expect(page.locator(".home-feed")).toHaveAttribute("data-scroll-persistence", "ready");
  await page.addStyleTag({ content: ".home-feed { min-height: 3000px; }" });
  await page.locator(".page-frame").evaluate((frame) => frame.scrollTo({ top: 480 }));
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("wevid:home:recommended:scroll")))
    .toBe("480");
  await expect(page.getByRole("button", { name: "Follow", exact: true })).toHaveCount(2);
  const followResponse = page.waitForResponse((response) =>
    response.request().method() === "POST" && response.url().endsWith(`/v1/follows/${user().id}`)
  );
  await page.getByRole("button", { name: "Follow", exact: true }).first().click();
  expect((await followResponse).status()).toBe(200);
  await expect(page.getByRole("button", { name: "Following", exact: true })).toHaveCount(2);
  await page.getByRole("button", { name: "Following", exact: true }).first().click();
  await expect(page.getByRole("button", { name: "Follow", exact: true })).toHaveCount(2);
  await page.getByRole("tab", { name: "For you" }).focus();
  await page.getByRole("tab", { name: "For you" }).press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Following" })).toBeFocused();
  await expect(page.getByRole("tab", { name: "Following" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("article", { name: "Post by Aria Moon" }).first()).toBeVisible();

  await page.goto("/app/bits", { waitUntil: "domcontentloaded", timeout: 45_000 });
  await expect(page.getByRole("heading", { name: "Swipe. Watch. Keep your place." })).toBeVisible();
  await expect(page.getByRole("article", { name: "Post by Aria Moon" }).first()).toBeVisible();
  await page.getByRole("tab", { name: "For you" }).focus();
  await page.getByRole("tab", { name: "For you" }).press("ArrowDown");
  await expect(page.getByRole("tab", { name: "Following" })).toBeFocused();
  const layout = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
  }));
  expect(layout.scrollWidth).toBe(layout.clientWidth);
});

test("requires confirmation before logging out every device", async ({ context, page }) => {
  await addE2eCookie(context);
  await page.goto("/app/settings#security", { waitUntil: "domcontentloaded", timeout: 45_000 });

  await page.getByRole("button", { name: "Log out all devices" }).click();
  await expect(page.getByRole("button", { name: "Confirm log out all devices" })).toBeVisible();
  await page.getByRole("button", { name: "Confirm log out all devices" }).click();
  await expect(page).toHaveURL(/\/$/);
});

test("separates platform plans from creator memberships responsively", async ({ context, page }) => {
  await addE2eCookie(context);
  await page.goto("/app/subscriptions", { waitUntil: "domcontentloaded", timeout: 45_000 });

  await expect(page.getByRole("heading", { name: "Your WeVid access" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Platform plans" })).toBeVisible();
  await expect(page.getByRole("heading", { exact: true, name: "Creator memberships" })).toBeVisible();
  await expect(page.getByText("Free Verified", { exact: true })).toHaveCount(2);
  await expect(page.getByText("Veel Studio", { exact: true })).toBeVisible();
  await expect(page.getByText("No joined memberships", { exact: true })).toBeVisible();

  const layout = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
  }));
  expect(layout.scrollWidth).toBe(layout.clientWidth);
});

test("selects a requested conversation and keeps the inbox within the viewport", async ({ context, page }) => {
  await addE2eCookie(context);
  await page.goto(`/app/messages?conversation=${secondConversationId}`, {
    waitUntil: "domcontentloaded",
    timeout: 45_000
  });

  await expect(page.getByRole("heading", { name: "Production notes" })).toBeVisible();
  await expect(page.getByRole("article").getByText("Second thread message", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /Production notes/ })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("link", { name: /Studio team/ })).not.toHaveAttribute("aria-current", "page");
  await expect(page.getByText("Message request", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Accept", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Conversation safety" })).toBeVisible();
  await page.getByRole("button", { name: "Report", exact: true }).click();
  await page.getByLabel("Report reason").fill("Unsafe account behavior in this conversation");
  await page.getByRole("button", { name: "Submit report" }).click();
  await expect(page.getByText("Report submitted for safety review.")).toBeVisible();
  await expect(page.getByText(rawBackendCopy)).toHaveCount(0);

  const layout = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
  }));
  expect(layout.scrollWidth).toBe(layout.clientWidth);
});

test("does not clear unread state when conversation messages fail to load", async ({ context, page }) => {
  await addE2eCookie(context);
  let readRequests = 0;
  page.on("request", (request) => {
    if (request.url().endsWith(`/v1/messages/conversations/${unavailableConversationId}/read`)) {
      readRequests += 1;
    }
  });
  await page.goto(`/app/messages?conversation=${unavailableConversationId}`, {
    waitUntil: "domcontentloaded",
    timeout: 45_000
  });

  await expect(page.getByRole("heading", { name: "Conversation unavailable" })).toBeVisible();
  await page.waitForTimeout(500);
  expect(readRequests).toBe(0);
});

test("renders the account notification inbox and marks activity read", async ({ context, page }) => {
  await addE2eCookie(context);
  await page.goto("/app/notifications", { waitUntil: "domcontentloaded", timeout: 45_000 });

  await expect(page.getByRole("heading", { name: "Notifications" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Message request received" })).toBeVisible();
  await page.getByRole("button", { name: "Mark read" }).click();
  await expect(page.getByRole("button", { name: "Mark read" })).toHaveCount(0);
  await expect(page.getByText(rawBackendCopy)).toHaveCount(0);
});

test("keeps content detail route reachable", async ({ page }) => {
  await page.goto("/content/00000000-0000-4000-8000-000000000040", { waitUntil: "domcontentloaded", timeout: 45_000 });
  await expect(page.getByRole("heading", { name: "Content unavailable" })).toBeVisible();
  await expect(page.getByText(rawBackendCopy)).toHaveCount(0);
});

test("runs content engagement actions responsively through canonical API routes", async ({ context, page }) => {
  await addE2eCookie(context);
  await page.goto("/content/00000000-0000-4000-8000-000000000040", {
    waitUntil: "domcontentloaded",
    timeout: 45_000
  });

  await expect(page.getByText("Studio sunrise session")).toBeVisible();
  await page.getByRole("button", { name: "Like" }).click();
  await expect(page.getByRole("button", { name: "Liked" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("129", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("button", { name: "Saved" })).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "Comment" }).click();
  await page.getByRole("textbox", { name: "Comment", exact: true }).fill("Browser-backed comment");
  await page.getByRole("button", { name: "Post comment" }).click();
  await expect(page.getByRole("article").getByText("Browser-backed comment")).toBeVisible();
  await expect(page.getByText("Comment posted.")).toBeVisible();

  await page.getByRole("button", { name: "Share" }).click();
  await expect(page.getByText(/Link copied\.|Share link ready\./)).toBeVisible();

  await page.getByRole("button", { name: "Report", exact: true }).click();
  await page.getByLabel("Report reason").fill("Misleading content metadata");
  await page.getByRole("button", { name: "Submit report" }).click();
  await expect(page.getByText("Report submitted for review.")).toBeVisible();

  await page.getByRole("button", { name: "Creator controls" }).click();
  await page.getByRole("button", { name: "Hide from feed" }).click();
  await expect(page.getByText("Creator hidden from your feed.")).toBeVisible();

  const layout = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
  }));
  expect(layout.scrollWidth).toBe(layout.clientWidth);
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

async function handleApiRequest(request: IncomingMessage, response: ServerResponse) {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", "http://127.0.0.1:4000");
  setCorsHeaders(response);

  if (method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  if (request.headers.authorization !== `Bearer ${e2eToken}`) {
    sendJson(response, 401, { message: "Missing or invalid bearer token" });
    return;
  }

  if (method === "GET" && url.pathname === "/v1/session") {
    sendJson(response, 200, sessionState());
    return;
  }

  if (method === "POST" && url.pathname === "/v1/auth/sessions/logout-all") {
    if (!hasIdempotencyKey(request)) {
      sendJson(response, 400, { message: "Idempotency-Key header is required" });
      return;
    }
    response.writeHead(204);
    response.end();
    return;
  }

  if (method === "GET" && url.pathname === "/v1/content/feed") {
    sendJson(response, 200, {
      items: [contentItem(), contentItem("00000000-0000-4000-8000-000000000041")],
      nextCursor: null,
      mode: url.searchParams.get("mode") ?? "recommended",
      surface: url.searchParams.get("surface") ?? "home",
      rankingVersion: "deterministic_v1",
      generatedAt: "2026-08-15T12:00:00.000Z"
    });
    return;
  }

  if (method === "GET" && url.pathname === `/v1/follows/${user().id}`) {
    sendJson(response, 200, { userId: user().id, following: false, followerCount: 12, followingCount: 4 });
    return;
  }

  if ((method === "POST" || method === "DELETE") && url.pathname === `/v1/follows/${user().id}`) {
    sendJson(response, 200, {
      userId: user().id,
      following: method === "POST",
      followerCount: method === "POST" ? 13 : 12,
      followingCount: 4
    });
    return;
  }

  if (method === "POST" && url.pathname === "/v1/feed/impressions") {
    sendJson(response, 202, { accepted: true });
    return;
  }

  if (method === "GET" && url.pathname === "/v1/content/00000000-0000-4000-8000-000000000040") {
    sendJson(response, 200, contentItem());
    return;
  }

  const engagementMatch = url.pathname.match(
    /^\/v1\/engagement\/(00000000-0000-4000-8000-000000000040)\/(like|save|comments)$/
  );
  if (engagementMatch) {
    if (method === "GET" && engagementMatch[2] === "comments") {
      sendJson(response, 200, { items: [], nextCursor: null });
      return;
    }

    if (method === "POST" && !hasIdempotencyKey(request)) {
      sendJson(response, 400, { message: "Idempotency-Key header is required" });
      return;
    }

    if (method === "POST" && engagementMatch[2] === "like") {
      sendJson(response, 200, engagementState({ liked: true, likeCount: 129 }));
      return;
    }

    if (method === "POST" && engagementMatch[2] === "save") {
      sendJson(response, 200, engagementState({ saved: true }));
      return;
    }

    if (method === "POST" && engagementMatch[2] === "comments") {
      const body = await readJsonBody<{ body?: string }>(request);
      sendJson(response, 201, comment(body.body ?? ""));
      return;
    }
  }

  if (method === "POST" && url.pathname === "/v1/shares") {
    if (!hasIdempotencyKey(request)) {
      sendJson(response, 400, { message: "Idempotency-Key header is required" });
      return;
    }
    sendJson(response, 201, {
      id: "00000000-0000-4000-8000-0000000000c2",
      mode: "copy_link",
      url: "http://127.0.0.1:3000/share/content/00000000-0000-4000-8000-000000000040"
    });
    return;
  }

  if (method === "POST" && url.pathname === "/v1/reports") {
    if (!hasIdempotencyKey(request)) {
      sendJson(response, 400, { message: "Idempotency-Key header is required" });
      return;
    }
    sendJson(response, 201, {
      id: "00000000-0000-4000-8000-0000000000c3",
      state: "queued",
      queue: "content"
    });
    return;
  }

  if (method === "POST" && url.pathname === "/v1/feed/hide-creator") {
    if (!hasIdempotencyKey(request)) {
      sendJson(response, 400, { message: "Idempotency-Key header is required" });
      return;
    }
    sendJson(response, 200, {
      defaultMode: "recommended",
      nsfwPreference: "both",
      hiddenCreatorIds: [user().id],
      hiddenTopics: []
    });
    return;
  }

  if (method === "POST" && url.pathname === `/v1/blocks/${user().id}`) {
    if (!hasIdempotencyKey(request)) {
      sendJson(response, 400, { message: "Idempotency-Key header is required" });
      return;
    }
    sendJson(response, 200, { blocked: true, blockedUserId: user().id });
    return;
  }

  if (method === "GET" && url.pathname === "/v1/platform-access") {
    sendJson(response, 200, platformAccess());
    return;
  }

  if (method === "GET" && url.pathname === "/v1/subscriptions/plans") {
    sendJson(response, 200, { items: subscriptionPlans() });
    return;
  }

  if (method === "GET" && url.pathname === "/v1/subscriptions") {
    sendJson(response, 200, { items: [] });
    return;
  }

  if (method === "GET" && url.pathname === "/v1/messages/conversations") {
    sendJson(response, 200, { items: conversations() });
    return;
  }

  const conversationActionMatch = url.pathname.match(
    /^\/v1\/messages\/conversations\/([0-9a-f-]+)\/(request|read)$/
  );
  if (method === "PATCH" && conversationActionMatch) {
    if (!hasIdempotencyKey(request)) {
      sendJson(response, 400, { message: "Idempotency-Key header is required" });
      return;
    }
    const conversationId = conversationActionMatch[1]!;
    if (conversationActionMatch[2] === "read") {
      sendJson(response, 200, {
        conversationId,
        unreadCount: 0,
        readAt: "2026-08-15T12:05:00.000Z"
      });
      return;
    }
    sendJson(response, 200, {
      ...conversation(conversationId, "Production notes", "Second thread message", 0, "accepted"),
      requestRole: "recipient",
      canSend: true
    });
    return;
  }

  if (method === "GET" && url.pathname === "/v1/notifications") {
    sendJson(response, 200, { items: [notification("unread")], nextCursor: null });
    return;
  }

  if (
    method === "PATCH" &&
    url.pathname === "/v1/notifications/00000000-0000-4000-8000-0000000000d1/read"
  ) {
    if (!hasIdempotencyKey(request)) {
      sendJson(response, 400, { message: "Idempotency-Key header is required" });
      return;
    }
    sendJson(response, 200, notification("read"));
    return;
  }

  const conversationMessagesMatch = url.pathname.match(
    /^\/v1\/messages\/conversations\/([0-9a-f-]+)\/messages$/
  );
  if (method === "GET" && conversationMessagesMatch) {
    const conversationId = conversationMessagesMatch[1];
    if (conversationId === unavailableConversationId) {
      sendJson(response, 503, { message: "Transient message projection failure" });
      return;
    }
    if (conversationId !== firstConversationId && conversationId !== secondConversationId) {
      sendJson(response, 404, { message: "Conversation not found" });
      return;
    }

    sendJson(response, 200, {
      items: [
        message(
          conversationId,
          conversationId === secondConversationId ? "Second thread message" : "First thread message"
        )
      ],
      nextCursor: null
    });
    return;
  }

  if (method === "GET" && url.pathname === "/v1/discover/search") {
    sendJson(response, 200, {
      content: [contentItem()],
      creators: [user()],
      hashtags: [{ slug: "studio", displayName: "Studio", state: "active" }],
      events: [],
      liveRooms: [liveRoom()],
      nextCursor: null
    });
    return;
  }

  sendJson(response, 503, { message: "Route unavailable in smoke API" });
}

function setCorsHeaders(response: ServerResponse) {
  response.setHeader("Access-Control-Allow-Origin", "http://127.0.0.1:3000");
  response.setHeader("Access-Control-Allow-Credentials", "true");
  response.setHeader("Access-Control-Allow-Headers", "authorization,content-type,idempotency-key,accept");
  response.setHeader("Access-Control-Allow-Methods", "DELETE,GET,POST,PATCH,OPTIONS");
}

function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function hasIdempotencyKey(request: IncomingMessage) {
  return typeof request.headers["idempotency-key"] === "string";
}

async function readJsonBody<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}

function user() {
  return {
    id: "00000000-0000-4000-8000-000000000010",
    handle: "ariamoon",
    displayName: "Aria Moon",
    avatarUrl: null,
    badges: [{ key: "age_verified", label: "Age verified", group: "trust" }]
  };
}

function sessionState() {
  return {
    authenticated: true,
    appAccessState: { allowed: true, reason: "ready" },
    user: {
      id: "00000000-0000-4000-8000-000000000009",
      handle: "viewer",
      displayName: "Viewer",
      avatarUrl: null,
      badges: [{ key: "age_verified", label: "Age verified", group: "trust" }]
    }
  };
}

function platformAccess() {
  const tiers = [
    platformTier("free_verified", "Free Verified", 0, 0, "included", null),
    platformTier("veel_plus", "Veel Plus", 1, 500, "available", "platform-plus"),
    platformTier("veel_ultra", "Veel Ultra", 2, 1_500, "available", "platform-ultra"),
    platformTier("veel_studio", "Veel Studio", 3, 3_000, "available", "platform-studio"),
    platformTier("enterprise", "Enterprise", 4, null, "contact_sales", null)
  ];

  return {
    currentTier: tiers[0],
    usage: {
      windowStartsAt: "2026-08-01T00:00:00.000Z",
      windowEndsAt: "2026-09-01T00:00:00.000Z",
      publicMediaSeconds: 7_200,
      remainingPublicMediaSeconds: 28_800,
      limitReached: false
    },
    tiers,
    policyBoundary: "platform_tiers_buy_software_and_public_media_allowance_never_social_priority"
  };
}

function platformTier(
  key: string,
  label: string,
  rank: number,
  monthlyPriceMinor: number | null,
  purchaseState: string,
  subscriptionPlanId: string | null
) {
  return {
    key,
    label,
    rank,
    monthlyPriceMinor,
    currency: monthlyPriceMinor === null ? null : "USDC",
    publicMediaAllowanceSeconds: key === "enterprise" ? null : 36_000 * (rank + 1),
    capabilities: [],
    purchaseState,
    subscriptionPlanId
  };
}

function subscriptionPlans() {
  return [
    subscriptionPlan("platform-plus", "Veel Plus", 500),
    subscriptionPlan("platform-ultra", "Veel Ultra", 1_500),
    subscriptionPlan("platform-studio", "Veel Studio", 3_000)
  ];
}

function subscriptionPlan(id: string, label: string, amountMinor: number) {
  return {
    id,
    scope: "platform",
    label,
    amountMinor,
    currency: "USDC",
    periodDays: 30,
    billingMode: "delegated_solana_subscription",
    providerState: "staging_required",
    provider: "official_solana_subscription_program",
    tokenMint: null,
    tokenProgram: null
  };
}

function conversations() {
  return [
    conversation(firstConversationId, "Studio team", "First thread message", 0, "accepted"),
    conversation(secondConversationId, "Production notes", "Second thread message", 2, "pending"),
    conversation(unavailableConversationId, "Unavailable thread", "Unread message", 1, "pending")
  ];
}

function conversation(
  id: string,
  title: string,
  body: string,
  unreadCount: number,
  requestState: "accepted" | "pending"
) {
  return {
    id,
    type: "direct",
    title,
    unreadCount,
    counterpart: user(),
    requestState,
    requestRole: "recipient",
    canSend: requestState === "accepted",
    lastMessage: {
      body,
      sender: user(),
      createdAt: "2026-08-11T10:00:00.000Z"
    }
  };
}

function notification(state: "unread" | "read") {
  return {
    id: "00000000-0000-4000-8000-0000000000d1",
    kind: "message",
    title: "Message request received",
    body: "Aria Moon would like to start a conversation.",
    actionUrl: `/app/messages?conversation=${secondConversationId}`,
    state,
    relatedResource: { type: "message", id: secondConversationId },
    createdAt: "2026-08-15T12:00:00.000Z",
    readAt: state === "read" ? "2026-08-15T12:05:00.000Z" : null
  };
}

function message(conversationId: string, body: string) {
  return {
    id: conversationId === firstConversationId
      ? "00000000-0000-4000-8000-000000000091"
      : "00000000-0000-4000-8000-000000000092",
    conversationId,
    sender: user(),
    body,
    deliveryState: "visible",
    paymentIntentId: null,
    createdAt: "2026-08-11T10:00:00.000Z"
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

function contentItem(id = "00000000-0000-4000-8000-000000000040") {
  return {
    id,
    creator: user(),
    mediaType: "clip",
    caption: "Studio sunrise session",
    posterUrl: null,
    playback: {
      state: "full",
      url: "https://media.example.test/studio.mp4",
      provider: "bunny",
      resourceType: "direct",
      expiresAt: null
    },
    accessState: "free",
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

function engagementState(overrides: Partial<ReturnType<typeof contentItem>["engagement"]> = {}) {
  return { ...contentItem().engagement, ...overrides };
}

function comment(body: string) {
  return {
    id: "00000000-0000-4000-8000-0000000000c1",
    author: user(),
    body,
    moderationState: "visible",
    createdAt: "2026-08-11T12:00:00.000Z"
  };
}
