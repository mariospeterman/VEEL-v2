import { randomUUID } from "node:crypto";
import postgres from "postgres";

export type SubscriptionCollectionOutcome =
  | {
      state: "confirmed";
      collectionSignature: string;
    }
  | {
      state: "failed";
      failureCode: string;
      retryAt: Date;
    }
  | {
      state: "revoked";
      failureCode: string;
    };

export interface DueSubscriptionCollection {
  collectionId: string;
  subscriptionId: string;
  subscriberUserId: string;
  planId: string;
  amountMinor: number;
  currency: "SOL" | "USDC";
  periodStartsAt: Date;
  periodEndsAt: Date;
  authorityAddress: string;
  delegationAddress: string;
  subscriberTokenAccount: string;
  collectorAddress: string;
  tokenMint: string;
  tokenProgram: "spl_token" | "token_2022";
}

export interface SubscriptionCollectionRepository {
  expireCancelledDueSubscriptions(input: { now: Date; limit: number }): Promise<number>;
  leaseDueCollections(input: { now: Date; limit: number }): Promise<DueSubscriptionCollection[]>;
  recordCollectionOutcome(input: {
    collectionId: string;
    subscriptionId: string;
    outcome: SubscriptionCollectionOutcome;
  }): Promise<void>;
  close?(): Promise<void>;
}

export interface SubscriptionCollectionProvider {
  collect(input: DueSubscriptionCollection): Promise<SubscriptionCollectionOutcome>;
}

export interface ProcessSubscriptionCollectionsResult {
  expired: number;
  leased: number;
  confirmed: number;
  failed: number;
  revoked: number;
}

export async function processDueSubscriptionCollections(input: {
  repository: SubscriptionCollectionRepository;
  provider: SubscriptionCollectionProvider;
  now?: Date;
  limit?: number;
}): Promise<ProcessSubscriptionCollectionsResult> {
  const now = input.now ?? new Date();
  const limit = input.limit ?? 25;
  const expired = await input.repository.expireCancelledDueSubscriptions({ now, limit });
  const dueCollections = await input.repository.leaseDueCollections({ now, limit });
  const result: ProcessSubscriptionCollectionsResult = {
    expired,
    leased: dueCollections.length,
    confirmed: 0,
    failed: 0,
    revoked: 0
  };

  for (const dueCollection of dueCollections) {
    const outcome = await input.provider.collect(dueCollection);
    await input.repository.recordCollectionOutcome({
      collectionId: dueCollection.collectionId,
      subscriptionId: dueCollection.subscriptionId,
      outcome
    });

    if (outcome.state === "confirmed") result.confirmed += 1;
    else if (outcome.state === "revoked") result.revoked += 1;
    else result.failed += 1;
  }

  return result;
}

export function createUnconfiguredSubscriptionCollectionProvider(): SubscriptionCollectionProvider {
  return {
    async collect() {
      return {
        state: "failed",
        failureCode: "subscription_collection_provider_not_configured",
        retryAt: new Date(Date.now() + 5 * 60 * 1000)
      };
    }
  };
}

