import { parseServerEnv } from "@veel/config";
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
  const provider = input.provider ?? createUnconfiguredSubscriptionCollectionProvider();

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

if (process.env.NODE_ENV !== "test") {
  const runtime = buildWorkerRuntime();
  console.log(`${runtime.name} ready in ${runtime.environment}`);
}
