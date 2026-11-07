import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { expect, test, type BrowserContext, type Page, type Route } from "@playwright/test";

const e2eToken = "veel-e2e-token";
const e2eOrigin = new URL(process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000").origin;
const viewerUserId = "00000000-0000-4000-8000-000000000009";
const creatorUserId = "00000000-0000-4000-8000-000000000010";
const expiringContentId = contentId(1);
const revokedContentId = contentId(2);
const imageBytes = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

type FeedScenario = "images" | "window";

let apiServer: Server;
let feedScenario: FeedScenario = "window";
let renewalRequestCount = 0;
let revokedRequestCount = 0;
let sessionRequestCount = 0;
let markRenewalStarted: () => void = () => undefined;
let releaseRenewal: () => void = () => undefined;
let renewalStarted = Promise.resolve();
let renewalRelease = Promise.resolve();

test.beforeAll(async () => {
  apiServer = createServer(async (request, response) => {
    try {
      await handleApiRequest(request, response);
    } catch (error) {
      sendJson(response, 500, {
        message: error instanceof Error ? error.message : "Feed reliability mock failed"
      });
    }
  });

  await new Promise<void>((resolve, reject) => {
    apiServer.once("error", reject);
    apiServer.listen(4000, "127.0.0.1", () => {
      apiServer.off("error", reject);
      resolve();
    });
  });
});

test.afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    apiServer.close((error) => error ? reject(error) : resolve());
  });
});

test.beforeEach(() => {
  feedScenario = "window";
  renewalRequestCount = 0;
  revokedRequestCount = 0;
  sessionRequestCount = 0;
  renewalStarted = new Promise<void>((resolve) => { markRenewalStarted = resolve; });
  renewalRelease = new Promise<void>((resolve) => { releaseRenewal = resolve; });
});

test("windows 85 cards in both directions and restores the same feed view after Back", async ({ context, page }) => {
  test.setTimeout(90_000);
  await addE2eCookie(context);
  await page.goto("/app/home", { waitUntil: "domcontentloaded", timeout: 45_000 });
  await waitForClientReady(page);
  await expect(page.locator(".home-feed")).toHaveAttribute("data-scroll-persistence", "ready");
  await expect(page.locator(".home-feed [data-content-id]")).toHaveCount(60);
  await installFeedMountProbe(page);

  await scrollFeedTo(page, "end");
  await expect.poll(async () => (await mountedPositions(page)).at(-1)).toBe(85);
  const forwardRange = await mountedPositions(page);
  expect(forwardRange[0]).toBeGreaterThan(1);
  expect(forwardRange).toHaveLength(60);

  const targetPosition = 75;
  const targetId = contentId(targetPosition);
  const target = page.locator(`[data-feed-position="${targetPosition}"]`);
  await target.scrollIntoViewIfNeeded();
  await expect(target).toBeInViewport();
  await expect.poll(() => sessionRequestCount).toBeGreaterThanOrEqual(2);

  const viewBeforeNavigation = await currentFeedView(page);
  await target.getByRole("link", { name: "Open post" }).click();
  await page.waitForURL(new RegExp(`/content/${targetId}$`));
  await expect(page.getByText(`Feed post ${targetPosition}`, { exact: true })).toBeVisible();

  await page.goBack();
  await page.waitForURL(/\/app\/home$/);
  await waitForClientReady(page);
  await expect(page.locator(".home-feed")).toHaveAttribute("data-scroll-persistence", "ready");
  await expect.poll(async () => {
    const range = await mountedPositions(page);
    return range.includes(targetPosition);
  }).toBe(true);
  await expect.poll(async () => {
    const restored = await currentFeedView(page);
    return Math.abs(restored.scrollTop - viewBeforeNavigation.scrollTop);
  }).toBeLessThan(80);
  await installFeedMountProbe(page);

  await scrollFeedTo(page, "start");
  await expect.poll(async () => (await mountedPositions(page))[0]).toBe(1);
  const reverseRange = await mountedPositions(page);
  expect(reverseRange.at(-1)).toBe(60);
  expect(reverseRange).toHaveLength(60);
  expect(await maximumMountedCards(page)).toBeLessThanOrEqual(60);
});

