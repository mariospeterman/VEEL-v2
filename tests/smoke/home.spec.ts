import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { expect, test } from "@playwright/test";
import type { BrowserContext } from "@playwright/test";

const rawBackendCopy = /HTTP (401|403|404|429|500|503)|Missing or invalid bearer token|API is unavailable/;
const e2eToken = "veel-e2e-token";
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

  await expect(page.getByRole("heading", { name: "Login to WeVid" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect wallet" })).toBeVisible();
  await expect(page.getByText("Privy", { exact: true })).toBeVisible();
  await expect(page.getByText("Turnkey", { exact: true })).toBeVisible();

  await page.goto("/?mode=onboarding", { waitUntil: "domcontentloaded", timeout: 20_000 });

  await expect(page.getByRole("heading", { name: "Set up access." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect wallet" })).toBeVisible();
  await expect(page.getByText("Required. Use Solana Connect, or create an embedded non-custodial wallet with WeVid.")).toBeVisible();
});

test("renders the standalone age handoff without raw API/provider errors", async ({ page }) => {
  await page.goto("/age");

  await expect(page.getByRole("heading", { name: "Provider-backed 18+ gate" })).toBeVisible();
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
  await expect(page.getByRole("heading", { name: /Mixed media feed|Enter WeVid/ }).first()).toBeVisible();
  await expect(page.getByText(rawBackendCopy)).toHaveCount(0);
});

test("keeps content detail route reachable", async ({ page }) => {
  await page.goto("/content/00000000-0000-4000-8000-000000000040", { waitUntil: "domcontentloaded", timeout: 45_000 });
  await expect(page.getByRole("heading", { name: "Content unavailable" })).toBeVisible();
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

  if (method === "GET" && url.pathname === "/v1/content/feed") {
    sendJson(response, 200, { items: [contentItem()], nextCursor: null });
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
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");
}

function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
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
    user: user()
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

function contentItem() {
  return {
    id: "00000000-0000-4000-8000-000000000040",
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
    }
  };
}
