import type {
  SubscriptionAuthorizationVerifier,
  VerifySubscriptionAuthorizationInput
} from "./types.js";

export function createSolanaSubscriptionAuthorizationVerifier(): SubscriptionAuthorizationVerifier {
  return {
    async verifyAuthorization(input: VerifySubscriptionAuthorizationInput) {
      if (
        !input.signature ||
        !input.setupReference ||
        !input.authorityAddress ||
        !input.delegationAddress ||
        !input.subscriberTokenAccount
      ) {
        return {
          verified: false,
          failureCode: "missing_authorization_evidence"
        };
      }

      return {
        verified: false,
        failureCode: "delegation_verifier_not_configured"
      };
    }
  };
}
