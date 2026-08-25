import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildWorkerRuntime,
  runAnalyticsProjectionTick,
  runMediaAssetCleanupTick,
  runMediaModerationTick,
  runScheduledWorkerTick,
  runNotificationDeliveryTick,
  runPaymentConfirmationEmailTick,
  runProviderEventReplayTick,
  runSubscriptionCollectionTick
} from "../src/index";
import type {
  MediaAssetCleanupOutcome,
  MediaAssetCleanupProvider,
  MediaAssetCleanupRepository,
  QueuedMediaAssetCleanup
} from "../src/media-asset-cleanup";
import {
  summarizeEvidence,
  type MediaModerationSignal,
  type MediaModerationOutcome,
  type MediaModerationRepository,
  type QueuedMediaModerationJob
} from "../src/media-moderation";
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
import type {
  AnalyticsProjectionJob,
  AnalyticsProjectionOutcome,
  AnalyticsProjectionRepository
} from "../src/analytics-projections";

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
        "analytics-projections",
        "subscription-collections",
        "notification-deliveries",
        "payment-confirmation-emails",
        "provider-event-replays",
        "scheduled-publications",
        "live-safety",
        "media-moderation",
        "media-asset-cleanups"
      ],
      schedules: [
        {
          name: "analytics-projections",
          cadence: "every_minute",
          sourceIndex: "analytics_projection_jobs_lease_idx"
        },
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
          cadence: "every_minute",
          sourceIndex: "provider_event_replay_requests_state_created_idx"
        },
        {
          name: "scheduled-publications",
          cadence: "every_minute",
          sourceIndex: "content_publication_jobs_due_idx"
        },
        {
          name: "live-safety",
          cadence: "every_minute",
          sourceIndex: "live_safety_provider_actions_due_idx"
        },
        {
          name: "media-moderation",
          cadence: "every_minute",
          sourceIndex: "media_moderation_jobs_lease_idx"
        },
        {
          name: "media-asset-cleanups",
          cadence: "every_minute",
          sourceIndex: "media_assets_provider_cleanup_idx"
        }
      ]
    });
  });
});

describe("runScheduledWorkerTick", () => {
  it("runs every scheduled queue and isolates task failures", async () => {
    const calls: string[] = [];
    const errors: Array<Record<string, unknown>> = [];

    const result = await runScheduledWorkerTick({
      runners: {
        async analyticsProjections() {
          calls.push("analytics");
        },
        async liveSafety() {
          calls.push("live-safety");
        },
        async mediaAssetCleanups() {
          calls.push("asset-cleanups");
        },
        async mediaModeration() {
          calls.push("moderation");
        },
        async notificationDeliveries() {
          calls.push("notifications");
        },
        async paymentConfirmationEmails() {
          calls.push("email");
          throw new Error("provider unavailable");
        },
        async providerEventReplays() {
          calls.push("provider-replays");
        },
        async scheduledPublications() {
          calls.push("scheduled-publications");
        },
        async subscriptionCollections() {
          calls.push("subscriptions");
        }
      },
      logger: {
        info() {},
        error(fields) {
          errors.push(fields);
        }
      }
    });

    expect(calls.sort()).toEqual([
      "analytics",
      "asset-cleanups",
      "email",
      "live-safety",
      "moderation",
      "notifications",
      "provider-replays",
      "scheduled-publications",
      "subscriptions"
    ]);
    expect(result).toEqual({
      analyticsProjections: "completed",
      liveSafety: "completed",
      mediaAssetCleanups: "completed",
      mediaModeration: "completed",
      notificationDeliveries: "completed",
      paymentConfirmationEmails: "failed",
      providerEventReplays: "completed",
      scheduledPublications: "completed",
      subscriptionCollections: "completed"
    });
    expect(errors).toEqual([
      {
        task: "paymentConfirmationEmails",
        errorName: "Error"
      }
    ]);
  });
});

