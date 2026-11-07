import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { expect, test } from "@playwright/test";
import type { BrowserContext, Page } from "@playwright/test";
import type { PendingPaymentSubmission } from "../../apps/web/src/payment-submission-recovery";

const e2eToken = "veel-e2e-token";
const e2eOrigin = new URL(process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000").origin;
const actorUserId = "00000000-0000-4000-8000-000000000010";
const alternateActorUserId = "00000000-0000-4000-8000-000000000099";
const contentId = "00000000-0000-4000-8000-000000000140";
const paymentIntentId = "00000000-0000-4000-8000-000000000150";
const freshPaymentIntentId = "00000000-0000-4000-8000-000000000151";
const recoveryScope = `content_unlock:${contentId}`;
const clientSessionScope = "s".repeat(43);

interface SubmissionCall {
  idempotencyKey: string | undefined;
  signature: unknown;
  signedTransactionBase64: unknown;
}

let apiServer: Server;
let activeActorUserId = actorUserId;
let intentState: "pending" | "confirmed" | "expired" = "pending";
let stallFirstSubmissionBody = false;
let confirmAfterSuccessfulRetry = false;
let expireAfterSuccessfulRetry = false;
let freshIntentCreates = 0;
const submissionCalls: SubmissionCall[] = [];

test.beforeAll(async () => {
  apiServer = createServer(async (request, response) => {
    try {
      await handleApiRequest(request, response);
    } catch (error) {
      setCorsHeaders(response);
      sendJson(response, 500, {
        message: error instanceof Error ? error.message : "Mock API error"
      });
    }
  });

  await new Promise<void>((resolve) => {
    apiServer.listen(4000, "127.0.0.1", resolve);
  });
});

test.afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    apiServer.close((error) => error ? reject(error) : resolve());
  });
});

test.beforeEach(async ({ context }) => {
  activeActorUserId = actorUserId;
  intentState = "pending";
  stallFirstSubmissionBody = false;
  confirmAfterSuccessfulRetry = false;
  expireAfterSuccessfulRetry = false;
  freshIntentCreates = 0;
  submissionCalls.length = 0;
  await context.addCookies([{
    name: "veel_e2e_access_token",
    value: e2eToken,
    url: e2eOrigin,
    httpOnly: false,
    sameSite: "Lax"
  }]);
});

test("retries one retained signature after a mounted response-body hang and parent rerender", async ({
  context,
  page
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "One mounted browser proof is sufficient.");
  test.setTimeout(60_000);
  stallFirstSubmissionBody = true;
  confirmAfterSuccessfulRetry = true;
  const record = createSignedRecoveryRecord();
  const rpcTransactions: string[] = [];
  await installRpcRecorder(context, record.signature, rpcTransactions);
  await retainPaymentRecord(page, record);

  await page.goto(`/content/${contentId}`);
  await expect(page.getByText(/Reusing the retained signed transaction/)).toBeVisible({
    timeout: 15_000
  });
  await expect.poll(() => submissionCalls.length, { timeout: 15_000 }).toBe(1);

  // The first response has delivered its 202 headers but never completes its body. The mounted
  // parent rerenders after onSubmitted; recovery must keep its deadline and subsequent retry alive.
  await expect.poll(() => submissionCalls.length, { timeout: 25_000 }).toBeGreaterThanOrEqual(3);
  await expect.poll(() => rpcTransactions.length).toBeGreaterThanOrEqual(1);

  expectExactRecoveryReplay(record, rpcTransactions);
  expect(submissionCalls[0]).toEqual({
    idempotencyKey: record.idempotencyKey,
    signature: record.signature,
    signedTransactionBase64: record.signedTransactionBase64
  });
});

test("clears a backend-expired retained submission and creates a fresh intent on retry", async ({
  context,
  page
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "One mounted browser proof is sufficient.");
  test.setTimeout(60_000);
  expireAfterSuccessfulRetry = true;
  const record = createSignedRecoveryRecord();
  record.intentExpiresAt = "2020-01-01T00:00:00.000Z";
  record.quote.expiresAt = record.intentExpiresAt;
  const rpcTransactions: string[] = [];
  await installRpcRecorder(context, record.signature, rpcTransactions);
  await retainPaymentRecord(page, record);

  await page.goto(`/content/${contentId}`);
  await expect.poll(() => submissionCalls.length, { timeout: 20_000 }).toBeGreaterThanOrEqual(2);
  await expect(page.getByText("Payment expired", { exact: true })).toBeVisible({ timeout: 20_000 });
  expect(rpcTransactions).toHaveLength(0);
  await expect.poll(() => page.evaluate((key) => window.localStorage.getItem(key), recoveryStorageKey(record)))
    .toBeNull();

  await page.getByRole("button", { name: "Try again" }).click();
  await expect.poll(() => freshIntentCreates).toBe(1);
  await expect(page.getByText("I accept the checkout terms.", { exact: true })).toBeVisible();
});

