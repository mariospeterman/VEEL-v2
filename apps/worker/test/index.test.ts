import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildWorkerRuntime,
  runNotificationDeliveryTick,
  runPaymentConfirmationEmailTick,
  runProviderEventReplayTick,
  runSubscriptionCollectionTick
} from "../src/index";
import type {
  DueNotificationDelivery,
  NotificationDeliveryOutcome,
  NotificationDeliveryProvider,
  NotificationDeliveryRepository
} from "../src/notification-delivery";
import { createWebPushNotificationDeliveryProvider } from "../src/notification-delivery";
import type {
  PaymentConfirmationEmailOutcome,
  PaymentConfirmationEmailProvider,
  PaymentConfirmationEmailRepository,
  QueuedPaymentConfirmationEmail
} from "../src/payment-confirmation-email";
import {
  createResendPaymentConfirmationEmailProvider,
  createUnconfiguredPaymentConfirmationEmailProvider
} from "../src/payment-confirmation-email";
import type {
  ProviderEventReplayAdapter,
  ProviderEventReplayOutcome,
  ProviderEventReplayRepository,
  QueuedProviderEventReplay
} from "../src/provider-event-replay";
import { createProviderSpecificReplayAdapter } from "../src/provider-event-replay";
import type {
  DueSubscriptionCollection,
  SubscriptionCollectionOutcome,
  SubscriptionCollectionProvider,
  SubscriptionCollectionRepository
} from "../src/subscription-collections";

const webPushMock = vi.hoisted(() => ({
  sendNotification: vi.fn()
}));

vi.mock("web-push", () => ({
  default: webPushMock
}));

beforeEach(() => {
  webPushMock.sendNotification.mockReset();
});

describe("buildWorkerRuntime", () => {
  it("registers recurring subscription queues", () => {
    const runtime = buildWorkerRuntime();

    expect(runtime).toMatchObject({
      name: "veel-worker",
      queues: [
        "subscription-authorizations",
        "subscription-collections",
        "notification-deliveries",
        "payment-confirmation-emails",
        "provider-event-replays"
      ],
      schedules: [
        {
          name: "subscription-collections",
          cadence: "every_minute",
          sourceIndex: "subscriptions_next_collection_idx"
        },
        {
          name: "notification-deliveries",
          cadence: "every_minute",
          sourceIndex: "notification_delivery_attempts_state_next_idx"
        },
        {
          name: "payment-confirmation-emails",
          cadence: "every_minute",
          sourceIndex: "payment_confirmation_deliveries_state_created_idx"
        },
        {
          name: "provider-event-replays",
          cadence: "operator_requested",
          sourceIndex: "provider_event_replay_requests_state_created_idx"
        }
      ]
    });
  });
});

describe("runNotificationDeliveryTick", () => {
  it("delivers queued notification attempts through the worker provider boundary", async () => {
    const repository = fakeNotificationDeliveryRepository({
      deliveries: [notificationDeliveryFixture()],
      enqueued: 2
    });
    const provider = fakeNotificationDeliveryProvider({ state: "delivered" });

    const result = await runNotificationDeliveryTick({
      repository,
      provider,
      now: new Date("2026-06-06T00:00:00.000Z")
    });

    expect(result).toEqual({
      enqueued: 2,
      leased: 1,
      delivered: 1,
      failed: 0,
      revoked: 0
    });
    expect(provider.inputs[0]).toMatchObject({
      notificationId: "notification-1",
      endpoint: "https://push.example/subscription"
    });
    expect(repository.outcomes[0]).toMatchObject({
      attemptId: "attempt-1",
      outcome: { state: "delivered" }
    });
  });

  it("keeps failed notification delivery attempts retryable", async () => {
    const retryAt = new Date("2026-06-06T00:05:00.000Z");
    const repository = fakeNotificationDeliveryRepository({
      deliveries: [notificationDeliveryFixture()]
    });
    const provider = fakeNotificationDeliveryProvider({
      state: "failed",
      failureCode: "push_service_unavailable",
      retryAt
    });

    const result = await runNotificationDeliveryTick({
      repository,
      provider,
      now: new Date("2026-06-06T00:00:00.000Z")
    });

    expect(result).toMatchObject({
      leased: 1,
      delivered: 0,
      failed: 1,
      revoked: 0
    });
    expect(repository.outcomes[0]).toMatchObject({
      outcome: {
        state: "failed",
        failureCode: "push_service_unavailable",
        retryAt
      }
    });
  });

  it("revokes devices when the push service reports an invalid subscription", async () => {
    const repository = fakeNotificationDeliveryRepository({
      deliveries: [notificationDeliveryFixture()]
    });
    const provider = fakeNotificationDeliveryProvider({
      state: "revoked",
      failureCode: "push_subscription_gone"
    });

    const result = await runNotificationDeliveryTick({
      repository,
      provider,
      now: new Date("2026-06-06T00:00:00.000Z")
    });

    expect(result).toMatchObject({
      leased: 1,
      delivered: 0,
      failed: 0,
      revoked: 1
    });
    expect(repository.outcomes[0]).toMatchObject({
      deviceId: "device-1",
      outcome: {
        state: "revoked",
        failureCode: "push_subscription_gone"
      }
    });
  });
});

