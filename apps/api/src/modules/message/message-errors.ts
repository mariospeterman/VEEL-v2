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

export class MessageBlockedError extends Error {
  constructor() {
    super("MESSAGE_BLOCKED");
    this.name = "MessageBlockedError";
  }
}

export class MessageRequestForbiddenError extends Error {
  constructor() {
    super("MESSAGE_REQUEST_FORBIDDEN");
    this.name = "MessageRequestForbiddenError";
  }
}

export class MessageRequestLimitError extends Error {
  constructor() {
    super("MESSAGE_REQUEST_LIMIT_REACHED");
    this.name = "MessageRequestLimitError";
  }
}
