export class NotificationRepositoryConfigurationError extends Error {
  constructor() {
    super("DATABASE_URL_NOT_CONFIGURED");
    this.name = "NotificationRepositoryConfigurationError";
  }
}

export class NotificationIdempotencyConflictError extends Error {
  constructor() {
    super("NOTIFICATION_IDEMPOTENCY_CONFLICT");
    this.name = "NotificationIdempotencyConflictError";
  }
}