describe("createWebPushNotificationDeliveryProvider", () => {
  it("sends sanitized notification payloads through VAPID web push", async () => {
    webPushMock.sendNotification.mockResolvedValueOnce({ statusCode: 201, body: "", headers: {} });
    const provider = createWebPushNotificationDeliveryProvider({
      vapidSubject: "mailto:ops@example.com",
      vapidPublicKey: "public-vapid-key",
      vapidPrivateKey: "private-vapid-key"
    });

    const outcome = await provider.deliver(notificationDeliveryFixture());

    expect(outcome).toEqual({ state: "delivered" });
    expect(webPushMock.sendNotification).toHaveBeenCalledWith(
      {
        endpoint: "https://push.example/subscription",
        keys: {
          p256dh: "p256dh-key",
          auth: "auth-secret"
        }
      },
      JSON.stringify({
        notificationId: "notification-1",
        title: "Wallet action required",
        body: "Connect a wallet to use this feature.",
        actionUrl: "/wallet"
      }),
      {
        TTL: 3600,
        timeout: 10_000,
        urgency: "normal",
        vapidDetails: {
          subject: "mailto:ops@example.com",
          publicKey: "public-vapid-key",
          privateKey: "private-vapid-key"
        }
      }
    );
  });

  it("revokes browser devices when the push service returns gone", async () => {
    webPushMock.sendNotification.mockRejectedValueOnce({ statusCode: 410 });
    const provider = createWebPushNotificationDeliveryProvider({
      vapidSubject: "mailto:ops@example.com",
      vapidPublicKey: "public-vapid-key",
      vapidPrivateKey: "private-vapid-key"
    });

    await expect(provider.deliver(notificationDeliveryFixture())).resolves.toEqual({
      state: "revoked",
      failureCode: "push_subscription_gone"
    });
  });
});

describe("runPaymentConfirmationEmailTick", () => {
  it("sends queued durable payment confirmations through the transactional provider", async () => {
    const repository = fakePaymentConfirmationEmailRepository({
      deliveries: [paymentConfirmationEmailFixture()]
    });
    const provider = fakePaymentConfirmationEmailProvider({
      state: "sent",
      providerMessageId: "resend-message-1"
    });

    const result = await runPaymentConfirmationEmailTick({
      repository,
      provider,
      now: new Date("2026-06-06T00:00:00.000Z")
    });

    expect(result).toEqual({
      leased: 1,
      sent: 1,
      providerNotConfigured: 0,
      failed: 0
    });
    expect(repository.includeProviderNotConfiguredFlags).toEqual([true]);
    expect(provider.inputs[0]).toMatchObject({
      deliveryId: "confirmation-delivery-1",
      to: "buyer@example.test",
      receiptNumber: "VEEL-0000000000004000"
    });
    expect(repository.outcomes[0]).toMatchObject({
      deliveryId: "confirmation-delivery-1",
      outcome: {
        state: "sent",
        providerMessageId: "resend-message-1"
      }
    });
  });

  it("marks queued confirmations provider-not-configured when transactional email is disabled", async () => {
    const repository = fakePaymentConfirmationEmailRepository({
      deliveries: [paymentConfirmationEmailFixture()]
    });

    const result = await runPaymentConfirmationEmailTick({
      repository,
      provider: createUnconfiguredPaymentConfirmationEmailProvider(),
      now: new Date("2026-06-06T00:00:00.000Z")
    });

    expect(result).toEqual({
      leased: 1,
      sent: 0,
      providerNotConfigured: 1,
      failed: 0
    });
    expect(repository.includeProviderNotConfiguredFlags).toEqual([false]);
    expect(repository.outcomes[0]).toMatchObject({
      outcome: {
        state: "provider_not_configured",
        failureCode: "transactional_email_provider_not_configured"
      }
    });
  });

  it("allows configured providers to recover previous provider-not-configured confirmations", async () => {
    const repository = fakePaymentConfirmationEmailRepository({
      deliveries: [paymentConfirmationEmailFixture()]
    });
    const provider = fakePaymentConfirmationEmailProvider({
      state: "sent",
      providerMessageId: "resend-message-2"
    });

    await runPaymentConfirmationEmailTick({
      repository,
      provider,
      now: new Date("2026-06-06T00:00:00.000Z")
    });

    expect(repository.includeProviderNotConfiguredFlags).toEqual([true]);
  });
});