describe("runAnalyticsProjectionTick", () => {
  const job: AnalyticsProjectionJob = {
    id: "00000000-0000-4000-8000-000000000201",
    projectionKey: "analytics_core",
    definitionVersion: 1,
    windowStartsOn: "2026-08-22",
    windowEndsOn: "2026-08-23",
    reason: "late_fact",
    attemptCount: 1,
    maxAttempts: 5,
    leaseToken: "00000000-0000-4000-8000-000000000202"
  };

  function repositoryFixture(overrides: Partial<AnalyticsProjectionRepository> = {}): AnalyticsProjectionRepository & { outcomes: AnalyticsProjectionOutcome[] } {
    const outcomes: AnalyticsProjectionOutcome[] = [];
    return {
      outcomes,
      async enqueueIncremental() {},
      async leaseJobs() { return [job]; },
      async projectWindow() {
        return {
          sourceRowCount: 4,
          projectedRowCount: 4,
          varianceCount: 0,
          projectedTableRowCount: 3,
          dataThrough: new Date("2026-08-23T23:59:59.999Z"),
          details: { sourceImpressions: 4, projectedImpressions: 4 }
        };
      },
      async recordOutcome(input) { outcomes.push(input.outcome); },
      ...overrides
    };
  }

  it("records deterministic projection and reconciliation evidence", async () => {
    const repository = repositoryFixture();
    await expect(runAnalyticsProjectionTick({
      repository,
      now: new Date("2026-08-23T14:00:00.000Z")
    })).resolves.toEqual({
      leased: 1,
      completed: 1,
      retrying: 0,
      deadLettered: 0,
      mismatched: 0
    });
    expect(repository.outcomes).toEqual([expect.objectContaining({ state: "completed" })]);
  });

  it("surfaces source-to-projection variance instead of treating it as matched", async () => {
    const repository = repositoryFixture({
      async projectWindow() {
        return {
          sourceRowCount: 5,
          projectedRowCount: 4,
          varianceCount: -1,
          projectedTableRowCount: 3,
          dataThrough: new Date("2026-08-23T23:59:59.999Z"),
          details: { sourceImpressions: 5, projectedImpressions: 4 }
        };
      }
    });

    await expect(runAnalyticsProjectionTick({ repository })).resolves.toMatchObject({
      completed: 1,
      mismatched: 1
    });
    expect(repository.outcomes).toEqual([
      expect.objectContaining({
        state: "completed",
        evidence: expect.objectContaining({ varianceCount: -1 })
      })
    ]);
  });

  it("keeps a failed batch retryable and redacts the implementation error", async () => {
    const repository = repositoryFixture({
      async projectWindow() { throw new Error("raw database credentials and query"); }
    });
    await expect(runAnalyticsProjectionTick({ repository })).resolves.toMatchObject({ retrying: 1 });
    expect(repository.outcomes).toEqual([{ state: "retry", errorCode: "analytics_projection_failed" }]);
  });

  it("dead-letters an exhausted batch without rewriting unexplained variance", async () => {
    const exhausted = { ...job, attemptCount: 5, maxAttempts: 5 };
    const repository = repositoryFixture({
      async leaseJobs() { return [exhausted]; },
      async projectWindow() { throw new Error("projection failed"); }
    });
    await expect(runAnalyticsProjectionTick({ repository })).resolves.toMatchObject({ deadLettered: 1 });
    expect(repository.outcomes).toEqual([{ state: "dead_letter", errorCode: "analytics_projection_failed" }]);
  });
});

