export class AdminRepositoryConfigurationError extends Error {
  constructor() {
    super("DATABASE_URL_NOT_CONFIGURED");
    this.name = "AdminRepositoryConfigurationError";
  }
}

export class AdminRepositoryStateConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdminRepositoryStateConflictError";
  }
}
