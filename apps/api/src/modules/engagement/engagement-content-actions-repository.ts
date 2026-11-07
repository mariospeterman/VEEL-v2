import type postgres from "postgres";
import { EngagementIdempotencyConflictError } from "./engagement-errors.js";
import type { EngagementRepository } from "./types.js";
import { visibleContentSql, engagementState } from "./engagement-repository-sql.js";

export function createEngagementContentActionRepositoryMethods(
  sql: postgres.Sql
): Pick<EngagementRepository, "toggleLike" | "toggleSave"> {
  return {
    async toggleLike(input) {
      return sql.begin(async (transaction) => {
        const claimed = await transaction<{ target_id: string }[]>`
          with actor as (
            select id
            from users
            where supabase_user_id = ${input.supabaseUserId}
            limit 1
          ),
          visible_content as (
            ${visibleContentSql(transaction, input.contentId, input.supabaseUserId)}
          )
          insert into engagement_action_receipts (actor_user_id, action, target_id, idempotency_key)
          select actor.id, 'content.like', visible_content.id, ${input.idempotencyKey}
          from actor, visible_content
          on conflict (actor_user_id, action, idempotency_key) do nothing
          returning target_id
        `;
        const receipt = claimed[0] ?? (await transaction<{ target_id: string }[]>`
          with actor as (
            select id
            from users
            where supabase_user_id = ${input.supabaseUserId}
            limit 1
          ),
          visible_content as (
            ${visibleContentSql(transaction, input.contentId, input.supabaseUserId)}
          )
          select receipt.target_id
          from engagement_action_receipts receipt, actor, visible_content
          where receipt.actor_user_id = actor.id
            and receipt.action = 'content.like'
            and receipt.idempotency_key = ${input.idempotencyKey}
        `)[0];

        if (receipt?.target_id !== input.contentId) throw new EngagementIdempotencyConflictError();

        if (claimed.length > 0) {
          await transaction`
            insert into content_reactions (
              user_id,
              content_item_id,
              reaction_key,
              state,
              last_idempotency_key,
              updated_at
            )
            select actor.id, ${input.contentId}, 'like', 'active', ${input.idempotencyKey}, now()
            from users actor
            where actor.supabase_user_id = ${input.supabaseUserId}
            on conflict (user_id, content_item_id, reaction_key) do update
            set
              state = case when content_reactions.state = 'active' then 'inactive' else 'active' end,
              last_idempotency_key = ${input.idempotencyKey},
              updated_at = now()
          `;
        }

        return engagementState(transaction, input.supabaseUserId, input.contentId);
      });
    },
    async toggleSave(input) {
      return sql.begin(async (transaction) => {
        const claimed = await transaction<{ target_id: string }[]>`
          with actor as (
            select id
            from users
            where supabase_user_id = ${input.supabaseUserId}
            limit 1
          ),
          visible_content as (
            ${visibleContentSql(transaction, input.contentId, input.supabaseUserId)}
          )
          insert into engagement_action_receipts (actor_user_id, action, target_id, idempotency_key)
          select actor.id, 'content.save', visible_content.id, ${input.idempotencyKey}
          from actor, visible_content
          on conflict (actor_user_id, action, idempotency_key) do nothing
          returning target_id
        `;
        const receipt = claimed[0] ?? (await transaction<{ target_id: string }[]>`
          with actor as (
            select id
            from users
            where supabase_user_id = ${input.supabaseUserId}
            limit 1
          ),
          visible_content as (
            ${visibleContentSql(transaction, input.contentId, input.supabaseUserId)}
          )
          select receipt.target_id
          from engagement_action_receipts receipt, actor, visible_content
          where receipt.actor_user_id = actor.id
            and receipt.action = 'content.save'
            and receipt.idempotency_key = ${input.idempotencyKey}
        `)[0];

        if (receipt?.target_id !== input.contentId) throw new EngagementIdempotencyConflictError();

        if (claimed.length > 0) {
          await transaction`
            insert into content_saves (
              user_id,
              content_item_id,
              state,
              last_idempotency_key,
              updated_at
            )
            select actor.id, ${input.contentId}, 'active', ${input.idempotencyKey}, now()
            from users actor
            where actor.supabase_user_id = ${input.supabaseUserId}
            on conflict (user_id, content_item_id) do update
            set
              state = case when content_saves.state = 'active' then 'inactive' else 'active' end,
              last_idempotency_key = ${input.idempotencyKey},
              updated_at = now()
          `;
        }

        return engagementState(transaction, input.supabaseUserId, input.contentId);
      });
    }
  };
}