test("reuses the same bytes across remounts and tabs, while an account switch cannot claim them", async ({
  context,
  page
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "One mounted browser proof is sufficient.");
  test.setTimeout(90_000);
  const record = createSignedRecoveryRecord();
  const rpcTransactions: string[] = [];
  await installRpcRecorder(context, record.signature, rpcTransactions);
  await retainPaymentRecord(page, record);

  await page.goto(`/content/${contentId}`);
  await expect.poll(() => rpcTransactions.length, { timeout: 15_000 }).toBeGreaterThanOrEqual(1);

  await page.reload();
  await expect.poll(() => rpcTransactions.length, { timeout: 15_000 }).toBeGreaterThanOrEqual(2);

  activeActorUserId = alternateActorUserId;
  const callsBeforeAccountSwitch = submissionCalls.length;
  const broadcastsBeforeAccountSwitch = rpcTransactions.length;
  await page.reload();
  await expect(page.getByRole("button", { name: "Unlock content" })).toBeVisible();
  await page.waitForTimeout(1_000);
  expect(submissionCalls).toHaveLength(callsBeforeAccountSwitch);
  expect(rpcTransactions).toHaveLength(broadcastsBeforeAccountSwitch);

  activeActorUserId = actorUserId;
  await page.reload();
  await expect.poll(
    () => rpcTransactions.length,
    { timeout: 15_000 }
  ).toBeGreaterThan(broadcastsBeforeAccountSwitch);

  const secondTab = await context.newPage();
  await secondTab.goto(`/content/${contentId}`);
  await expect(secondTab.getByText(/Reusing the retained signed transaction/)).toBeVisible({
    timeout: 15_000
  });
  await expect.poll(
    () => rpcTransactions.length,
    { timeout: 15_000 }
  ).toBeGreaterThan(broadcastsBeforeAccountSwitch + 1);

  expectExactRecoveryReplay(record, rpcTransactions);
  expect(submissionCalls.length).toBeGreaterThanOrEqual(6);
  await secondTab.close();
});

test("allows only one cross-tab Solana broadcast while the real RPC call is still in flight", async ({
  context,
  page
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Web Locks ownership is Chromium-covered.");
  test.setTimeout(45_000);
  const record = createSignedRecoveryRecord();
  const rpcTransactions: string[] = [];
  const releaseFirstBroadcast = await installRpcRecorder(
    context,
    record.signature,
    rpcTransactions,
    { holdFirstBroadcast: true }
  );
  await retainPaymentRecord(page, record);

  await page.goto(`/content/${contentId}`);
  await expect.poll(() => rpcTransactions.length, { timeout: 15_000 }).toBe(1);

  const secondTab = await context.newPage();
  try {
    await secondTab.goto(`/content/${contentId}`);
    await expect(secondTab.getByText(/Reusing the retained signed transaction/)).toBeVisible({
      timeout: 15_000
    });
    await secondTab.waitForTimeout(1_000);
    expect(rpcTransactions).toHaveLength(1);
  } finally {
    releaseFirstBroadcast();
    await secondTab.close();
  }
});

async function installRpcRecorder(
  context: BrowserContext,
  expectedSignature: string,
  transactions: string[],
  options: { holdFirstBroadcast?: boolean } = {}
): Promise<() => void> {
  let releaseFirstBroadcast!: () => void;
  const firstBroadcastGate = new Promise<void>((resolve) => {
    releaseFirstBroadcast = resolve;
  });
  await context.route("https://api.devnet.solana.com/**", async (route) => {
    const payload = route.request().postDataJSON() as {
      id: string | number;
      method: string;
      params?: unknown[];
    };
    if (payload.method !== "sendTransaction" || typeof payload.params?.[0] !== "string") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ jsonrpc: "2.0", id: payload.id, error: { code: -32601, message: "Unexpected RPC" } })
      });
      return;
    }

    transactions.push(payload.params[0]);
    if (options.holdFirstBroadcast && transactions.length === 1) {
      await firstBroadcastGate;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ jsonrpc: "2.0", id: payload.id, result: expectedSignature })
    });
  });
  return releaseFirstBroadcast;
}

