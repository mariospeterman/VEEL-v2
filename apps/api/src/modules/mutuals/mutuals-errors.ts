export class MutualsRepositoryConfigurationError extends Error {
  constructor() {
    super("DATABASE_URL_NOT_CONFIGURED");
    this.name = "MutualsRepositoryConfigurationError";
  }
}

export class MutualsIdempotencyConflictError extends Error {
  constructor() {
    super("MUTUALS_IDEMPOTENCY_CONFLICT");
    this.name = "MutualsIdempotencyConflictError";
  }
}
