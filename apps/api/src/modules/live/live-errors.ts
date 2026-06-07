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
