export class PaymentRepositoryConfigurationError extends Error {
  constructor() {
    super("DATABASE_URL_NOT_CONFIGURED");
    this.name = "PaymentRepositoryConfigurationError";
  }
}

export class PaymentIdempotencyConflictError extends Error {
  constructor() {
    super("PAYMENT_IDEMPOTENCY_CONFLICT");
    this.name = "PaymentIdempotencyConflictError";
  }
}
