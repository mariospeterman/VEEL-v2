export class ActivityRepositoryConfigurationError extends Error {
  constructor() {
    super("DATABASE_URL_NOT_CONFIGURED");
    this.name = "ActivityRepositoryConfigurationError";
  }
}
