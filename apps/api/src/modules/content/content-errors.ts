export class ContentRepositoryConfigurationError extends Error {
  constructor() {
    super("DATABASE_URL_NOT_CONFIGURED");
    this.name = "ContentRepositoryConfigurationError";
  }
}

export class ContentPublishConflictError extends Error {
  constructor(readonly reason: "provider_not_ready" | "blocked") {
    super(reason);
    this.name = "ContentPublishConflictError";
  }
}

export class ContentEventDraftConflictError extends Error {
  constructor() {
    super("event_draft_not_editable");
    this.name = "ContentEventDraftConflictError";
  }
}