describe("createResendPaymentConfirmationEmailProvider", () => {
  it("sends the durable receipt and waiver facts to Resend with a stable idempotency key", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ id: "resend-message-1" }), { status: 200 }));
    const provider = createResendPaymentConfirmationEmailProvider({
      apiKey: "resend-api-key",
      from: "Veel Receipts <receipts@example.test>",
      replyTo: "support@example.test",
      webUrl: "https://veel.example.test",
      fetchImpl
    });

    await expect(provider.send(paymentConfirmationEmailFixture())).resolves.toEqual({
      state: "sent",
      providerMessageId: "resend-message-1"
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer resend-api-key",
          "idempotency-key": "payment-confirmation:confirmation-delivery-1"
        })
      })
    );
    const requestInit = fetchImpl.mock.calls[0]?.at(1);
    expect(JSON.stringify(requestInit)).not.toMatch(/privateKey|serviceRole|rawPayload/i);
  });
});

describe("runSubscriptionCollectionTick", () => {
  it("auto-renews due delegated subscriptions after provider-confirmed collection", async () => {
    const repository = fakeSubscriptionCollectionRepository({
      dueCollections: [dueCollectionFixture()],
      expired: 1
    });
    const provider = fakeSubscriptionCollectionProvider({
      state: "confirmed",
      collectionSignature: "renewal-signature"
    });

    const result = await runSubscriptionCollectionTick({
      repository,
      provider,
      now: new Date("2026-06-06T00:00:00.000Z")
    });

    expect(result).toEqual({
      expired: 1,
      leased: 1,
      confirmed: 1,
      failed: 0,
      revoked: 0
    });
    expect(repository.outcomes).toEqual([
      {
        collectionId: "collection-1",
        subscriptionId: "subscription-1",
        outcome: {
          state: "confirmed",
          collectionSignature: "renewal-signature"
        }
      }
    ]);
    expect(provider.inputs).toMatchObject([
      {
        subscriptionId: "subscription-1",
        delegationAddress: "delegation-address"
      }
    ]);
  });

  it("keeps failed delegated collections retryable instead of granting frontend access truth", async () => {
    const retryAt = new Date("2026-06-06T00:05:00.000Z");
    const repository = fakeSubscriptionCollectionRepository({
      dueCollections: [dueCollectionFixture()]
    });
    const provider = fakeSubscriptionCollectionProvider({
      state: "failed",
      failureCode: "insufficient_allowance",
      retryAt
    });

    const result = await runSubscriptionCollectionTick({
      repository,
      provider,
      now: new Date("2026-06-06T00:00:00.000Z")
    });

    expect(result).toMatchObject({
      leased: 1,
      confirmed: 0,
      failed: 1,
      revoked: 0
    });
    expect(repository.outcomes[0]).toMatchObject({
      outcome: {
        state: "failed",
        failureCode: "insufficient_allowance",
        retryAt
      }
    });
  });

  it("marks delegated subscriptions revoked when provider evidence says the user revoked allowance", async () => {
    const repository = fakeSubscriptionCollectionRepository({
      dueCollections: [dueCollectionFixture()]
    });
    const provider = fakeSubscriptionCollectionProvider({
      state: "revoked",
      failureCode: "delegation_revoked"
    });

    const result = await runSubscriptionCollectionTick({
      repository,
      provider,
      now: new Date("2026-06-06T00:00:00.000Z")
    });

    expect(result).toMatchObject({
      leased: 1,
      confirmed: 0,
      failed: 0,
      revoked: 1
    });
    expect(repository.outcomes[0]).toMatchObject({
      outcome: {
        state: "revoked",
        failureCode: "delegation_revoked"
      }
    });
  });
});

