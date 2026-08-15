export class EngagementRepositoryConfigurationError extends Error {
  constructor() {
    super("DATABASE_URL_NOT_CONFIGURED");
    this.name = "EngagementRepositoryConfigurationError";
  }
}

export class EngagementPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EngagementPolicyError";
  }
}

export class EngagementIdempotencyConflictError extends Error {
  constructor() {
    super("ENGAGEMENT_IDEMPOTENCY_CONFLICT");
    this.name = "EngagementIdempotencyConflictError";
  }
}

export class EngagementNotFoundError extends Error {
  constructor() {
    super("ENGAGEMENT_TARGET_NOT_FOUND");
    this.name = "EngagementNotFoundError";
  }
}
