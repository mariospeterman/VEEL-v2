export class EventRepositoryConfigurationError extends Error {
  constructor() {
    super("DATABASE_URL_NOT_CONFIGURED");
    this.name = "EventRepositoryConfigurationError";
  }
}

export class EventIdempotencyConflictError extends Error {
  constructor() {
    super("EVENT_IDEMPOTENCY_CONFLICT");
    this.name = "EventIdempotencyConflictError";
  }
}
