"use client";

import { parsePublicWebEnv } from "@veel/config/public";
import type { components } from "@veel/contracts";
import { createSupabaseBrowserClient } from "@/supabase/client";
import { e2eAuthCookieName } from "@/supabase/auth-cookie";

export type User = components["schemas"]["User"];
export type CreateAgeSessionRequest = components["schemas"]["CreateAgeSessionRequest"];
export type AgeSession = components["schemas"]["AgeSession"];
export type UpdateProfileRequest = components["schemas"]["UpdateProfileRequest"];
export type CreateWalletLinkChallengeRequest =
  components["schemas"]["CreateWalletLinkChallengeRequest"];
export type WalletLinkChallenge = components["schemas"]["WalletLinkChallenge"];
export type LinkWalletRequest = components["schemas"]["LinkWalletRequest"];
export type Wallet = components["schemas"]["Wallet"];
export type CreateContentRequest = components["schemas"]["CreateContentRequest"];
export type UpdateContentRequest = components["schemas"]["UpdateContentRequest"];
export type PublishContentRequest = components["schemas"]["PublishContentRequest"];
export type ContentItem = components["schemas"]["ContentItem"];
export type CreateUploadRequest = components["schemas"]["CreateUploadRequest"];
export type UploadSession = components["schemas"]["UploadSession"];
export type ContentUnlockIntent = components["schemas"]["ContentUnlockIntent"];
export type CreateLivePassIntentRequest = components["schemas"]["CreateLivePassIntentRequest"];
export type CreateAccessPassIntentRequest = components["schemas"]["CreateAccessPassIntentRequest"];
export type AccessPassIntent = components["schemas"]["AccessPassIntent"];
export type CreateMessageRequest = components["schemas"]["CreateMessageRequest"];
export type CreatePaidMessageIntentRequest = components["schemas"]["CreatePaidMessageIntentRequest"];
export type Message = components["schemas"]["Message"];
export type PaidMessageIntent = components["schemas"]["PaidMessageIntent"];
export type CreatePaymentIntentRequest = components["schemas"]["CreatePaymentIntentRequest"];
export type PaymentIntent = components["schemas"]["PaymentIntent"];
export type TransactionRequest = components["schemas"]["TransactionRequest"];
export type CreateSubscriptionIntentRequest = components["schemas"]["CreateSubscriptionIntentRequest"];
export type SubscriptionAuthorizationIntent =
  components["schemas"]["SubscriptionAuthorizationIntent"];
export type SubmitSubscriptionAuthorizationRequest =
  components["schemas"]["SubmitSubscriptionAuthorizationRequest"];
export type Subscription = components["schemas"]["Subscription"];
export type CreateRefundDisputeRequest = components["schemas"]["CreateRefundDisputeRequest"];
export type RefundDisputeRequest = components["schemas"]["RefundDisputeRequest"];

const browserE2eAuthEnabled =
  process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_ENABLE_E2E_AUTH === "true";

export class ApiMutationError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = "ApiMutationError";
  }
}

export async function createAgeSession(body: CreateAgeSessionRequest): Promise<AgeSession> {
  return authenticatedMutation<AgeSession>("/v1/age/sessions", "POST", body);
}

export async function updateMyProfile(body: UpdateProfileRequest): Promise<User> {
  return authenticatedMutation<User>("/v1/profiles/me", "PATCH", body);
}

export async function createWalletLinkChallenge(
  body: CreateWalletLinkChallengeRequest
): Promise<WalletLinkChallenge> {
  return authenticatedMutation<WalletLinkChallenge>("/v1/wallets/link-challenges", "POST", body);
}

export async function linkWallet(body: LinkWalletRequest): Promise<Wallet> {
  return authenticatedMutation<Wallet>("/v1/wallets/link", "POST", body);
}

export async function createContentDraft(body: CreateContentRequest): Promise<ContentItem> {
  return authenticatedMutation<ContentItem>("/v1/content", "POST", body);
}

export async function updateContent(
  contentId: string,
  body: UpdateContentRequest
): Promise<ContentItem> {
  return authenticatedMutation<ContentItem>(
    `/v1/content/${encodeURIComponent(contentId)}`,
    "PATCH",
    body
  );
}

export async function publishContent(
  contentId: string,
  body: PublishContentRequest
): Promise<ContentItem> {
  return authenticatedMutation<ContentItem>(
    `/v1/content/${encodeURIComponent(contentId)}/publish`,
    "POST",
    body
  );
}

export async function createMediaUpload(body: CreateUploadRequest): Promise<UploadSession> {
  return authenticatedMutation<UploadSession>("/v1/media/uploads", "POST", body);
}

export async function syncMediaAsset(mediaAssetId: string): Promise<void> {
  await authenticatedEmptyMutation(
    `/v1/media/assets/${encodeURIComponent(mediaAssetId)}/sync`,
    "POST",
    {}
  );
}

export async function getContentForMutation(contentId: string): Promise<ContentItem> {
  return authenticatedGet<ContentItem>(`/v1/content/${encodeURIComponent(contentId)}`);
}

export async function createContentUnlockIntent(contentId: string): Promise<ContentUnlockIntent> {
  return authenticatedMutation<ContentUnlockIntent>(
    `/v1/content/${encodeURIComponent(contentId)}/unlock-intents`,
    "POST",
    {}
  );
}