describe("runProviderEventReplayTick", () => {
  it("leases queued provider event replay requests through the worker adapter boundary", async () => {
    const repository = fakeProviderEventReplayRepository({
      requests: [providerEventReplayFixture()]
    });
    const adapter = fakeProviderEventReplayAdapter({ state: "replayed" });

    const result = await runProviderEventReplayTick({
      repository,
      adapter,
      now: new Date("2026-06-06T00:00:00.000Z")
    });

    expect(result).toEqual({
      leased: 1,
      replayed: 1,
      failed: 0
    });
    expect(adapter.inputs).toMatchObject([
      {
        replayRequestId: "replay-request-1",
        provider: "helius"
      }
    ]);
    expect(repository.outcomes[0]).toMatchObject({
      replayRequestId: "replay-request-1",
      providerEventId: "00000000-0000-4000-8000-000000000050",
      outcome: { state: "replayed" }
    });
  });

  it("fails closed when no provider replay adapter is configured", async () => {
    const repository = fakeProviderEventReplayRepository({
      requests: [providerEventReplayFixture()]
    });

    const result = await runProviderEventReplayTick({
      repository,
      now: new Date("2026-06-06T00:00:00.000Z")
    });

    expect(result).toEqual({
      leased: 1,
      replayed: 0,
      failed: 1
    });
    expect(repository.outcomes[0]).toMatchObject({
      outcome: {
        state: "failed",
        failureCode: "provider_event_replay_adapter_not_configured"
      }
    });
  });

  it("records adapter exceptions as failed replay outcomes and keeps processing the queue", async () => {
    const repository = fakeProviderEventReplayRepository({
      requests: [
        providerEventReplayFixture({ replayRequestId: "replay-request-1" }),
        providerEventReplayFixture({ replayRequestId: "replay-request-2" })
      ]
    });

    const result = await runProviderEventReplayTick({
      repository,
      adapter: {
        async replay(input) {
          if (input.replayRequestId === "replay-request-1") {
            throw new Error("temporary provider outage");
          }

          return { state: "replayed" };
        }
      },
      now: new Date("2026-06-06T00:00:00.000Z")
    });

    expect(result).toEqual({
      leased: 2,
      replayed: 1,
      failed: 1
    });
    expect(repository.outcomes[0]).toMatchObject({
      replayRequestId: "replay-request-1",
      outcome: {
        state: "failed",
        failureCode: "provider_event_replay_exception:temporary provider outage"
      }
    });
    expect(repository.outcomes[1]).toMatchObject({
      replayRequestId: "replay-request-2",
      outcome: { state: "replayed" }
    });
  });

  it("dispatches sanitized Helius replay payloads to the provider-specific handler", async () => {
    const adapter = createProviderSpecificReplayAdapter({
      async helius(input) {
        expect(input.replayPayload).toEqual({
          kind: "solana_payment",
          signature: "solana-signature",
          referenceAddresses: ["reference-address"]
        });

        return { state: "replayed" };
      }
    });

    await expect(adapter.replay(providerEventReplayFixture())).resolves.toEqual({ state: "replayed" });
  });

  it("fails provider-specific replay when a known provider lacks a configured handler", async () => {
    const adapter = createProviderSpecificReplayAdapter({});

    await expect(adapter.replay(providerEventReplayFixture())).resolves.toEqual({
      state: "failed",
      failureCode: "provider_event_replay_handler_not_configured:helius"
    });
  });

  it("fails provider-specific replay when sanitized payload is missing or malformed", async () => {
    const adapter = createProviderSpecificReplayAdapter({
      async helius() {
        return { state: "replayed" };
      }
    });

    await expect(adapter.replay(providerEventReplayFixture({ replayPayload: {} }))).resolves.toEqual({
      state: "failed",
      failureCode: "provider_event_replay_payload_missing:helius"
    });
  });

  it("fails provider-specific replay for unsupported providers", async () => {
    const adapter = createProviderSpecificReplayAdapter({});

    await expect(
      adapter.replay(providerEventReplayFixture({ provider: "unknown_provider" }))
    ).resolves.toEqual({
      state: "failed",
      failureCode: "provider_event_replay_provider_unsupported:unknown_provider"
    });
  });
});

