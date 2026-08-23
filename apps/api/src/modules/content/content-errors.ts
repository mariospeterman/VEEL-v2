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

export class ContentCompositionConflictError extends Error {
  constructor(readonly reason: "revision_conflict" | "composition_locked" | "idempotency_conflict") {
    super(reason);
    this.name = "ContentCompositionConflictError";
  }
}

export class ContentImageUploadConflictError extends Error {
  constructor(
    readonly reason:
      | "draft_locked"
      | "format_invalid"
      | "idempotency_conflict"
      | "receipt_invalid"
  ) {
    super(reason);
    this.name = "ContentImageUploadConflictError";
  }
}

export class ContentAssetRetirementConflictError extends Error {
  constructor(
    readonly reason:
      | "revision_conflict"
      | "composition_locked"
      | "idempotency_conflict"
      | "asset_already_retired"
  ) {
    super(reason);
    this.name = "ContentAssetRetirementConflictError";
  }
}

export class ContentDraftIdempotencyConflictError extends Error {
  constructor() {
    super("content_draft_idempotency_conflict");
    this.name = "ContentDraftIdempotencyConflictError";
  }
}

export class ContentDraftQuotaExceededError extends Error {
  constructor() {
    super("content_draft_quota_exceeded");
    this.name = "ContentDraftQuotaExceededError";
  }
}

export class ContentPollVoteConflictError extends Error {
  constructor(readonly reason: "idempotency_conflict" | "poll_closed") {
    super(reason);
    this.name = "ContentPollVoteConflictError";
  }
}

export class ContentModerationAppealConflictError extends Error {
  constructor(readonly reason: "not_appealable" | "appeal_already_open" | "idempotency_conflict") {
    super(reason);
    this.name = "ContentModerationAppealConflictError";
  }
}
