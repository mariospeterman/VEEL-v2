import type { Subscription, SubscriptionAuthorizationIntent, SubscriptionPlan } from "./types.js";
import type { AuthorizationIntentRow, PlanRow, SubscriptionRow } from "./subscription-repository-rows.js";

export function toSubscriptionPlan(row: PlanRow): SubscriptionPlan {
  const plan: SubscriptionPlan = {
    id: row.id,
    scope: row.scope,
    ...(row.creator_user_id && row.creator_handle && row.creator_display_name
      ? {
          creator: {
            id: row.creator_user_id,
            handle: row.creator_handle,
            displayName: row.creator_display_name,
            avatarUrl: row.creator_avatar_url,
            badges: []
          }
        }
      : {}),
    label: row.label,
    amountMinor: Number(row.amount_minor),
    currency: row.currency,
    periodDays: row.period_days,
    billingMode: row.billing_mode,
    providerState: row.provider_state,
    tokenMint: row.token_mint,
    tokenProgram: row.token_program ?? null
  };

  return plan;
}

export function toSubscription(row: SubscriptionRow): Subscription {
  return {
    id: row.id,
    scope: row.scope,
    planId: row.plan_id,
    ...(row.creator_user_id && row.creator_handle && row.creator_display_name
      ? {
          creator: {
            id: row.creator_user_id,
            handle: row.creator_handle,
            displayName: row.creator_display_name,
            avatarUrl: row.creator_avatar_url,
            badges: []
          }
        }
      : {}),
    state: row.state,
    renewalMode: row.renewal_mode,
    currentPeriodEndsAt: row.current_period_ends_at?.toISOString() ?? null,
    nextCollectionAt: row.next_collection_at?.toISOString() ?? null,
    cancelledAt: row.cancelled_at?.toISOString() ?? null,
    revokedAt: row.revoked_at?.toISOString() ?? null,
    authorityAddress: row.authority_address,
    delegationAddress: row.delegation_address
  };
}

export function toAuthorizationIntentResponse(input: {
  intent: AuthorizationIntentRow;
  subscription: Subscription;
  providerState: "candidate" | "staging_required" | "launch_approved";
}): SubscriptionAuthorizationIntent {
  return {
    id: input.intent.id,
    subscription: input.subscription,
    authorizationMode: "delegated_solana_subscription",
    setupReference: input.intent.setup_reference,
    transactionRequestUrl: input.intent.transaction_request_url,
    expiresAt: input.intent.expires_at.toISOString(),
    providerReadiness: {
      activeMode: "delegated_solana_subscription",
      delegatedSubscriptions: input.providerState
    }
  };
}

export function creatorFieldsFromPlan(plan: PlanRow): Pick<
  SubscriptionRow,
  "creator_handle" | "creator_display_name" | "creator_avatar_url"
> {
  return {
    creator_handle: plan.creator_handle,
    creator_display_name: plan.creator_display_name,
    creator_avatar_url: plan.creator_avatar_url
  };
}

export function providerReadinessFromPlanState(
  state: SubscriptionPlan["providerState"]
): "candidate" | "staging_required" | "launch_approved" {
  if (state === "staging_required") {
    return "staging_required";
  }

  return "candidate";
}