function dueCollectionFixture(
  overrides: Partial<DueSubscriptionCollection> = {}
): DueSubscriptionCollection {
  return {
    collectionId: overrides.collectionId ?? "collection-1",
    subscriptionId: overrides.subscriptionId ?? "subscription-1",
    subscriberUserId: overrides.subscriberUserId ?? "subscriber-1",
    planId: overrides.planId ?? "platform_plus_monthly",
    amountMinor: overrides.amountMinor ?? 15000000,
    amountAtomic: overrides.amountAtomic ?? 15000000,
    currency: overrides.currency ?? "USDC",
    periodStartsAt: overrides.periodStartsAt ?? new Date("2026-06-06T00:00:00.000Z"),
    periodEndsAt: overrides.periodEndsAt ?? new Date("2026-07-06T00:00:00.000Z"),
    authorityAddress: overrides.authorityAddress ?? "authority-address",
    delegationAddress: overrides.delegationAddress ?? "delegation-address",
    subscriberTokenAccount: overrides.subscriberTokenAccount ?? "subscriber-token-account",
    collectorAddress: overrides.collectorAddress ?? "collector-address",
    tokenMint: overrides.tokenMint ?? "usdc-mint",
    tokenProgram: overrides.tokenProgram ?? "spl_token",
    provider: overrides.provider ?? "official_solana_subscription_program",
    programId: overrides.programId ?? "De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44",
    periodSeconds: overrides.periodSeconds ?? 30 * 86_400
  };
}

function fakeSubscriptionCollectionProvider(
  outcome: SubscriptionCollectionOutcome
): SubscriptionCollectionProvider & { inputs: DueSubscriptionCollection[] } {
  const inputs: DueSubscriptionCollection[] = [];

  return {
    inputs,
    async collect(input) {
      inputs.push(input);

      return outcome;
    }
  };
}

function fakeSubscriptionCollectionRepository(input: {
  dueCollections?: DueSubscriptionCollection[];
  expired?: number;
}): SubscriptionCollectionRepository & {
  outcomes: Array<{
    collectionId: string;
    subscriptionId: string;
    outcome: SubscriptionCollectionOutcome;
  }>;
} {
  const outcomes: Array<{
    collectionId: string;
    subscriptionId: string;
    outcome: SubscriptionCollectionOutcome;
  }> = [];

  return {
    outcomes,
    async expireCancelledDueSubscriptions() {
      return input.expired ?? 0;
    },
    async leaseDueCollections() {
      return input.dueCollections ?? [];
    },
    async recordCollectionOutcome(outcome) {
      outcomes.push(outcome);
    }
  };
}

function paymentConfirmationEmailFixture(
  overrides: Partial<QueuedPaymentConfirmationEmail> = {}
): QueuedPaymentConfirmationEmail {
  return {
    deliveryId: overrides.deliveryId ?? "confirmation-delivery-1",
    paymentIntentId: overrides.paymentIntentId ?? "00000000-0000-4000-8000-000000000050",
    receiptId: overrides.receiptId ?? "00000000-0000-4000-8000-000000000051",
    userId: overrides.userId ?? "buyer-1",
    to: overrides.to ?? "buyer@example.test",
    receiptNumber: overrides.receiptNumber ?? "VEEL-0000000000004000",
    productType: overrides.productType ?? "content_unlock",
    amountMinor: overrides.amountMinor ?? 25000000,
    currency: overrides.currency ?? "SOL",
    termsVersion: overrides.termsVersion ?? "veel-terms-v1",
    withdrawalWaiverVersion: overrides.withdrawalWaiverVersion ?? "instant-digital-access-v1",
    withdrawalWaiverAcceptedAt:
      overrides.withdrawalWaiverAcceptedAt ?? "2026-06-06T00:00:00.000Z"
  };
}

function fakePaymentConfirmationEmailProvider(
  outcome: PaymentConfirmationEmailOutcome
): PaymentConfirmationEmailProvider & { inputs: QueuedPaymentConfirmationEmail[] } {
  const inputs: QueuedPaymentConfirmationEmail[] = [];

  return {
    isConfigured: true,
    inputs,
    async send(input) {
      inputs.push(input);

      return outcome;
    }
  };
}

