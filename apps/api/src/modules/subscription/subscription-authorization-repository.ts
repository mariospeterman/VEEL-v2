import type postgres from "postgres";
import type { SubscriptionRepository } from "./types.js";
import { createAuthorizationIntent } from "./subscription-authorization-intent-repository.js";
import {
  findAuthorizationVerificationContext,
  submitAuthorization
} from "./subscription-authorization-verification-repository.js";

export function createSubscriptionAuthorizationRepositoryMethods(
  sql: postgres.Sql
): Pick<
  SubscriptionRepository,
  "createAuthorizationIntent" | "findAuthorizationVerificationContext" | "submitAuthorization"
> {
  return {
    createAuthorizationIntent(input) {
      return createAuthorizationIntent(sql, input);
    },
    findAuthorizationVerificationContext(input) {
      return findAuthorizationVerificationContext(sql, input);
    },
    submitAuthorization(input) {
      return submitAuthorization(sql, input);
    }
  };
}