async function retainPaymentRecord(
  page: Page,
  record: PendingPaymentSubmission
) {
  // A same-origin static asset is sufficient to seed localStorage and avoids compiling the
  // unrelated landing page before each payment-recovery proof when the suite uses `next dev`.
  await page.goto("/manifest.webmanifest");
  await page.evaluate(({ key, value }) => {
    window.localStorage.setItem(key, value);
  }, {
    key: recoveryStorageKey(record),
    value: JSON.stringify(record)
  });
}

function expectExactRecoveryReplay(record: PendingPaymentSubmission, rpcTransactions: string[]) {
  expect(new Set(rpcTransactions)).toEqual(new Set([record.signedTransactionBase64]));
  expect(new Set(submissionCalls.map((call) => call.signature))).toEqual(new Set([record.signature]));
  expect(new Set(submissionCalls.map((call) => call.signedTransactionBase64))).toEqual(
    new Set([record.signedTransactionBase64])
  );
  expect(new Set(submissionCalls.map((call) => call.idempotencyKey))).toEqual(
    new Set([record.idempotencyKey])
  );
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
  if (request.headers.authorization !== `Bearer ${e2eToken}`) {
    sendJson(response, 401, { message: "Missing or invalid bearer token" });
    return;
  }

  if (method === "GET" && url.pathname === "/v1/session") {
    sendJson(response, 200, sessionState());
    return;
  }
  if (method === "GET" && url.pathname === `/v1/content/${contentId}`) {
    sendJson(response, 200, contentItem());
    return;
  }
  if (method === "GET" && url.pathname === `/v1/payments/intents/${paymentIntentId}`) {
    sendJson(response, 200, paymentIntent());
    return;
  }
  if (method === "POST" && url.pathname === `/v1/content/${contentId}/unlock-intents`) {
    freshIntentCreates += 1;
    sendJson(response, 201, {
      state: "payment_required",
      contentId,
      paymentIntent: { ...paymentIntent(freshPaymentIntentId), state: "pending" }
    });
    return;
  }
  if (method === "POST" && url.pathname === `/v1/payments/intents/${paymentIntentId}/submissions`) {
    const body = await readJsonBody(request);
    submissionCalls.push({
      idempotencyKey: typeof request.headers["idempotency-key"] === "string"
        ? request.headers["idempotency-key"]
        : undefined,
      signature: body.signature,
      signedTransactionBase64: body.signedTransactionBase64
    });

    if (stallFirstSubmissionBody && submissionCalls.length === 1) {
      response.writeHead(202, { "content-type": "application/json" });
      response.flushHeaders();
      return;
    }
    response.writeHead(202, { "content-length": "0" });
    response.end();
    if (confirmAfterSuccessfulRetry && submissionCalls.length >= 3) intentState = "confirmed";
    if (expireAfterSuccessfulRetry && submissionCalls.length >= 2) intentState = "expired";
    return;
  }

  sendJson(response, 404, { message: `Unhandled test route: ${method} ${url.pathname}` });
}

function setCorsHeaders(response: ServerResponse) {
  response.setHeader("Access-Control-Allow-Origin", e2eOrigin);
  response.setHeader("Access-Control-Allow-Credentials", "true");
  response.setHeader(
    "Access-Control-Allow-Headers",
    "authorization,content-type,idempotency-key,accept,x-wevid-expected-actor-id"
  );
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
}

function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

function sessionState() {
  return {
    authenticated: true,
    clientSessionScope,
    appAccessState: { allowed: true, reason: "ready" },
    user: {
      id: activeActorUserId,
      handle: activeActorUserId === actorUserId ? "ariamoon" : "otheraccount",
      displayName: activeActorUserId === actorUserId ? "Aria Moon" : "Other Account",
      avatarUrl: null,
      badges: []
    }
  };
}

