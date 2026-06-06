import { describe, expect, it } from "vitest";
import { buildWorkerRuntime, runNotificationDeliveryTick, runSubscriptionCollectionTick } from "../src/index";
import type {
  DueNotificationDelivery,
  NotificationDeliveryOutcome,
  NotificationDeliveryProvider,
  NotificationDeliveryRepository
} from "../src/notification-delivery";
import type {
  DueSubscriptionCollection,
  SubscriptionCollectionOutcome,
  SubscriptionCollectionProvider,
  SubscriptionCollectionRepository
} from "../src/subscription-collections";

describe("buildWorkerRuntime", () => {
  it("registers recurring subscription queues", () => {
    const runtime = buildWorkerRuntime();

    expect(runtime).toMatchObject({
      name: "veel-worker",
      queues: ["subscription-authorizations", "subscription-collections", "notification-deliveries"],
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

function dueCollectionFixture(
  overrides: Partial<DueSubscriptionCollection> = {}
): DueSubscriptionCollection {
  return {
    collectionId: overrides.collectionId ?? "collection-1",
    subscriptionId: overrides.subscriptionId ?? "subscription-1",
    subscriberUserId: overrides.subscriberUserId ?? "subscriber-1",
    planId: overrides.planId ?? "platform_plus_monthly",
    amountMinor: overrides.amountMinor ?? 15000000,
    currency: overrides.currency ?? "USDC",
    periodStartsAt: overrides.periodStartsAt ?? new Date("2026-06-06T00:00:00.000Z"),
    periodEndsAt: overrides.periodEndsAt ?? new Date("2026-07-06T00:00:00.000Z"),
    authorityAddress: overrides.authorityAddress ?? "authority-address",
    delegationAddress: overrides.delegationAddress ?? "delegation-address",
    subscriberTokenAccount: overrides.subscriberTokenAccount ?? "subscriber-token-account",
    collectorAddress: overrides.collectorAddress ?? "collector-address",
    tokenMint: overrides.tokenMint ?? "usdc-mint",
    tokenProgram: overrides.tokenProgram ?? "spl_token"
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
