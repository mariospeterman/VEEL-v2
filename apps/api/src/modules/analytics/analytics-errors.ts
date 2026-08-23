export class AnalyticsRepositoryConfigurationError extends Error {
  constructor() {
    super("ANALYTICS_REPOSITORY_NOT_CONFIGURED");
    this.name = "AnalyticsRepositoryConfigurationError";
  }
}

export class AnalyticsIdempotencyConflictError extends Error {
  constructor() {
    super("Analytics job idempotency key was already used for a different request");
    this.name = "AnalyticsIdempotencyConflictError";
  }
}

export class AnalyticsQueryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnalyticsQueryValidationError";
  }
}