function contentItem() {
  return {
    id: contentId,
    creator: {
      id: actorUserId,
      handle: "ariamoon",
      displayName: "Aria Moon",
      avatarUrl: null,
      badges: []
    },
    mediaType: "clip",
    distributionMode: "post",
    caption: "Recovery test post",
    posterUrl: null,
    playback: {
      state: "blocked",
      url: null,
      provider: "none",
      resourceType: null,
      expiresAt: null
    },
    accessState: "locked",
    nsfwLabel: "adult",
    engagement: {
      liked: false,
      saved: false,
      likeCount: 0,
      commentCount: 0,
      shareCount: 0
    },
    viewerFollowingCreator: false
  };
}

function paymentIntent(id = paymentIntentId) {
  return {
    id,
    productType: "content_unlock",
    amountMinor: 15_000_000,
    currency: "USDC",
    state: intentState,
    settlementKind: "creator_split",
    creatorSideProceedsMinor: 12_750_000,
    creatorAmountMinor: 12_750_000,
    enterpriseManagementAmountMinor: 0,
    platformFeeGrossMinor: 2_250_000,
    platformFeeAmountMinor: 2_250_000,
    referralAmountMinor: 0,
    quote: {
      minimumAmountMinor: 1,
      platformFeeBps: 1_500,
      referralShareOfPlatformFeeBps: 0,
      quotedAt: "2026-11-06T12:00:00.000Z",
      expiresAt: "2027-01-01T00:00:00.000Z",
      policySource: "environment_default",
      policyRevision: 1
    },
    refundPolicy: {
      termsVersion: "veel-terms-v1",
      withdrawalWaiverVersion: "instant-digital-access-v1",
      withdrawalWaiverRequired: true,
      withdrawalWaiverAcceptedAt: "2026-11-06T12:00:00.000Z",
      durableConfirmationRequired: true,
      refundValueBasis: "original_crypto_amount"
    }
  };
}

function createSignedRecoveryRecord(): PendingPaymentSubmission {
  return {
    schemaVersion: 1,
    actorUserId,
    clientSessionScope,
    recoveryScope,
    intentId: paymentIntentId,
    walletAddress: "Zf5pao8zUaju2hqNpJwrh25ZZrxqNzj2VsY1cGwYcSA",
    quote: {
      productType: "content_unlock",
      amountMinor: 15_000_000,
      currency: "USDC",
      settlementKind: "creator_split",
      creatorSideProceedsMinor: 12_750_000,
      creatorAmountMinor: 12_750_000,
      enterpriseManagementAmountMinor: 0,
      platformFeeGrossMinor: 2_250_000,
      platformFeeAmountMinor: 2_250_000,
      referralAmountMinor: 0,
      minimumAmountMinor: 1,
      platformFeeBps: 1_500,
      referralShareOfPlatformFeeBps: 0,
      quotedAt: "2026-11-06T12:00:00.000Z",
      expiresAt: "2027-01-01T00:00:00.000Z",
      policySource: "environment_default",
      policyRevision: 1,
      termsVersion: "veel-terms-v1",
      withdrawalWaiverVersion: "instant-digital-access-v1"
    },
    signature: "2hwKreVBZBJQQbphpEHFSJ2WoGZtaBt3YqfvHqwSenprdR5v2n2MmsnSXWgqsBg8MwdrMPpAi8hvGHsYLATyGfNJ",
    signedTransactionBase64: "AVVRt0I7wPsjJ4UUsvsqY0R4F+5xw6xev+EDIu+29xybc19C6uzTuAPcQMGmyw79Z0BB2P3P863HGSApJAF7aQMBAAEDCF2lh5ohg1GuiDlVOc/fVjG5GGGsAuzuAUGfTb2h5/fAXbAFD4d9P0VI+i8rqhBbeBkP9BBc9xOj/3/GOheo+AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADNwSMBWui8yF11fQakigZUwuBTg6yK8jDQuKaErt6E0BAgIAAQwCAAAAAQAAAAAAAAA=",
    idempotencyKey: "payment-recovery-command-1",
    intentExpiresAt: "2027-01-01T00:00:00.000Z",
    createdAt: "2026-11-06T12:00:00.000Z"
  };
}

function recoveryStorageKey(record: PendingPaymentSubmission) {
  return `wevid:payment-submission:v1:${record.actorUserId}:${record.clientSessionScope}:${encodeURIComponent(record.recoveryScope)}`;
}
