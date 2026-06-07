export class SubscriptionRepositoryConfigurationError extends Error {
  constructor() {
    super("DATABASE_URL_NOT_CONFIGURED");
    this.name = "SubscriptionRepositoryConfigurationError";
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
