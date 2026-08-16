export class LiveRepositoryConfigurationError extends Error {
  constructor() {
    super("DATABASE_URL_NOT_CONFIGURED");
    this.name = "LiveRepositoryConfigurationError";
  }
}

export class LiveRoomIdempotencyConflictError extends Error {
  constructor() {
    super("LIVE_ROOM_IDEMPOTENCY_CONFLICT");
    this.name = "LiveRoomIdempotencyConflictError";
  }
}

export class LiveControlIdempotencyConflictError extends Error {
  constructor() {
    super("LIVE_CONTROL_IDEMPOTENCY_CONFLICT");
    this.name = "LiveControlIdempotencyConflictError";
  }
}

export class LiveChatIdempotencyConflictError extends Error {
  constructor() {
    super("LIVE_CHAT_IDEMPOTENCY_CONFLICT");
    this.name = "LiveChatIdempotencyConflictError";
  }
}
