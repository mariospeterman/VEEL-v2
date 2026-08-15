export class ProfileRepositoryConfigurationError extends Error {
  constructor() {
    super("DATABASE_URL_NOT_CONFIGURED");
    this.name = "ProfileRepositoryConfigurationError";
  }
}

export class ProfileHandleConflictError extends Error {
  constructor() {
    super("PROFILE_HANDLE_CONFLICT");
    this.name = "ProfileHandleConflictError";
  }
}

export class CreatorOnboardingIdempotencyConflictError extends Error {
  constructor() {
    super("CREATOR_ONBOARDING_IDEMPOTENCY_CONFLICT");
    this.name = "CreatorOnboardingIdempotencyConflictError";
  }
}

export class CreatorOnboardingWalletConflictError extends Error {
  constructor() {
    super("CREATOR_ONBOARDING_WALLET_CONFLICT");
    this.name = "CreatorOnboardingWalletConflictError";
  }
}

export class CreatorOnboardingTermsRequiredError extends Error {
  constructor() {
    super("CREATOR_ONBOARDING_TERMS_REQUIRED");
    this.name = "CreatorOnboardingTermsRequiredError";
  }
}