export function createPostgresSubscriptionCollectionRepository(
  databaseUrl?: string
): SubscriptionCollectionRepository {
  if (!databaseUrl) {
    return {
      async expireCancelledDueSubscriptions() {
        return 0;
      },
      async leaseDueCollections() {
        return [];
      },
      async recordCollectionOutcome() {
        return;
      }
    };
  }

  const sql = postgres(databaseUrl, {
    max: 3,
    idle_timeout: 20,
    prepare: false
  });

  return {
    async expireCancelledDueSubscriptions(input) {
      const rows = await sql<{ id: string }[]>`
        update subscriptions s
        set
          state = 'cancelled',
          next_collection_at = null,
          updated_at = now()
        where s.id in (
          select due.id
          from subscriptions due
          where due.cancel_at_period_end = true
            and due.state in ('active', 'renewal_pending', 'grace_period')
            and due.current_period_ends_at <= ${input.now}
          order by due.current_period_ends_at asc
          limit ${input.limit}
          for update skip locked
        )
        returning s.id
      `;

      if (rows.length > 0) {
        for (const row of rows) {
          await sql`
            insert into subscription_events (
              id,
              subscription_id,
              actor_user_id,
              action,
              metadata
            )
            values (
              ${randomUUID()},
              ${row.id},
              null,
              'subscription.cancelled_at_period_end',
              '{}'::jsonb
            )
          `;
        }
      }

      return rows.length;
    },

    async leaseDueCollections(input) {
      return sql.begin(async (transaction) => {
        const dueRows = await transaction<DueSubscriptionRow[]>`
          select
            s.id as subscription_id,
            s.subscriber_user_id,
            s.plan_id,
            sp.amount_minor,
            sp.currency,
            sp.period_days,
            coalesce(s.current_period_ends_at, ${input.now}) as period_starts_at,
            coalesce(s.current_period_ends_at, ${input.now}) + (sp.period_days || ' days')::interval as period_ends_at,
            s.authority_address,
            s.delegation_address,
            s.subscriber_token_account,
            s.collector_address,
            sp.token_mint,
            sp.token_program
          from subscriptions s
          join subscription_plans sp on sp.id = s.plan_id
          where s.state in ('active', 'renewal_pending', 'grace_period')
            and s.renewal_mode = 'delegated_solana_subscription'
            and s.cancel_at_period_end = false
            and s.next_collection_at <= ${input.now}
            and s.authority_address is not null
            and s.delegation_address is not null
            and s.subscriber_token_account is not null
            and s.collector_address is not null
            and sp.token_mint is not null
            and sp.token_program is not null
          order by s.next_collection_at asc
          limit ${input.limit}
          for update skip locked
        `;

        const leased: DueSubscriptionCollection[] = [];

        for (const row of dueRows) {
          const collectionId = randomUUID();
          const collectionRows = await transaction<CollectionLeaseRow[]>`
            insert into subscription_collections (
              id,
              subscription_id,
              period_starts_at,
              period_ends_at,
              amount_minor,
              currency,
              state,
              due_at,
              submitted_at
            )
            values (
              ${collectionId},
              ${row.subscription_id},
              ${row.period_starts_at},
              ${row.period_ends_at},
              ${Number(row.amount_minor)},
              ${row.currency},
              'submitted',
              ${input.now},
              now()
            )
            on conflict (subscription_id, period_starts_at) do update
            set
              state = case
                when subscription_collections.state in ('failed', 'due') then 'submitted'
                else subscription_collections.state
              end,
              submitted_at = case
                when subscription_collections.state in ('failed', 'due') then now()
                else subscription_collections.submitted_at
              end
            returning id, state
          `;
          const collection = collectionRows[0];

          if (!collection || collection.state !== "submitted") {
            continue;
          }

          await transaction`
            update subscriptions
            set
              state = 'renewal_pending',
              updated_at = now()
            where id = ${row.subscription_id}
          `;

          await insertCollectionEvent(transaction, {
            subscriptionId: row.subscription_id,
            collectionId: collection.id,
            action: "subscription.collection_submitted",
            metadata: {
              planId: row.plan_id
            }
          });

          leased.push({
            collectionId: collection.id,
            subscriptionId: row.subscription_id,
            subscriberUserId: row.subscriber_user_id,
            planId: row.plan_id,
            amountMinor: Number(row.amount_minor),
            currency: row.currency,
            periodStartsAt: row.period_starts_at,
            periodEndsAt: row.period_ends_at,
            authorityAddress: row.authority_address,
            delegationAddress: row.delegation_address,
            subscriberTokenAccount: row.subscriber_token_account,
            collectorAddress: row.collector_address,
            tokenMint: row.token_mint,
            tokenProgram: row.token_program
          });
        }

        return leased;
      });
    },

    async recordCollectionOutcome(input) {
      await sql.begin(async (transaction) => {
        if (input.outcome.state === "confirmed") {
          const rows = await transaction<{ period_starts_at: Date; period_ends_at: Date }[]>`
            update subscription_collections
            set
              state = 'confirmed',
              collection_signature = ${input.outcome.collectionSignature},
              failure_code = null,
              confirmed_at = now()
            where id = ${input.collectionId}
              and subscription_id = ${input.subscriptionId}
            returning period_starts_at, period_ends_at
          `;
          const row = rows[0];
          if (!row) return;

          await transaction`
            update subscriptions
            set
              state = 'active',
              current_period_starts_at = ${row.period_starts_at},
              current_period_ends_at = ${row.period_ends_at},
              next_collection_at = ${row.period_ends_at},
              updated_at = now()
            where id = ${input.subscriptionId}
          `;

          await insertCollectionEvent(transaction, {
            subscriptionId: input.subscriptionId,
            collectionId: input.collectionId,
            action: "subscription.collection_confirmed",
            metadata: {
              collectionSignature: input.outcome.collectionSignature
            }
          });
          return;
        }

        if (input.outcome.state === "revoked") {
          await transaction`
            update subscription_collections
            set
              state = 'failed',
              failure_code = ${input.outcome.failureCode}
            where id = ${input.collectionId}
              and subscription_id = ${input.subscriptionId}
          `;
          await transaction`
            update subscriptions
            set
              state = 'revoked',
              revoked_at = coalesce(revoked_at, now()),
              next_collection_at = null,
              updated_at = now()
            where id = ${input.subscriptionId}
          `;
          await insertCollectionEvent(transaction, {
            subscriptionId: input.subscriptionId,
            collectionId: input.collectionId,
            action: "subscription.delegation_revoked",
            metadata: {
              failureCode: input.outcome.failureCode
            }
          });
          return;
        }

        await transaction`
          update subscription_collections
          set
            state = 'failed',
            failure_code = ${input.outcome.failureCode}
          where id = ${input.collectionId}
            and subscription_id = ${input.subscriptionId}
        `;
        await transaction`
          update subscriptions
          set
            state = 'grace_period',
            next_collection_at = ${input.outcome.retryAt},
            updated_at = now()
          where id = ${input.subscriptionId}
        `;
        await insertCollectionEvent(transaction, {
          subscriptionId: input.subscriptionId,
          collectionId: input.collectionId,
          action: "subscription.collection_failed",
          metadata: {
            failureCode: input.outcome.failureCode,
            retryAt: input.outcome.retryAt.toISOString()
          }
        });
      });
    },

    async close() {
      await sql.end({ timeout: 5 });
    }
  };
}

interface DueSubscriptionRow {
  subscription_id: string;
  subscriber_user_id: string;
  plan_id: string;
  amount_minor: string | number;
  currency: "SOL" | "USDC";
  period_days: number;
  period_starts_at: Date;
  period_ends_at: Date;
  authority_address: string;
  delegation_address: string;
  subscriber_token_account: string;
  collector_address: string;
  token_mint: string;
  token_program: "spl_token" | "token_2022";
}

interface CollectionLeaseRow {
  id: string;
  state: string;
}

async function insertCollectionEvent(
  transaction: postgres.TransactionSql,
  input: {
    subscriptionId: string;
    collectionId: string;
    action: string;
    metadata: Record<string, unknown>;
  }
): Promise<void> {
  await transaction`
    insert into subscription_events (
      id,
      subscription_id,
      actor_user_id,
      action,
      collection_id,
      metadata
    )
    values (
      ${randomUUID()},
      ${input.subscriptionId},
      null,
      ${input.action},
      ${input.collectionId},
      ${transaction.json(input.metadata as postgres.JSONValue)}
    )
  `;
}
