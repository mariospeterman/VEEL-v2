import { randomUUID } from "node:crypto";
import postgres from "postgres";
import type {
  Subscription,
  SubscriptionAuthorizationIntent,
  SubscriptionPlan,
  SubscriptionRepository
} from "./types.js";

export class SubscriptionRepositoryConfigurationError extends Error {
  constructor() {
    super("DATABASE_URL_NOT_CONFIGURED");
    this.name = "SubscriptionRepositoryConfigurationError";
  }
}

export class SubscriptionIdempotencyConflictError extends Error {
  constructor() {
    super("SUBSCRIPTION_IDEMPOTENCY_CONFLICT");
    this.name = "SubscriptionIdempotencyConflictError";
  }
}

export class SubscriptionPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SubscriptionPolicyError";
  }
}

interface PlanRow {
  id: string;
  scope: SubscriptionPlan["scope"];
  label: string;
  amount_minor: string | number;
  currency: SubscriptionPlan["currency"];
  period_days: number;
  billing_mode: SubscriptionPlan["billingMode"];
  provider_state: SubscriptionPlan["providerState"];
  token_mint: string | null;
  token_program: SubscriptionPlan["tokenProgram"];
  creator_user_id: string | null;
  creator_handle: string | null;
  creator_display_name: string | null;
  creator_avatar_url: string | null;
}

interface SubscriptionRow {
  id: string;
  scope: Subscription["scope"];
  plan_id: string;
  state: Subscription["state"];
  renewal_mode: Subscription["renewalMode"];
  current_period_ends_at: Date | null;
  next_collection_at: Date | null;
  cancelled_at: Date | null;
  revoked_at: Date | null;
  authority_address: string | null;
  delegation_address: string | null;
  creator_user_id: string | null;
  creator_handle: string | null;
  creator_display_name: string | null;
  creator_avatar_url: string | null;
}

interface AuthorizationIntentRow {
  id: string;
  subscription_id: string;
  setup_reference: string;
  transaction_request_url: string | null;
  expires_at: Date;
  request_hash: string;
  state: string;
}

