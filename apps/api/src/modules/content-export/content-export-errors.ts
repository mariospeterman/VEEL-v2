export class ContentExportRepositoryConfigurationError extends Error {
  constructor() {
    super("DATABASE_URL_NOT_CONFIGURED");
    this.name = "ContentExportRepositoryConfigurationError";
  }
}

export class ContentExportPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContentExportPolicyError";
  }
}
