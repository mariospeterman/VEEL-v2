import { parseServerEnv } from "@veel/config";
import { pathToFileURL } from "node:url";
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
      "subscription-collections",
      "notification-deliveries",
      "payment-confirmation-emails",
      "provider-event-replays",
      "media-moderation"
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
        cadence: "every_minute",
        sourceIndex: "provider_event_replay_requests_state_created_idx"
      },
      {
        name: "media-moderation",
        cadence: "every_minute",
        sourceIndex: "media_moderation_jobs_lease_idx"
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
  const adapter = input.adapter ?? createUnconfiguredProviderEventReplayAdapter();

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

export interface ScheduledWorkerTickResult {
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
    mediaModeration: () => runMediaModerationTick({ limit: config.WORKER_BATCH_LIMIT }),
    notificationDeliveries: () => runNotificationDeliveryTick({ limit: config.WORKER_BATCH_LIMIT }),
    paymentConfirmationEmails: () => runPaymentConfirmationEmailTick({ limit: config.WORKER_BATCH_LIMIT }),
    providerEventReplays: () => runProviderEventReplayTick({ limit: config.WORKER_BATCH_LIMIT }),
    subscriptionCollections: () => runSubscriptionCollectionTick({ limit: config.WORKER_BATCH_LIMIT })
  };
  const tasks = [
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