test("renews an expiring signed image and fails closed after revoked image access", async ({ context, page }) => {
  feedScenario = "images";
  await addE2eCookie(context);
  await page.route("https://images.example.test/**", fulfillProofImage);
  await page.goto("/app/home", { waitUntil: "domcontentloaded", timeout: 45_000 });
  await waitForClientReady(page);

  const expiringArticle = page.locator(`[data-content-id="${expiringContentId}"]`);
  const expiringImage = expiringArticle.getByAltText("Expiring proof image");
  await expect(expiringImage).toHaveAttribute("src", "https://images.example.test/expiry-old.png");
  await renewalStarted;
  expect(renewalRequestCount).toBe(1);
  releaseRenewal();
  await expect(expiringImage).toHaveAttribute(
    "src",
    "https://images.example.test/expiry-renewed.png"
  );

  const revokedArticle = page.locator(`[data-content-id="${revokedContentId}"]`);
  await revokedArticle.scrollIntoViewIfNeeded();
  const revokedImage = revokedArticle.getByAltText("Revoked proof image");
  await expect(revokedImage).toHaveAttribute("src", "https://images.example.test/revoked-old.png");
  await revokedImage.dispatchEvent("error");
  await expect.poll(() => revokedRequestCount).toBe(1);
  await expect(revokedArticle.getByText("Media unavailable", { exact: true })).toBeVisible();
  await expect(revokedArticle.getByText(/access changed or this media is no longer available/i)).toBeVisible();
  await page.waitForTimeout(500);
  expect(revokedRequestCount).toBe(1);
  expect(renewalRequestCount).toBe(1);
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
    sessionRequestCount += 1;
    sendJson(response, 200, sessionState());
    return;
  }

  if (method === "GET" && url.pathname === "/v1/feed/preferences") {
    sendJson(response, 200, {
      defaultMode: "latest",
      nsfwPreference: "both",
      hiddenCreatorIds: [],
      hiddenTopics: []
    });
    return;
  }

  if (method === "GET" && url.pathname === "/v1/content/feed") {
    const surface = url.searchParams.get("surface") ?? "home";
    const items = surface === "home"
      ? feedScenario === "window" ? windowFeedItems() : imageFeedItems()
      : [];
    sendJson(response, 200, {
      items,
      nextCursor: null,
      mode: url.searchParams.get("mode") ?? "latest",
      surface,
      rankingVersion: "chronological_v1",
      generatedAt: "2026-11-05T06:00:00.000Z"
    });
    return;
  }

  if (method === "GET" && url.pathname === "/v1/discover/search") {
    sendJson(response, 200, {
      content: [],
      creators: [],
      hashtags: [],
      events: [],
      liveRooms: [],
      nextCursors: {
        content: null,
        creators: null,
        hashtags: null,
        events: null,
        liveRooms: null
      }
    });
    return;
  }

  if (method === "POST" && url.pathname === "/v1/feed/impressions") {
    sendJson(response, 202, { accepted: true });
    return;
  }

  if (method === "GET" && url.pathname === `/v1/content/${expiringContentId}`) {
    renewalRequestCount += 1;
    markRenewalStarted();
    await renewalRelease;
    sendJson(response, 200, imageContentItem({
      altText: "Expiring proof image",
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      id: expiringContentId,
      imageName: "expiry-renewed.png",
      position: 1
    }));
    return;
  }

  if (method === "GET" && url.pathname === `/v1/content/${revokedContentId}`) {
    revokedRequestCount += 1;
    sendJson(response, 403, { message: "Image access was revoked" });
    return;
  }

  const contentMatch = url.pathname.match(/^\/v1\/content\/(00000000-0000-4000-8000-\d{12})$/);
  if (method === "GET" && contentMatch) {
    const position = Number(contentMatch[1]?.slice(-12));
    sendJson(response, 200, textContentItem(position));
    return;
  }

  if (method === "POST" && url.pathname === "/v1/realtime/connection-events") {
    response.writeHead(204);
    response.end();
    return;
  }

  sendJson(response, 503, { message: "Route unavailable in feed reliability mock" });
}

function windowFeedItems() {
  return Array.from({ length: 85 }, (_, index) => textContentItem(index + 1));
}

function imageFeedItems() {
  return [
    imageContentItem({
      altText: "Expiring proof image",
      expiresAt: new Date(Date.now() + 1_000).toISOString(),
      id: expiringContentId,
      imageName: "expiry-old.png",
      position: 1
    }),
    imageContentItem({
      altText: "Revoked proof image",
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      id: revokedContentId,
      imageName: "revoked-old.png",
      position: 2
    })
  ];
}

function textContentItem(position: number) {
  return {
    id: contentId(position),
    creator: creator(),
    mediaType: "text",
    distributionMode: "post",
    caption: `Feed post ${position}`,
    bodyText: `Retained feed card ${position}`,
    compositionRevision: 1,
    posterUrl: null,
    accessState: "free",
    nsfwLabel: "none",
    engagement: engagement(),
    viewerFollowingCreator: false
  };
}

