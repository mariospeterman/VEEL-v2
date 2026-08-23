import { parseServerEnv } from "@veel/config";
import { createCanonicalProviderReplayRuntime } from "@veel/api/provider-event-replay-runtime";
import { createBunnyStreamUploadAdapter } from "@veel/api/media-upload-provider";
import { createLivepeerProviderAdapter } from "@veel/api/live-provider";
import { pathToFileURL } from "node:url";
import {
  createPostgresLiveSafetyRepository,
  processLiveSafety,
  type LiveSafetyProvider,
  type LiveSafetyRepository,
  type ProcessLiveSafetyResult
} from "./live-safety.js";
import {
  createPostgresAnalyticsProjectionRepository,
  processAnalyticsProjections,
  type AnalyticsProjectionRepository,
  type ProcessAnalyticsProjectionsResult
} from "./analytics-projections.js";
import {
  createAdapterMediaAssetCleanupProvider,
  createPostgresMediaAssetCleanupRepository,
  processMediaAssetCleanups,
  type MediaAssetCleanupProvider,
  type MediaAssetCleanupRepository,
  type ProcessMediaAssetCleanupsResult
} from "./media-asset-cleanup.js";
import {
  createFailClosedMediaModerationAdapter,
  createPostgresMediaModerationRepository,
  processMediaModerationJobs,
  type MediaModerationAdapter,
  type MediaModerationRepository,
  type ProcessMediaModerationResult
} from "./media-moderation.js";
import {
  createPostgresNotificationDeliveryRepository,
  createUnconfiguredNotificationDeliveryProvider,
  createWebPushNotificationDeliveryProvider,
  processNotificationDeliveries,
  type NotificationDeliveryProvider,
  type NotificationDeliveryRepository,
  type ProcessNotificationDeliveriesResult
} from "./notification-delivery.js";
import {
  createPostgresPaymentConfirmationEmailRepository,
  createResendPaymentConfirmationEmailProvider,
  createUnconfiguredPaymentConfirmationEmailProvider,
  processPaymentConfirmationEmails,
  type PaymentConfirmationEmailProvider,
  type PaymentConfirmationEmailRepository,
  type ProcessPaymentConfirmationEmailsResult
} from "./payment-confirmation-email.js";
import {
  createPostgresProviderEventReplayRepository,
  createProviderSpecificReplayAdapter,
  createUnconfiguredProviderEventReplayAdapter,
  processProviderEventReplays,
  type ProcessProviderEventReplaysResult,
  type ProviderEventReplayAdapter,
  type ProviderEventReplayRepository
} from "./provider-event-replay.js";
import {
  createPostgresSubscriptionCollectionRepository,
  createSolanaSubscriptionCollectionProvider,
  createUnconfiguredSubscriptionCollectionProvider,
  processDueSubscriptionCollections,
  type ProcessSubscriptionCollectionsResult,
  type SubscriptionCollectionProvider,
  type SubscriptionCollectionRepository
} from "./subscription-collections.js";