function fakePaymentConfirmationEmailRepository(input: {
  deliveries?: QueuedPaymentConfirmationEmail[];
}): PaymentConfirmationEmailRepository & {
  includeProviderNotConfiguredFlags: boolean[];
  outcomes: Array<{
    deliveryId: string;
    outcome: PaymentConfirmationEmailOutcome;
  }>;
} {
  const includeProviderNotConfiguredFlags: boolean[] = [];
  const outcomes: Array<{
    deliveryId: string;
    outcome: PaymentConfirmationEmailOutcome;
  }> = [];

  return {
    includeProviderNotConfiguredFlags,
    outcomes,
    async leaseDueConfirmations(leaseInput) {
      includeProviderNotConfiguredFlags.push(leaseInput.includeProviderNotConfigured);

      return input.deliveries ?? [];
    },
    async recordDeliveryOutcome(outcome) {
      outcomes.push(outcome);
    }
  };
}

function notificationDeliveryFixture(
  overrides: Partial<DueNotificationDelivery> = {}
): DueNotificationDelivery {
  return {
    attemptId: overrides.attemptId ?? "attempt-1",
    notificationId: overrides.notificationId ?? "notification-1",
    deviceId: overrides.deviceId ?? "device-1",
    userId: overrides.userId ?? "user-1",
    provider: overrides.provider ?? "web_push",
    title: overrides.title ?? "Wallet action required",
    body: overrides.body ?? "Connect a wallet to use this feature.",
    actionUrl: overrides.actionUrl ?? "/wallet",
    endpoint: overrides.endpoint ?? "https://push.example/subscription",
    p256dh: overrides.p256dh ?? "p256dh-key",
    auth: overrides.auth ?? "auth-secret"
  };
}

function fakeNotificationDeliveryProvider(
  outcome: NotificationDeliveryOutcome
): NotificationDeliveryProvider & { inputs: DueNotificationDelivery[] } {
  const inputs: DueNotificationDelivery[] = [];

  return {
    inputs,
    async deliver(input) {
      inputs.push(input);

      return outcome;
    }
  };
}

function fakeNotificationDeliveryRepository(input: {
  deliveries?: DueNotificationDelivery[];
  enqueued?: number;
}): NotificationDeliveryRepository & {
  outcomes: Array<{
    attemptId: string;
    deviceId: string;
    outcome: NotificationDeliveryOutcome;
  }>;
} {
  const outcomes: Array<{
    attemptId: string;
    deviceId: string;
    outcome: NotificationDeliveryOutcome;
  }> = [];

  return {
    outcomes,
    async enqueueDueDeliveries() {
      return input.enqueued ?? 0;
    },
    async leaseDueDeliveries() {
      return input.deliveries ?? [];
    },
    async recordDeliveryOutcome(outcome) {
      outcomes.push(outcome);
    }
  };
}

function providerEventReplayFixture(
  overrides: Partial<QueuedProviderEventReplay> = {}
): QueuedProviderEventReplay {
  return {
    replayRequestId: overrides.replayRequestId ?? "replay-request-1",
    providerEventId: overrides.providerEventId ?? "00000000-0000-4000-8000-000000000050",
    provider: overrides.provider ?? "helius",
    eventType: overrides.eventType ?? "payment.confirmed",
    replayPayload: overrides.replayPayload ?? {
      kind: "solana_payment",
      signature: "solana-signature",
      referenceAddresses: ["reference-address"]
    }
  };
}

function fakeProviderEventReplayAdapter(
  outcome: ProviderEventReplayOutcome
): ProviderEventReplayAdapter & { inputs: QueuedProviderEventReplay[] } {
  const inputs: QueuedProviderEventReplay[] = [];

  return {
    inputs,
    async replay(input) {
      inputs.push(input);

      return outcome;
    }
  };
}

function fakeProviderEventReplayRepository(input: {
  requests?: QueuedProviderEventReplay[];
}): ProviderEventReplayRepository & {
  outcomes: Array<{
    replayRequestId: string;
    providerEventId: string;
    outcome: ProviderEventReplayOutcome;
  }>;
} {
  const outcomes: Array<{
    replayRequestId: string;
    providerEventId: string;
    outcome: ProviderEventReplayOutcome;
  }> = [];

  return {
    outcomes,
    async leaseQueuedReplayRequests() {
      return input.requests ?? [];
    },
    async recordReplayOutcome(outcome) {
      outcomes.push(outcome);
    }
  };
}
