export class AnalyticsRepositoryConfigurationError extends Error {
  constructor() {
    super("ANALYTICS_REPOSITORY_NOT_CONFIGURED");
    this.name = "AnalyticsRepositoryConfigurationError";
  }
}

export class AnalyticsQueryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnalyticsQueryValidationError";
  }
}
