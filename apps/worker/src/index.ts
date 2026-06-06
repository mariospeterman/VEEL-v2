import { parseServerEnv } from "@veel/config";
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
    queues: ["subscription-authorizations", "subscription-collections"],
    schedules: [
      {
        name: "subscription-collections",
        cadence: "every_minute",
        sourceIndex: "subscriptions_next_collection_idx"
      }
    ]
  };
};

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
