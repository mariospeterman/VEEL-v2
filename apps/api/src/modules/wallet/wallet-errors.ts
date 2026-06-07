export class WalletRepositoryConfigurationError extends Error {
  constructor() {
    super("DATABASE_URL_NOT_CONFIGURED");
    this.name = "WalletRepositoryConfigurationError";
  }
}

export class WalletLinkConflictError extends Error {
  constructor() {
    super("WALLET_LINK_CONFLICT");
    this.name = "WalletLinkConflictError";
  }
}

export class WalletLinkChallengeNotFoundError extends Error {
  constructor() {
    super("WALLET_LINK_CHALLENGE_NOT_FOUND");
    this.name = "WalletLinkChallengeNotFoundError";
  }
}

export class WalletNotFoundError extends Error {
  constructor() {
    super("WALLET_NOT_FOUND");
    this.name = "WalletNotFoundError";
  }
}
