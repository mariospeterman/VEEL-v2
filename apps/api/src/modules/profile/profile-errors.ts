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
