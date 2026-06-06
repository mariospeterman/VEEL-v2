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

if (process.env.NODE_ENV !== "test") {
  const runtime = buildWorkerRuntime();
  console.log(`${runtime.name} ready in ${runtime.environment}`);
}