export async function createLivePassIntent(
  liveRoomId: string,
  body: CreateLivePassIntentRequest
): Promise<PaymentIntent> {
  return authenticatedMutation<PaymentIntent>(
    `/v1/live/rooms/${encodeURIComponent(liveRoomId)}/pass-intents`,
    "POST",
    body
  );
}

export async function createEventAccessPassIntent(
  eventId: string,
  body: CreateAccessPassIntentRequest
): Promise<AccessPassIntent> {
  return authenticatedMutation<AccessPassIntent>(
    `/v1/events/${encodeURIComponent(eventId)}/access-passes/intents`,
    "POST",
    body
  );
}

export async function createMessage(
  conversationId: string,
  body: CreateMessageRequest
): Promise<Message> {
  return authenticatedMutation<Message>(
    `/v1/messages/conversations/${encodeURIComponent(conversationId)}/messages`,
    "POST",
    body
  );
}

export async function createPaidMessageIntent(
  conversationId: string,
  body: CreatePaidMessageIntentRequest
): Promise<PaidMessageIntent> {
  return authenticatedMutation<PaidMessageIntent>(
    `/v1/messages/conversations/${encodeURIComponent(conversationId)}/paid-message-intents`,
    "POST",
    body
  );
}

export async function createPaymentIntent(body: CreatePaymentIntentRequest): Promise<PaymentIntent> {
  return authenticatedMutation<PaymentIntent>("/v1/payments/intents", "POST", body);
}

export async function getPaymentTransactionRequest(paymentIntentId: string): Promise<TransactionRequest> {
  return authenticatedGet<TransactionRequest>(
    `/v1/payments/intents/${encodeURIComponent(paymentIntentId)}/transaction-request`
  );
}

export async function createSubscriptionIntent(
  body: CreateSubscriptionIntentRequest
): Promise<SubscriptionAuthorizationIntent> {
  return authenticatedMutation<SubscriptionAuthorizationIntent>("/v1/subscriptions/intents", "POST", body);
}

export async function submitSubscriptionAuthorization(
  authorizationIntentId: string,
  body: SubmitSubscriptionAuthorizationRequest
): Promise<Subscription> {
  return authenticatedMutation<Subscription>(
    `/v1/subscriptions/authorizations/${encodeURIComponent(authorizationIntentId)}/submissions`,
    "POST",
    body
  );
}

export async function cancelSubscription(subscriptionId: string): Promise<Subscription> {
  return authenticatedMutation<Subscription>(
    `/v1/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`,
    "PATCH",
    {}
  );
}

export async function createRefundDisputeRequest(
  body: CreateRefundDisputeRequest
): Promise<RefundDisputeRequest> {
  return authenticatedMutation<RefundDisputeRequest>("/v1/refunds/requests", "POST", body);
}

async function authenticatedGet<T>(path: string): Promise<T> {
  const { token } = await browserSessionToken();
  const env = parsePublicWebEnv(process.env);
  const response = await fetch(new URL(path, env.NEXT_PUBLIC_API_BASE_URL), {
    cache: "no-store",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`
    }
  });

  if (!response.ok) {
    throw new ApiMutationError(await errorMessage(response), response.status);
  }

  return (await response.json()) as T;
}

async function authenticatedMutation<T>(
  path: string,
  method: "PATCH" | "POST",
  body: unknown
): Promise<T> {
  const { token } = await browserSessionToken();
  const env = parsePublicWebEnv(process.env);
  const response = await fetch(new URL(path, env.NEXT_PUBLIC_API_BASE_URL), {
    body: JSON.stringify(body),
    cache: "no-store",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": mutationIdempotencyKey()
    },
    method
  });

  if (!response.ok) {
    throw new ApiMutationError(await errorMessage(response), response.status);
  }

  return (await response.json()) as T;
}

async function authenticatedEmptyMutation(
  path: string,
  method: "PATCH" | "POST",
  body: unknown
): Promise<void> {
  const { token } = await browserSessionToken();
  const env = parsePublicWebEnv(process.env);
  const response = await fetch(new URL(path, env.NEXT_PUBLIC_API_BASE_URL), {
    body: JSON.stringify(body),
    cache: "no-store",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": mutationIdempotencyKey()
    },
    method
  });

  if (!response.ok) {
    throw new ApiMutationError(await errorMessage(response), response.status);
  }
}

async function browserSessionToken() {
  const e2eToken = browserE2eAccessToken();
  if (e2eToken) {
    return { token: e2eToken };
  }

  const supabase = createSupabaseBrowserClient();
  const {
    data: { session }
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    throw new ApiMutationError("Create or restore a session before continuing.", 401);
  }

  return { token: session.access_token };
}

function browserE2eAccessToken() {
  if (!browserE2eAuthEnabled) {
    return null;
  }

  const token = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${e2eAuthCookieName}=`))
    ?.slice(e2eAuthCookieName.length + 1);

  return token ? decodeURIComponent(token) : null;
}

function mutationIdempotencyKey() {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

async function errorMessage(response: Response) {
  try {
    const body = (await response.json()) as { message?: unknown; code?: unknown };
    if (typeof body.message === "string" && body.message) return body.message;
    if (typeof body.code === "string" && body.code) return body.code;
  } catch {
    return response.statusText || "Request failed";
  }

  return response.statusText || "Request failed";
}
