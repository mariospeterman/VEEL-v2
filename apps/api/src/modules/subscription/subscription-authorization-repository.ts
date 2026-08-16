import type postgres from "postgres";
import type { SubscriptionRepository } from "./types.js";
import { createAuthorizationIntent } from "./subscription-authorization-intent-repository.js";
import {
  findAuthorizationVerificationContext,
  recordAuthorizationTransactionFacts,
  submitAuthorization
} from "./subscription-authorization-verification-repository.js";

export function createSubscriptionAuthorizationRepositoryMethods(
  sql: postgres.Sql
): Pick<
  SubscriptionRepository,
  | "createAuthorizationIntent"
  | "findAuthorizationVerificationContext"
  | "recordAuthorizationTransactionFacts"
  | "submitAuthorization"
> {
  return {
    createAuthorizationIntent(input) {
      return createAuthorizationIntent(sql, input);
    },
    findAuthorizationVerificationContext(input) {
      return findAuthorizationVerificationContext(sql, input);
    },
    recordAuthorizationTransactionFacts(input) {
      return recordAuthorizationTransactionFacts(sql, input);
    },
    submitAuthorization(input) {
      return submitAuthorization(sql, input);
    }
  };
}
