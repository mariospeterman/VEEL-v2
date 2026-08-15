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

export class PaymentRecipientNotReadyError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "PaymentRecipientNotReadyError";
  }
}

export class PaymentConsentConflictError extends Error {
  constructor() {
    super("PAYMENT_CONSENT_CONFLICT");
    this.name = "PaymentConsentConflictError";
  }
}

export function isRecipientMonetisationPolicyError(error: unknown): error is { code: "P0001"; message: string } {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "P0001" &&
      "message" in error &&
      typeof error.message === "string" &&
      error.message.startsWith("recipient_")
  );
}
