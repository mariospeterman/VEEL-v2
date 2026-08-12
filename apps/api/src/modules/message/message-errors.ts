export class MessageRepositoryConfigurationError extends Error {
  constructor() {
    super("DATABASE_URL_NOT_CONFIGURED");
    this.name = "MessageRepositoryConfigurationError";
  }
}

export class MessageIdempotencyConflictError extends Error {
  constructor() {
    super("MESSAGE_IDEMPOTENCY_CONFLICT");
    this.name = "MessageIdempotencyConflictError";
  }
}
