import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import type { SubscriptionRepository } from "./types.js";
import {
  SubscriptionIdempotencyConflictError,
  SubscriptionRepositoryConfigurationError
} from "./subscription-errors.js";
import { toSubscription } from "./subscription-repository-mappers.js";
import type { SubscriptionRow } from "./subscription-repository-rows.js";
import { findActor, insertSubscriptionEvent } from "./subscription-repository-support.js";

type SubscriptionCancellationRepositoryMethods = Pick<SubscriptionRepository, "cancel">;

export function createSubscriptionCancellationRepositoryMethods(
  sql: postgres.Sql
): SubscriptionCancellationRepositoryMethods {
  return {
    async cancel(input) {
      const actor = await findActor(sql, input.supabaseUserId);

      if (!actor) {
        throw new SubscriptionRepositoryConfigurationError();
      }

      return sql.begin(async (transaction) => {
        const receiptRows = await transaction<{
          request_hash: string;
          response_body: ReturnType<typeof toSubscription>;
        }[]>`
          select request_hash, response_body
          from subscription_action_receipts
          where actor_user_id = ${actor.id}
            and action = 'cancel'
            and idempotency_key = ${input.idempotencyKey}
          limit 1
        `;
        const receipt = receiptRows[0];
        if (receipt) {
          if (receipt.request_hash !== input.requestHash) {
            throw new SubscriptionIdempotencyConflictError();
          }
          return receipt.response_body;
        }

        const rows = await transaction<SubscriptionRow[]>`
          update subscriptions s
          set
            cancel_at_period_end = true,
            cancelled_at = coalesce(cancelled_at, now()),
            state = case when current_period_ends_at is null then 'cancelled' else state end,
            next_collection_at = case when current_period_ends_at is null then null else next_collection_at end,
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
            s.subscriber_wallet,
            s.subscriber_token_account,
            s.provider,
            s.program_id,
            s.token_mint,
            s.amount_atomic,
            s.period_seconds,
            s.plan_pda,
            s.subscription_pda,
            s.merchant_wallet,
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
              state = case when current_period_ends_at is null then 'cancelled' else state end,
              next_collection_at = case when current_period_ends_at is null then null else next_collection_at end,
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
              s.subscriber_wallet,
              s.subscriber_token_account,
              s.provider,
              s.program_id,
              s.token_mint,
              s.amount_atomic,
              s.period_seconds,
              s.plan_pda,
              s.subscription_pda,
              s.merchant_wallet,
              s.creator_user_id,
              null::text as creator_handle,
              null::text as creator_display_name,
              null::text as creator_avatar_url
          `;
          subscription = platformRows[0] ? toSubscription(platformRows[0]) : null;
        }

        if (subscription) {
          await transaction`
            update subscription_collections
            set state = 'cancelled', failure_code = 'subscriber_cancelled', lease_token = null, leased_until = null
            where subscription_id = ${subscription.id}
              and state in ('due', 'failed')
          `;
          await insertSubscriptionEvent(transaction, {
            subscriptionId: subscription.id,
            actorUserId: actor.id,
            action: "subscription.cancelled",
            authorizationIntentId: null,
            metadata: {
              idempotencyKey: input.idempotencyKey
            }
          });
          await transaction`
            insert into subscription_action_receipts (
              id,
              actor_user_id,
              subscription_id,
              action,
              idempotency_key,
              request_hash,
              response_body
            )
            values (
              ${randomUUID()},
              ${actor.id},
              ${subscription.id},
              'cancel',
              ${input.idempotencyKey},
              ${input.requestHash},
              ${transaction.json(subscription as postgres.JSONValue)}
            )
          `;
        }

        return subscription;
      });
    }
  };
}