describe("runMediaAssetCleanupTick", () => {
  const cleanup: QueuedMediaAssetCleanup = {
    mediaAssetId: "media-asset-1",
    contentId: "content-1",
    provider: "bunny",
    providerAssetId: "images/content-1/media-asset-1.webp",
    assetKind: "image",
    leaseToken: "00000000-0000-4000-8000-000000000099",
    attemptCount: 0
  };

  function repositoryFixture(): MediaAssetCleanupRepository & {
    outcomes: MediaAssetCleanupOutcome[];
  } {
    const outcomes: MediaAssetCleanupOutcome[] = [];
    return {
      outcomes,
      async leaseDueCleanups() {
        return [cleanup];
      },
      async recordCleanupOutcome(input) {
        outcomes.push(input.outcome);
      }
    };
  }

  it("completes provider cleanup through the scheduled worker boundary", async () => {
    const repository = repositoryFixture();
    const removed: string[] = [];
    const provider: MediaAssetCleanupProvider = {
      async remove(input) {
        removed.push(input.providerAssetId);
      }
    };

    await expect(runMediaAssetCleanupTick({ repository, provider })).resolves.toEqual({
      leased: 1,
      completed: 1,
      retrying: 0
    });
    expect(removed).toEqual([cleanup.providerAssetId]);
    expect(repository.outcomes).toEqual([{ state: "completed" }]);
  });

  it("keeps failed provider cleanup retryable without exposing the provider error", async () => {
    const repository = repositoryFixture();
    const provider: MediaAssetCleanupProvider = {
      async remove() {
        throw new Error("provider credential details");
      }
    };

    await expect(runMediaAssetCleanupTick({ repository, provider })).resolves.toEqual({
      leased: 1,
      completed: 0,
      retrying: 1
    });
    expect(repository.outcomes).toEqual([
      { state: "retry", errorCode: "provider_delete_failed" }
    ]);
  });
});