function imageContentItem(input: {
  altText: string;
  expiresAt: string;
  id: string;
  imageName: string;
  position: number;
}) {
  const imageUrl = `https://images.example.test/${input.imageName}`;
  return {
    id: input.id,
    creator: creator(),
    mediaType: "image",
    distributionMode: "post",
    caption: `Image proof ${input.position}`,
    compositionRevision: 1,
    posterUrl: imageUrl,
    mediaAssets: [{
      id: `10000000-0000-4000-8000-${String(input.position).padStart(12, "0")}`,
      kind: "image",
      position: 0,
      provider: "bunny",
      providerState: "ready",
      posterUrl: imageUrl,
      imageDelivery: {
        url: imageUrl,
        expiresAt: input.expiresAt,
        variants: [{ widthPixels: 640, url: imageUrl }]
      },
      mimeType: "image/png",
      widthPixels: 1,
      heightPixels: 1,
      altText: input.altText,
      requiredForRelease: true,
      isCover: true,
      originClassification: "human_created"
    }],
    accessState: "free",
    nsfwLabel: "none",
    engagement: engagement(),
    viewerFollowingCreator: false
  };
}

function creator() {
  return {
    id: creatorUserId,
    handle: "windowtester",
    displayName: "Window Tester",
    avatarUrl: null,
    badges: [{ key: "age_verified", label: "Age verified", group: "trust" }]
  };
}

function engagement() {
  return {
    liked: false,
    saved: false,
    likeCount: 0,
    commentCount: 0,
    shareCount: 0
  };
}

function sessionState() {
  return {
    authenticated: true,
    clientSessionScope: "f".repeat(43),
    appAccessState: { allowed: true, reason: "ready" },
    user: {
      id: viewerUserId,
      handle: "feedviewer",
      displayName: "Feed Viewer",
      avatarUrl: null,
      badges: [{ key: "age_verified", label: "Age verified", group: "trust" }]
    }
  };
}

function contentId(position: number) {
  return `00000000-0000-4000-8000-${String(position).padStart(12, "0")}`;
}

async function addE2eCookie(context: BrowserContext) {
  await context.addCookies([{
    name: "veel_e2e_access_token",
    value: e2eToken,
    url: e2eOrigin,
    httpOnly: false,
    sameSite: "Lax"
  }]);
}

async function waitForClientReady(page: Page) {
  await page.waitForFunction(() => document.documentElement.dataset.clientReady === "true");
}

async function scrollFeedTo(page: Page, edge: "end" | "start") {
  await page.locator(".page-frame").evaluate((element, requestedEdge) => {
    element.scrollTo({ top: requestedEdge === "end" ? element.scrollHeight : 0 });
  }, edge);
}

async function mountedPositions(page: Page) {
  return page.locator(".home-feed [data-feed-position]").evaluateAll((elements) =>
    elements.map((element) => Number((element as HTMLElement).dataset.feedPosition))
  );
}

async function currentFeedView(page: Page) {
  const positions = await mountedPositions(page);
  const scrollTop = await page.locator(".page-frame").evaluate((element) => element.scrollTop);
  return { positions, scrollTop };
}

async function installFeedMountProbe(page: Page) {
  await page.evaluate(() => {
    const root = document.querySelector(".home-feed");
    if (!root) throw new Error("Home feed was not mounted");
    const probeWindow = window as typeof window & { __wevidMaximumMountedFeedCards?: number };
    const record = () => {
      const count = root.querySelectorAll("[data-content-id]").length;
      probeWindow.__wevidMaximumMountedFeedCards = Math.max(
        probeWindow.__wevidMaximumMountedFeedCards ?? 0,
        count
      );
    };
    record();
    new MutationObserver(record).observe(root, { childList: true, subtree: true });
  });
}

async function maximumMountedCards(page: Page) {
  return page.evaluate(() =>
    (window as typeof window & { __wevidMaximumMountedFeedCards?: number })
      .__wevidMaximumMountedFeedCards ?? 0
  );
}

async function fulfillProofImage(route: Route) {
  if (new URL(route.request().url()).pathname.includes("revoked-old")) {
    await route.abort("failed");
    return;
  }
  await route.fulfill({ body: imageBytes, contentType: "image/png", status: 200 });
}

function setCorsHeaders(response: ServerResponse) {
  response.setHeader("Access-Control-Allow-Origin", e2eOrigin);
  response.setHeader("Access-Control-Allow-Credentials", "true");
  response.setHeader(
    "Access-Control-Allow-Headers",
    "authorization,content-type,idempotency-key,accept,x-wevid-expected-actor-id"
  );
  response.setHeader("Access-Control-Allow-Methods", "DELETE,GET,POST,PATCH,OPTIONS");
}

function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}