export function createPostgresSubscriptionRepository(databaseUrl?: string): SubscriptionRepository {
  if (!databaseUrl) {
    return {
      async listPlans() {
        throw new SubscriptionRepositoryConfigurationError();
      },
      async createAuthorizationIntent() {
        throw new SubscriptionRepositoryConfigurationError();
      },
      async findAuthorizationVerificationContext() {
        throw new SubscriptionRepositoryConfigurationError();
      },
      async submitAuthorization() {
        throw new SubscriptionRepositoryConfigurationError();
      },
      async cancel() {
        throw new SubscriptionRepositoryConfigurationError();
      }
    };
  }

  const sql = postgres(databaseUrl, {
    max: 5,
    idle_timeout: 20,
    prepare: false
  });

  return {
    async listPlans() {
      const rows = await sql<PlanRow[]>`
        select
          sp.id,
          sp.scope,
          sp.label,
          sp.amount_minor,
          sp.currency,
          sp.period_days,
          sp.billing_mode,
          sp.provider_state,
          sp.token_mint,
          sp.token_program,
          sp.creator_user_id,
          p.handle as creator_handle,
          p.display_name as creator_display_name,
          p.avatar_url as creator_avatar_url
        from subscription_plans sp
        left join profiles p on p.user_id = sp.creator_user_id
        where sp.state = 'active'
          and sp.provider_state <> 'disabled'
        order by sp.scope, sp.amount_minor, sp.id
      `;

      return {
        items: rows.map(toSubscriptionPlan)
      };
    },

    async createAuthorizationIntent(input) {
      const actor = await findActor(sql, input.supabaseUserId);

      if (!actor) {
        throw new SubscriptionRepositoryConfigurationError();
      }

      const existing = await sql<(AuthorizationIntentRow & { plan_id: string; creator_user_id: string | null })[]>`
        select
          sai.id,
          sai.subscription_id,
          sai.setup_reference,
          sai.transaction_request_url,
          sai.expires_at,
          sai.request_hash,
          sai.state,
          s.plan_id,
          s.creator_user_id
        from subscription_authorization_intents sai
        join subscriptions s on s.id = sai.subscription_id
        where s.subscriber_user_id = ${actor.id}
          and sai.idempotency_key = ${input.idempotencyKey}
        limit 1
      `;

      const existingIntent = existing[0];

      if (existingIntent) {
        if (existingIntent.request_hash !== input.requestHash) {
          throw new SubscriptionIdempotencyConflictError();
        }

        const subscription = await findSubscriptionById(sql, {
          supabaseUserId: input.supabaseUserId,
          subscriptionId: existingIntent.subscription_id
        });

        if (!subscription) {
          throw new SubscriptionRepositoryConfigurationError();
        }

        return toAuthorizationIntentResponse({
          intent: existingIntent,
          subscription,
          providerState: providerReadinessFromPlanState("staging_required")
        });
      }

      const planRows = await sql<PlanRow[]>`
        select
          sp.id,
          sp.scope,
          sp.label,
          sp.amount_minor,
          sp.currency,
          sp.period_days,
          sp.billing_mode,
          sp.provider_state,
          sp.token_mint,
          sp.token_program,
          sp.creator_user_id,
          p.handle as creator_handle,
          p.display_name as creator_display_name,
          p.avatar_url as creator_avatar_url
        from subscription_plans sp
        left join profiles p on p.user_id = sp.creator_user_id
        where sp.id = ${input.body.planId}
          and sp.state = 'active'
          and sp.provider_state <> 'disabled'
        limit 1
      `;
      const plan = planRows[0];

      if (!plan) {
        throw new SubscriptionPolicyError("subscription_plan_not_found");
      }

      if (plan.billing_mode !== "delegated_solana_subscription") {
        throw new SubscriptionPolicyError("subscription_plan_requires_delegated_billing");
      }

      if (plan.scope === "creator") {
        if (!input.body.creatorUserId || input.body.creatorUserId !== plan.creator_user_id) {
          throw new SubscriptionPolicyError("creator_plan_mismatch");
        }
      } else if (input.body.creatorUserId) {
        throw new SubscriptionPolicyError("platform_plan_cannot_target_creator");
      }

      if (plan.creator_user_id === actor.id) {
        throw new SubscriptionPolicyError("cannot_subscribe_to_self");
      }

      const subscriptionId = randomUUID();
      const intentId = randomUUID();
      const setupReference = randomUUID();

      const result = await sql.begin(async (transaction) => {
        const subscriptionRows = await transaction<SubscriptionRow[]>`
          insert into subscriptions (
            id,
            subscriber_user_id,
            scope,
            plan_id,
            creator_user_id,
            state,
            renewal_mode,
            collector_address
          )
          values (
            ${subscriptionId},
            ${actor.id},
            ${plan.scope},
            ${plan.id},
            ${plan.creator_user_id},
            'authorization_pending',
            'delegated_solana_subscription',
            ${input.collectorAddress}
          )
          on conflict do nothing
          returning
            id,
            scope,
            plan_id,
            state,
            renewal_mode,
            current_period_ends_at,
            next_collection_at,
            cancelled_at,
            revoked_at,
            authority_address,
            delegation_address,
            creator_user_id,
            null::text as creator_handle,
            null::text as creator_display_name,
            null::text as creator_avatar_url
        `;
        const subscription = subscriptionRows[0];

        if (!subscription) {
          throw new SubscriptionPolicyError("subscription_already_open");
        }

        const intentRows = await transaction<AuthorizationIntentRow[]>`
          insert into subscription_authorization_intents (
            id,
            subscription_id,
            idempotency_key,
            request_hash,
            setup_reference,
            transaction_request_url,
            expires_at
          )
          values (
            ${intentId},
            ${subscriptionId},
            ${input.idempotencyKey},
            ${input.requestHash},
            ${setupReference},
            null,
            ${input.expiresAt}
          )
          returning
            id,
            subscription_id,
            setup_reference,
            transaction_request_url,
            expires_at,
            request_hash,
            state
        `;
        const intent = intentRows[0];

        if (!intent) {
          throw new SubscriptionRepositoryConfigurationError();
        }

        await insertSubscriptionEvent(transaction, {
          subscriptionId,
          actorUserId: actor.id,
          action: "subscription.authorization_intent_created",
          authorizationIntentId: intent.id,
          metadata: {
            planId: plan.id,
            delegationProgramId: input.delegationProgramId,
            providerState: plan.provider_state
          }
        });

        return {
          intent,
          subscription: toSubscription({ ...subscription, ...creatorFieldsFromPlan(plan) }),
          providerState: providerReadinessFromPlanState(plan.provider_state)
        };
      });

      return toAuthorizationIntentResponse(result);
    },

    async findAuthorizationVerificationContext(input) {
      const rows = await sql<
        {
          authorization_intent_id: string;
          setup_reference: string;
          collector_address: string | null;
          token_mint: string | null;
          token_program: "spl_token" | "token_2022" | null;
          amount_minor: string | number;
          period_days: number;
        }[]
      >`
        select
          sai.id as authorization_intent_id,
          sai.setup_reference,
          s.collector_address,
          sp.token_mint,
          sp.token_program,
          sp.amount_minor,
          sp.period_days
        from subscription_authorization_intents sai
        join subscriptions s on s.id = sai.subscription_id
        join subscription_plans sp on sp.id = s.plan_id
        join users u on u.id = s.subscriber_user_id
        where sai.id = ${input.authorizationIntentId}
          and u.supabase_user_id = ${input.supabaseUserId}
          and sai.state in ('created', 'submitted')
        limit 1
      `;
      const row = rows[0];

      return row
        ? {
            authorizationIntentId: row.authorization_intent_id,
            setupReference: row.setup_reference,
            delegationProgramId: input.delegationProgramId,
            collectorAddress: row.collector_address,
            tokenMint: row.token_mint,
            tokenProgram: row.token_program,
            amountMinor: Number(row.amount_minor),
            periodDays: row.period_days
          }
        : null;
    },

    async submitAuthorization(input) {
      const actor = await findActor(sql, input.supabaseUserId);

      if (!actor) {
        throw new SubscriptionRepositoryConfigurationError();
      }

      return sql.begin(async (transaction) => {
        const rows = await transaction<
          (SubscriptionRow & {
            authorization_intent_id: string;
            plan_period_days: number;
            plan_amount_minor: string | number;
            plan_currency: SubscriptionPlan["currency"];
          })[]
        >`
          update subscription_authorization_intents sai
          set
            state = case when ${input.verification.verified} then 'verified' else 'submitted' end,
            submitted_signature = ${input.body.signature},
            verified_signature = case when ${input.verification.verified} then ${input.body.signature} else verified_signature end,
            submitted_at = coalesce(submitted_at, now()),
            verified_at = case when ${input.verification.verified} then now() else verified_at end
          from subscriptions s
          join subscription_plans sp on sp.id = s.plan_id
          left join profiles p on p.user_id = s.creator_user_id
          where sai.id = ${input.authorizationIntentId}
            and sai.subscription_id = s.id
            and s.subscriber_user_id = ${actor.id}
            and sai.state in ('created', 'submitted')
          returning
            s.id,
            s.scope,
            s.plan_id,
            s.state,
            s.renewal_mode,
            s.current_period_ends_at,
            s.next_collection_at,
            s.cancelled_at,
            s.revoked_at,
            s.authority_address,
            s.delegation_address,
            s.creator_user_id,
            p.handle as creator_handle,
            p.display_name as creator_display_name,
            p.avatar_url as creator_avatar_url,
            sai.id as authorization_intent_id,
            sp.period_days as plan_period_days,
            sp.amount_minor as plan_amount_minor,
            sp.currency as plan_currency
        `;
        const row = rows[0];

        if (!row) {
          return null;
        }

        await transaction`
          update subscriptions s
          set
            state = case when ${input.verification.verified} then 'active' else state end,
            authority_address = ${input.body.authorityAddress},
            delegation_address = ${input.body.delegationAddress},
            subscriber_token_account = ${input.body.subscriberTokenAccount},
            current_period_starts_at = case when ${input.verification.verified} then coalesce(current_period_starts_at, now()) else current_period_starts_at end,
            current_period_ends_at = case when ${input.verification.verified} then coalesce(current_period_ends_at, now() + (${row.plan_period_days} || ' days')::interval) else current_period_ends_at end,
            next_collection_at = case when ${input.verification.verified} then coalesce(next_collection_at, now() + (${row.plan_period_days} || ' days')::interval) else next_collection_at end,
            updated_at = now()
          where s.id = ${row.id}
        `;
        const subscription = await findSubscriptionById(sql, {
          supabaseUserId: input.supabaseUserId,
          subscriptionId: row.id
        });

        if (input.verification.verified) {
          await transaction`
            insert into subscription_collections (
              id,
              subscription_id,
              period_starts_at,
              period_ends_at,
              amount_minor,
              currency,
              state,
              due_at
            )
            values (
              ${randomUUID()},
              ${row.id},
              now(),
              now() + (${row.plan_period_days} || ' days')::interval,
              ${Number(row.plan_amount_minor)},
              ${row.plan_currency},
              'confirmed',
              now()
            )
            on conflict (subscription_id, period_starts_at) do nothing
          `;
        }

        await insertSubscriptionEvent(transaction, {
          subscriptionId: row.id,
          actorUserId: actor.id,
          action: input.verification.verified
            ? "subscription.authorization_verified"
            : "subscription.authorization_submitted",
          authorizationIntentId: row.authorization_intent_id,
          metadata: {
            failureCode: input.verification.failureCode ?? null
          }
        });

        return subscription;
      });
    },

    async cancel(input) {
      const actor = await findActor(sql, input.supabaseUserId);

      if (!actor) {
        throw new SubscriptionRepositoryConfigurationError();
      }

      return sql.begin(async (transaction) => {
        const rows = await transaction<SubscriptionRow[]>`
          update subscriptions s
          set
            cancel_at_period_end = true,
            cancelled_at = coalesce(cancelled_at, now()),
            state = case when state = 'authorization_pending' then 'cancelled' else state end,
            updated_at = now()
          from profiles p
          where p.user_id = s.creator_user_id
            and s.id = ${input.subscriptionId}
            and s.subscriber_user_id = ${actor.id}
            and s.state in ('authorization_pending', 'active', 'renewal_pending', 'grace_period')
          returning
            s.id,
            s.scope,
            s.plan_id,
            s.state,
            s.renewal_mode,
            s.current_period_ends_at,
            s.next_collection_at,
            s.cancelled_at,
            s.revoked_at,
            s.authority_address,
            s.delegation_address,
            s.creator_user_id,
            p.handle as creator_handle,
            p.display_name as creator_display_name,
            p.avatar_url as creator_avatar_url
        `;
        let subscription = rows[0] ? toSubscription(rows[0]) : null;

        if (!subscription) {
          const platformRows = await transaction<SubscriptionRow[]>`
            update subscriptions s
            set
              cancel_at_period_end = true,
              cancelled_at = coalesce(cancelled_at, now()),
              state = case when state = 'authorization_pending' then 'cancelled' else state end,
              updated_at = now()
            where s.id = ${input.subscriptionId}
              and s.subscriber_user_id = ${actor.id}
              and s.creator_user_id is null
              and s.state in ('authorization_pending', 'active', 'renewal_pending', 'grace_period')
            returning
              s.id,
              s.scope,
              s.plan_id,
              s.state,
              s.renewal_mode,
              s.current_period_ends_at,
              s.next_collection_at,
              s.cancelled_at,
              s.revoked_at,
              s.authority_address,
              s.delegation_address,
              s.creator_user_id,
              null::text as creator_handle,
              null::text as creator_display_name,
              null::text as creator_avatar_url
          `;
          subscription = platformRows[0] ? toSubscription(platformRows[0]) : null;
        }

        if (subscription) {
          await insertSubscriptionEvent(transaction, {
            subscriptionId: subscription.id,
            actorUserId: actor.id,
            action: "subscription.cancelled",
            authorizationIntentId: null,
            metadata: {
              idempotencyKey: input.idempotencyKey
            }
          });
        }

        return subscription;
      });
    },

    async close() {
      await sql.end({ timeout: 5 });
    }
  };
}