describe("runMediaModerationTick", () => {
  it("routes queued media to review when automated moderation is not launch-approved", async () => {
    const job: QueuedMediaModerationJob = {
      jobId: "moderation-job-1",
      caseId: "safety-case-1",
      mediaAssetId: "media-asset-1",
      liveRoomId: null,
      provider: "bunny",
      providerAssetId: "bunny-video-1",
      stage: "provider_scan_reconciliation",
      attemptCount: 1,
      maxAttempts: 5,
      leaseToken: "00000000-0000-4000-8000-000000000099"
    };
    const outcomes: MediaModerationOutcome[] = [];
    const repository: MediaModerationRepository = {
      async leaseJobs() {
        return [job];
      },
      async recordOutcome(input) {
        outcomes.push(input.outcome);
      }
    };

    await expect(runMediaModerationTick({ repository })).resolves.toEqual({
      leased: 1,
      completed: 0,
      reviewRequired: 1,
      failed: 0
    });
    expect(outcomes).toEqual([
      {
        state: "review_required",
        reasonCode: "automated_media_moderation_not_launch_approved"
      }
    ]);
  });

  it("keeps complete automated evidence behind human release review", async () => {
    const job: QueuedMediaModerationJob = {
      jobId: "moderation-job-evidence",
      caseId: "safety-case-evidence",
      mediaAssetId: "media-asset-evidence",
      liveRoomId: null,
      provider: "bunny",
      providerAssetId: "bunny-video-evidence",
      stage: "provider_scan_reconciliation",
      attemptCount: 1,
      maxAttempts: 5,
      leaseToken: "00000000-0000-4000-8000-000000000099"
    };
    const signals = clearMediaSignals();
    const outcomes: MediaModerationOutcome[] = [];
    const repository: MediaModerationRepository = {
      async leaseJobs() {
        return [job];
      },
      async recordOutcome(input) {
        outcomes.push(input.outcome);
      }
    };

    await expect(runMediaModerationTick({
      repository,
      adapter: { async evaluate() { return { state: "evidence", signals }; } }
    })).resolves.toEqual({
      leased: 1,
      completed: 1,
      reviewRequired: 0,
      failed: 0
    });
    expect(outcomes).toEqual([{ state: "evidence", signals }]);
    expect(summarizeEvidence(signals)).toEqual({
      caseState: "review_required",
      evidenceComplete: true,
      matchedKnownHash: null,
      reasonCode: "automated_checks_clear_manual_release_required"
    });
  });

  it("treats a valid Livepeer signal as complete live evidence", async () => {
    const job: QueuedMediaModerationJob = {
      jobId: "moderation-job-live-evidence",
      caseId: "safety-case-live-evidence",
      mediaAssetId: null,
      liveRoomId: "live-room-evidence",
      targetType: "live_room",
      provider: "livepeer",
      providerAssetId: "livepeer-stream-evidence",
      stage: "provider_scan_reconciliation",
      attemptCount: 1,
      maxAttempts: 5,
      leaseToken: "00000000-0000-4000-8000-000000000098"
    };
    const signals: MediaModerationSignal[] = [{
      provider: "livepeer",
      providerEventId: "live-signal-1",
      scanType: "live_signal",
      normalizedSignal: "clear",
      payloadHash: "b".repeat(64),
      modelOrRulesetVersion: "livepeer-signal-v1"
    }];
    const outcomes: MediaModerationOutcome[] = [];
    const repository: MediaModerationRepository = {
      async leaseJobs() {
        return [job];
      },
      async recordOutcome(input) {
        outcomes.push(input.outcome);
      }
    };

    await expect(runMediaModerationTick({
      repository,
      adapter: { async evaluate() { return { state: "evidence", signals }; } }
    })).resolves.toEqual({
      leased: 1,
      completed: 1,
      reviewRequired: 0,
      failed: 0
    });
    expect(outcomes).toEqual([{ state: "evidence", signals }]);
    expect(summarizeEvidence(signals, "live_room")).toEqual({
      caseState: "review_required",
      evidenceComplete: true,
      matchedKnownHash: null,
      reasonCode: "automated_checks_clear_manual_release_required"
    });
  });

  it("holds a known-hash match for reporting review without automatic sanctions", () => {
    const signals = clearMediaSignals();
    const matched = {
      ...signals[2]!,
      normalizedSignal: "matched" as const,
      providerIncidentReference: "opaque-incident-1"
    };
    signals[2] = matched;

    expect(summarizeEvidence(signals)).toEqual({
      caseState: "held_for_reporting",
      evidenceComplete: true,
      matchedKnownHash: matched,
      reasonCode: "known_hash_match_requires_reporting_review"
    });
  });

  it("preserves a valid known-hash match when a companion signal is malformed", () => {
    const signals = clearMediaSignals();
    const matched = {
      ...signals[2]!,
      normalizedSignal: "matched" as const,
      providerIncidentReference: "opaque-incident-2"
    };
    signals[2] = matched;
    signals[3] = { ...signals[3]!, payloadHash: "not-a-sha256" };

    expect(summarizeEvidence(signals)).toEqual({
      caseState: "held_for_reporting",
      evidenceComplete: false,
      matchedKnownHash: matched,
      reasonCode: "known_hash_match_requires_reporting_review"
    });
  });

  it("rejects incomplete or malformed normalized evidence", () => {
    const incomplete = clearMediaSignals().slice(0, 3);
    expect(summarizeEvidence(incomplete)).toMatchObject({
      evidenceComplete: false,
      reasonCode: "required_release_evidence_incomplete"
    });

    const malformed = clearMediaSignals();
    malformed[1] = { ...malformed[1]!, payloadHash: "not-a-sha256" };
    expect(summarizeEvidence(malformed)).toMatchObject({
      evidenceComplete: false,
      reasonCode: "required_release_evidence_invalid"
    });
  });
});

