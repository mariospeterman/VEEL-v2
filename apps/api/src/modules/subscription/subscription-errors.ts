export class SubscriptionRepositoryConfigurationError extends Error {
  constructor() {
    super("DATABASE_URL_NOT_CONFIGURED");
    this.name = "SubscriptionRepositoryConfigurationError";
  }
}

export class PlatformPlaybackNotQualifyingError extends Error {
  constructor() {
    super("platform_playback_not_qualifying");
    this.name = "PlatformPlaybackNotQualifyingError";
  }
}

export class PlatformUsageLimitReachedError extends Error {
  constructor() {
    super("platform_usage_limit_reached");
    this.name = "PlatformUsageLimitReachedError";
  }
}

export class PlatformUsageSequenceConflictError extends Error {
  constructor() {
    super("platform_usage_sequence_conflict");
    this.name = "PlatformUsageSequenceConflictError";
  }
}

export class SubscriptionIdempotencyConflictError extends Error {
  constructor() {
    super("SUBSCRIPTION_IDEMPOTENCY_CONFLICT");
    this.name = "SubscriptionIdempotencyConflictError";
  }
}

export class SubscriptionPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SubscriptionPolicyError";
  }
}