async function findActor(sql: postgres.Sql, supabaseUserId: string): Promise<{ id: string } | null> {
  const rows = await sql<{ id: string }[]>`
    select id
    from users
    where supabase_user_id = ${supabaseUserId}
    limit 1
  `;

  return rows[0] ?? null;
}

async function findSubscriptionById(
  sql: postgres.Sql,
  input: {
    supabaseUserId: string;
    subscriptionId: string;
  }
): Promise<Subscription | null> {
  const rows = await sql<SubscriptionRow[]>`
    select
      s.id,
      s.scope,
      s.plan_id,
      s.state,
      s.renewal_mode,
      s.current_period_ends_at,
      s.next_collection_at,
      s.cancelled_at,
      s.revoked_at,
      s.authority_address,
      s.delegation_address,
      s.creator_user_id,
      p.handle as creator_handle,
      p.display_name as creator_display_name,
      p.avatar_url as creator_avatar_url
    from subscriptions s
    join users u on u.id = s.subscriber_user_id
    left join profiles p on p.user_id = s.creator_user_id
    where s.id = ${input.subscriptionId}
      and u.supabase_user_id = ${input.supabaseUserId}
    limit 1
  `;

  return rows[0] ? toSubscription(rows[0]) : null;
}

async function insertSubscriptionEvent(
  transaction: postgres.TransactionSql,
  input: {
    subscriptionId: string;
    actorUserId: string;
    action: string;
    authorizationIntentId: string | null;
    metadata: Record<string, unknown>;
  }
): Promise<void> {
  await transaction`
    insert into subscription_events (
      id,
      subscription_id,
      actor_user_id,
      action,
      authorization_intent_id,
      metadata
    )
    values (
      ${randomUUID()},
      ${input.subscriptionId},
      ${input.actorUserId},
      ${input.action},
      ${input.authorizationIntentId},
      ${transaction.json(input.metadata as postgres.JSONValue)}
    )
  `;
}

function toSubscriptionPlan(row: PlanRow): SubscriptionPlan {
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

function toSubscription(row: SubscriptionRow): Subscription {
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

function toAuthorizationIntentResponse(input: {
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

function creatorFieldsFromPlan(plan: PlanRow): Pick<
  SubscriptionRow,
  "creator_handle" | "creator_display_name" | "creator_avatar_url"
> {
  return {
    creator_handle: plan.creator_handle,
    creator_display_name: plan.creator_display_name,
    creator_avatar_url: plan.creator_avatar_url
  };
}

function providerReadinessFromPlanState(
  state: SubscriptionPlan["providerState"]
): "candidate" | "staging_required" | "launch_approved" {
  if (state === "staging_required") {
    return "staging_required";
  }

  return "candidate";
}