function clearMediaSignals(): MediaModerationSignal[] {
  const payloadHash = "a".repeat(64);
  return [
    {
      provider: "bunny_stream",
      providerEventId: "container-1",
      scanType: "container_integrity",
      normalizedSignal: "clear",
      payloadHash,
      modelOrRulesetVersion: "bunny-stream-playability-v1"
    },
    {
      provider: "bunny_shield",
      providerEventId: "malware-1",
      scanType: "malware",
      normalizedSignal: "clear",
      payloadHash,
      modelOrRulesetVersion: "shield-antivirus-v1"
    },
    {
      provider: "bunny_shield",
      providerEventId: "known-hash-1",
      scanType: "known_hash",
      normalizedSignal: "clear",
      payloadHash,
      modelOrRulesetVersion: "shield-known-hash-v1"
    },
    {
      provider: "internal",
      providerEventId: "classification-1",
      scanType: "content_classification",
      normalizedSignal: "clear",
      payloadHash,
      modelOrRulesetVersion: "fixture-classifier-v1"
    }
  ];
}

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
        leaseToken: "lease-1",
        maxAttempts: 8,
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

  it("reconciles a stale lease before considering another provider collection", async () => {
    const repository = fakeSubscriptionCollectionRepository({
      dueCollections: [dueCollectionFixture({ attemptCount: 2 })]
    });
    const collect = vi.fn();
    const provider: SubscriptionCollectionProvider = {
      async reconcile(input) {
        expect(input.providerIdempotencyKey).toBe("subscription-1:2026-06-06T00:00:00.000Z");
        return { state: "confirmed", collectionSignature: "reconciled-signature" };
      },
      collect
    };

    const result = await runSubscriptionCollectionTick({ repository, provider });

    expect(result.confirmed).toBe(1);
    expect(collect).not.toHaveBeenCalled();
    expect(repository.outcomes[0]?.outcome).toEqual({
      state: "confirmed",
      collectionSignature: "reconciled-signature"
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
      providerEventRecordId: "00000000-0000-4000-8000-000000000050",
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
        failureCode: "provider_event_replay_exception"
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
      failureCode: "provider_event_replay_handler_not_configured"
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
      failureCode: "provider_event_replay_payload_missing"
    });
  });

  it("fails provider-specific replay for unsupported providers", async () => {
    const adapter = createProviderSpecificReplayAdapter({});

    await expect(
      adapter.replay(providerEventReplayFixture({ provider: "unknown_provider" }))
    ).resolves.toEqual({
      state: "failed",
      failureCode: "provider_event_replay_provider_unsupported"
    });
  });
});

function dueCollectionFixture(
  overrides: Partial<DueSubscriptionCollection> = {}
): DueSubscriptionCollection {
  return {
    collectionId: overrides.collectionId ?? "collection-1",
    leaseToken: overrides.leaseToken ?? "lease-1",
    attemptCount: overrides.attemptCount ?? 1,
    providerIdempotencyKey:
      overrides.providerIdempotencyKey ?? "subscription-1:2026-06-06T00:00:00.000Z",
    subscriptionId: overrides.subscriptionId ?? "subscription-1",
    subscriberUserId: overrides.subscriberUserId ?? "subscriber-1",
    planId: overrides.planId ?? "platform_plus_monthly",
    amountMinor: overrides.amountMinor ?? 15000000n,
    amountAtomic: overrides.amountAtomic ?? 15000000n,
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
    async reconcile() {
      return { state: "not_found" };
    },
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
    leaseToken: overrides.leaseToken ?? "email-lease-1",
    attemptCount: overrides.attemptCount ?? 1,
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
    leaseToken: overrides.leaseToken ?? "notification-lease-1",
    attemptCount: overrides.attemptCount ?? 1,
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
    leaseToken: overrides.leaseToken ?? "replay-lease-1",
    attemptCount: overrides.attemptCount ?? 1,
    providerEventRecordId:
      overrides.providerEventRecordId ?? "00000000-0000-4000-8000-000000000050",
    providerEventId: overrides.providerEventId ?? "provider-delivery-1",
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
    providerEventRecordId: string;
    outcome: ProviderEventReplayOutcome;
  }>;
} {
  const outcomes: Array<{
    replayRequestId: string;
    providerEventRecordId: string;
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