export const buildWorkerRuntime = () => {
  const config = parseServerEnv(process.env);

  return {
    name: "veel-worker",
    environment: config.NODE_ENV,
    queues: [
      "analytics-projections",
      "subscription-collections",
      "notification-deliveries",
      "payment-confirmation-emails",
      "provider-event-replays",
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
  };
};

export async function runNotificationDeliveryTick(input: {
  repository?: NotificationDeliveryRepository;
  provider?: NotificationDeliveryProvider;
  now?: Date;
  limit?: number;
} = {}): Promise<ProcessNotificationDeliveriesResult> {
  const config = parseServerEnv(process.env);
  const repository =
    input.repository ??
    createPostgresNotificationDeliveryRepository({
      databaseUrl: config.DATABASE_URL,
      encryptionKey: config.NOTIFICATION_DEVICE_ENCRYPTION_KEY
    });
  const provider =
    input.provider ??
    (config.WEB_PUSH_VAPID_SUBJECT && config.WEB_PUSH_VAPID_PUBLIC_KEY && config.WEB_PUSH_VAPID_PRIVATE_KEY
      ? createWebPushNotificationDeliveryProvider({
          vapidSubject: config.WEB_PUSH_VAPID_SUBJECT,
          vapidPublicKey: config.WEB_PUSH_VAPID_PUBLIC_KEY,
          vapidPrivateKey: config.WEB_PUSH_VAPID_PRIVATE_KEY
        })
      : createUnconfiguredNotificationDeliveryProvider());

  try {
    return await processNotificationDeliveries({
      repository,
      provider,
      ...(input.now ? { now: input.now } : {}),
      ...(input.limit ? { limit: input.limit } : {})
    });
  } finally {
    if (!input.repository) {
      await repository.close?.();
    }
  }
}

export async function runAnalyticsProjectionTick(input: {
  repository?: AnalyticsProjectionRepository;
  now?: Date;
  limit?: number;
} = {}): Promise<ProcessAnalyticsProjectionsResult> {
  const config = parseServerEnv(process.env);
  if (!input.repository && !config.DATABASE_URL) {
    throw new Error("DATABASE_URL_NOT_CONFIGURED");
  }
  const repository = input.repository ?? createPostgresAnalyticsProjectionRepository(config.DATABASE_URL as string);
  try {
    return await processAnalyticsProjections({
      repository,
      ...(input.now ? { now: input.now } : {}),
      ...(input.limit ? { limit: input.limit } : {})
    });
  } finally {
    if (!input.repository) await repository.close?.();
  }
}

export async function runPaymentConfirmationEmailTick(input: {
  repository?: PaymentConfirmationEmailRepository;
  provider?: PaymentConfirmationEmailProvider;
  now?: Date;
  limit?: number;
} = {}): Promise<ProcessPaymentConfirmationEmailsResult> {
  const config = parseServerEnv(process.env);
  const repository = input.repository ?? createPostgresPaymentConfirmationEmailRepository(config.DATABASE_URL);
  const provider =
    input.provider ??
    (config.TRANSACTIONAL_EMAIL_PROVIDER === "resend"
      ? createResendPaymentConfirmationEmailProvider({
          apiKey: config.RESEND_API_KEY,
          from: config.TRANSACTIONAL_EMAIL_FROM,
          replyTo: config.TRANSACTIONAL_EMAIL_REPLY_TO,
          webUrl: config.WEB_URL
        })
      : createUnconfiguredPaymentConfirmationEmailProvider());

  try {
    return await processPaymentConfirmationEmails({
      repository,
      provider,
      ...(input.now ? { now: input.now } : {}),
      ...(input.limit ? { limit: input.limit } : {})
    });
  } finally {
    if (!input.repository) {
      await repository.close?.();
    }
  }
}

export async function runSubscriptionCollectionTick(input: {
  repository?: SubscriptionCollectionRepository;
  provider?: SubscriptionCollectionProvider;
  now?: Date;
  limit?: number;
} = {}): Promise<ProcessSubscriptionCollectionsResult> {
  const config = parseServerEnv(process.env);
  const repository =
    input.repository ?? createPostgresSubscriptionCollectionRepository(config.DATABASE_URL);
  const provider = input.provider ?? (
    config.SUBSCRIPTIONS_ENABLED &&
    config.SUBSCRIPTIONS_PROVIDER === "official_solana_subscription_program" &&
    config.SUBSCRIPTIONS_SOLANA_RPC_URL &&
    config.SUBSCRIPTIONS_COLLECTOR_WALLET &&
    config.SUBSCRIPTIONS_COLLECTOR_PRIVATE_KEY
      ? createSolanaSubscriptionCollectionProvider({
          rpcUrl: config.SUBSCRIPTIONS_SOLANA_RPC_URL,
          collectorPrivateKey: config.SUBSCRIPTIONS_COLLECTOR_PRIVATE_KEY,
          collectorWallet: config.SUBSCRIPTIONS_COLLECTOR_WALLET,
          platformWallet:
            config.PAYMENT_PLATFORM_FEE_WALLET ??
            config.PAYMENT_PLATFORM_TREASURY_WALLET ??
            config.SUBSCRIPTIONS_MERCHANT_WALLET ??
            null
        })
      : createUnconfiguredSubscriptionCollectionProvider()
  );

  try {
    return await processDueSubscriptionCollections({
      repository,
      provider,
      ...(input.now ? { now: input.now } : {}),
      ...(input.limit ? { limit: input.limit } : {})
    });
  } finally {
    if (!input.repository) {
      await repository.close?.();
    }
  }
}

export async function runProviderEventReplayTick(input: {
  repository?: ProviderEventReplayRepository;
  adapter?: ProviderEventReplayAdapter;
  now?: Date;
  limit?: number;
} = {}): Promise<ProcessProviderEventReplaysResult> {
  const config = parseServerEnv(process.env);
  const repository = input.repository ?? createPostgresProviderEventReplayRepository(config.DATABASE_URL);
  const replayRuntime = !input.adapter && config.DATABASE_URL
    ? createCanonicalProviderReplayRuntime(config)
    : null;
  const adapter = input.adapter ?? (
    replayRuntime
      ? createProviderSpecificReplayAdapter(replayRuntime.handlers)
      : createUnconfiguredProviderEventReplayAdapter()
  );

  try {
    return await processProviderEventReplays({
      repository,
      adapter,
      ...(input.now ? { now: input.now } : {}),
      ...(input.limit ? { limit: input.limit } : {})
    });
  } finally {
    if (!input.repository) {
      await repository.close?.();
    }
    await replayRuntime?.close();
  }
}

export async function runMediaModerationTick(input: {
  repository?: MediaModerationRepository;
  adapter?: MediaModerationAdapter;
  now?: Date;
  limit?: number;
} = {}): Promise<ProcessMediaModerationResult> {
  const config = parseServerEnv(process.env);
  const repository = input.repository ?? createPostgresMediaModerationRepository(config.DATABASE_URL);
  const adapter = input.adapter ?? createFailClosedMediaModerationAdapter();

  try {
    return await processMediaModerationJobs({
      repository,
      adapter,
      ...(input.now ? { now: input.now } : {}),
      ...(input.limit ? { limit: input.limit } : {})
    });
  } finally {
    if (!input.repository) {
      await repository.close?.();
    }
  }
}

export async function runLiveSafetyTick(input: {
  repository?: LiveSafetyRepository;
  provider?: LiveSafetyProvider;
  now?: Date;
  limit?: number;
} = {}): Promise<ProcessLiveSafetyResult> {
  const config = parseServerEnv(process.env);
  const repository = input.repository ?? createPostgresLiveSafetyRepository(config.DATABASE_URL);
  const livepeer = createLivepeerProviderAdapter(config);
  const provider = input.provider ?? {
    async checkHealth({ providerStreamId, observedAt }) {
      if (!livepeer.isConfigured() || !livepeer.getRoomHealth) {
        throw new Error("LIVEPEER_NOT_CONFIGURED");
      }
      return livepeer.getRoomHealth({ providerStreamId, observedAt });
    },
    async suspend({ providerStreamId }) {
      if (!livepeer.isConfigured()) throw new Error("LIVEPEER_NOT_CONFIGURED");
      await livepeer.setRoomSuspended({ providerStreamId, suspended: true });
    }
  };
  try {
    return await processLiveSafety({
      repository,
      provider,
      ...(input.now ? { now: input.now } : {}),
      ...(input.limit ? { limit: input.limit } : {})
    });
  } finally {
    if (!input.repository) await repository.close?.();
  }
}

export async function runMediaAssetCleanupTick(input: {
  repository?: MediaAssetCleanupRepository;
  provider?: MediaAssetCleanupProvider;
  now?: Date;
  limit?: number;
} = {}): Promise<ProcessMediaAssetCleanupsResult> {
  const config = parseServerEnv(process.env);
  const repository = input.repository ?? createPostgresMediaAssetCleanupRepository(config.DATABASE_URL);
  const provider = input.provider ?? createAdapterMediaAssetCleanupProvider(
    createBunnyStreamUploadAdapter(config)
  );

  try {
    return await processMediaAssetCleanups({
      repository,
      provider,
      ...(input.now ? { now: input.now } : {}),
      ...(input.limit ? { limit: input.limit } : {})
    });
  } finally {
    if (!input.repository) {
      await repository.close?.();
    }
  }
}

export interface ScheduledWorkerTickResult {
  analyticsProjections: "completed" | "failed";
  liveSafety: "completed" | "failed";
  mediaAssetCleanups: "completed" | "failed";
  mediaModeration: "completed" | "failed";
  notificationDeliveries: "completed" | "failed";
  paymentConfirmationEmails: "completed" | "failed";
  providerEventReplays: "completed" | "failed";
  subscriptionCollections: "completed" | "failed";
}

export interface WorkerLogger {
  info(fields: Record<string, unknown>, message: string): void;
  error(fields: Record<string, unknown>, message: string): void;
}

export interface WorkerTickRunners {
  analyticsProjections(): Promise<unknown>;
  liveSafety(): Promise<unknown>;
  mediaAssetCleanups(): Promise<unknown>;
  mediaModeration(): Promise<unknown>;
  notificationDeliveries(): Promise<unknown>;
  paymentConfirmationEmails(): Promise<unknown>;
  providerEventReplays(): Promise<unknown>;
  subscriptionCollections(): Promise<unknown>;
}

const defaultWorkerLogger: WorkerLogger = {
  info(fields, message) {
    console.log(JSON.stringify({ level: "info", message, ...fields }));
  },
  error(fields, message) {
    console.error(JSON.stringify({ level: "error", message, ...fields }));
  }
};

export async function runScheduledWorkerTick(input: {
  runners?: WorkerTickRunners;
  logger?: WorkerLogger;
} = {}): Promise<ScheduledWorkerTickResult> {
  const config = parseServerEnv(process.env);
  const logger = input.logger ?? defaultWorkerLogger;
  const runners = input.runners ?? {
    analyticsProjections: () => runAnalyticsProjectionTick({ limit: config.WORKER_BATCH_LIMIT }),
    liveSafety: () => runLiveSafetyTick({ limit: config.WORKER_BATCH_LIMIT }),
    mediaAssetCleanups: () => runMediaAssetCleanupTick({ limit: config.WORKER_BATCH_LIMIT }),
    mediaModeration: () => runMediaModerationTick({ limit: config.WORKER_BATCH_LIMIT }),
    notificationDeliveries: () => runNotificationDeliveryTick({ limit: config.WORKER_BATCH_LIMIT }),
    paymentConfirmationEmails: () => runPaymentConfirmationEmailTick({ limit: config.WORKER_BATCH_LIMIT }),
    providerEventReplays: () => runProviderEventReplayTick({ limit: config.WORKER_BATCH_LIMIT }),
    subscriptionCollections: () => runSubscriptionCollectionTick({ limit: config.WORKER_BATCH_LIMIT })
  };
  const tasks = [
    ["analyticsProjections", runners.analyticsProjections],
    ["liveSafety", runners.liveSafety],
    ["mediaAssetCleanups", runners.mediaAssetCleanups],
    ["mediaModeration", runners.mediaModeration],
    ["notificationDeliveries", runners.notificationDeliveries],
    ["paymentConfirmationEmails", runners.paymentConfirmationEmails],
    ["providerEventReplays", runners.providerEventReplays],
    ["subscriptionCollections", runners.subscriptionCollections]
  ] as const;
  const results = await Promise.all(
    tasks.map(async ([name, run]) => {
      try {
        await run();
        return [name, "completed"] as const;
      } catch (error) {
        logger.error(
          {
            task: name,
            errorName: error instanceof Error ? error.name : "UnknownError"
          },
          "worker_tick_task_failed"
        );
        return [name, "failed"] as const;
      }
    })
  );

  return Object.fromEntries(results) as unknown as ScheduledWorkerTickResult;
}

export function startWorkerProcess(input: {
  intervalMs?: number;
  runners?: WorkerTickRunners;
  logger?: WorkerLogger;
} = {}): {
  ready: Promise<ScheduledWorkerTickResult>;
  runNow: () => Promise<ScheduledWorkerTickResult>;
  stop: () => Promise<void>;
} {
  const config = parseServerEnv(process.env);
  const logger = input.logger ?? defaultWorkerLogger;
  let activeTick: Promise<ScheduledWorkerTickResult> | null = null;
  let stopping = false;

  const runNow = () => {
    if (activeTick) return activeTick;
    if (stopping) {
      return Promise.resolve<ScheduledWorkerTickResult>({
        analyticsProjections: "completed",
        liveSafety: "completed",
        mediaAssetCleanups: "completed",
        mediaModeration: "completed",
        notificationDeliveries: "completed",
        paymentConfirmationEmails: "completed",
        providerEventReplays: "completed",
        subscriptionCollections: "completed"
      });
    }

    activeTick = runScheduledWorkerTick({
      ...(input.runners ? { runners: input.runners } : {}),
      logger
    }).finally(() => {
      activeTick = null;
    });
    return activeTick;
  };

  const ready = runNow();
  const timer = setInterval(() => {
    void runNow();
  }, input.intervalMs ?? config.WORKER_TICK_INTERVAL_MS);

  return {
    ready,
    runNow,
    async stop() {
      stopping = true;
      clearInterval(timer);
      await activeTick;
    }
  };
}

function isDirectExecution(): boolean {
  const entrypoint = process.argv[1];
  return Boolean(entrypoint && pathToFileURL(entrypoint).href === import.meta.url);
}

if (isDirectExecution()) {
  const runtime = buildWorkerRuntime();
  const worker = startWorkerProcess();
  void worker.ready.then((result) => {
    defaultWorkerLogger.info(
      { name: runtime.name, environment: runtime.environment, result },
      "worker_ready"
    );
  });

  const shutdown = async (signal: NodeJS.Signals) => {
    defaultWorkerLogger.info({ signal }, "worker_shutdown_started");
    await worker.stop();
    defaultWorkerLogger.info({ signal }, "worker_shutdown_completed");
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}
