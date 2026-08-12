import type postgres from "postgres";
import { EngagementIdempotencyConflictError } from "./engagement-errors.js";
import type { EngagementRepository } from "./types.js";
import { visibleContentSql, engagementState } from "./engagement-repository-sql.js";

export function createEngagementContentActionRepositoryMethods(
  sql: postgres.Sql
): Pick<EngagementRepository, "toggleLike" | "toggleSave"> {
  return {
    async toggleLike(input) {
      const receipts = await sql<{ target_id: string }[]>`
        with actor as (
          select id
          from users
          where supabase_user_id = ${input.supabaseUserId}
          limit 1
        ),
        visible_content as (
          ${visibleContentSql(sql, input.contentId, input.supabaseUserId)}
        ),
        receipt as (
          insert into engagement_action_receipts (actor_user_id, action, target_id, idempotency_key)
          select actor.id, 'content.like', visible_content.id, ${input.idempotencyKey}
          from actor, visible_content
          on conflict (actor_user_id, action, idempotency_key) do update
          set idempotency_key = engagement_action_receipts.idempotency_key
          returning actor_user_id, target_id
        ),
        mutation as (
          insert into content_reactions (
            user_id,
            content_item_id,
            reaction_key,
            state,
            last_idempotency_key,
            updated_at
          )
          select actor.id, visible_content.id, 'like', 'active', ${input.idempotencyKey}, now()
          from actor, visible_content
          join receipt on receipt.target_id = visible_content.id
          on conflict (user_id, content_item_id, reaction_key) do update
          set
            state = case
              when content_reactions.last_idempotency_key = ${input.idempotencyKey}
                then content_reactions.state
              when content_reactions.state = 'active' then 'inactive'
              else 'active'
            end,
            last_idempotency_key = ${input.idempotencyKey},
            updated_at = now()
          returning user_id
        )
        select receipt.target_id
        from receipt
        join mutation on mutation.user_id = receipt.actor_user_id
      `;

      if (receipts[0]?.target_id !== input.contentId) {
        throw new EngagementIdempotencyConflictError();
      }

      return engagementState(sql, input.supabaseUserId, input.contentId);
    },
    async toggleSave(input) {
      const receipts = await sql<{ target_id: string }[]>`
        with actor as (
          select id
          from users
          where supabase_user_id = ${input.supabaseUserId}
          limit 1
        ),
        visible_content as (
          ${visibleContentSql(sql, input.contentId, input.supabaseUserId)}
        ),
        receipt as (
          insert into engagement_action_receipts (actor_user_id, action, target_id, idempotency_key)
          select actor.id, 'content.save', visible_content.id, ${input.idempotencyKey}
          from actor, visible_content
          on conflict (actor_user_id, action, idempotency_key) do update
          set idempotency_key = engagement_action_receipts.idempotency_key
          returning actor_user_id, target_id
        ),
        mutation as (
          insert into content_saves (
            user_id,
            content_item_id,
            state,
            last_idempotency_key,
            updated_at
          )
          select actor.id, visible_content.id, 'active', ${input.idempotencyKey}, now()
          from actor, visible_content
          join receipt on receipt.target_id = visible_content.id
          on conflict (user_id, content_item_id) do update
          set
            state = case
              when content_saves.last_idempotency_key = ${input.idempotencyKey}
                then content_saves.state
              when content_saves.state = 'active' then 'inactive'
              else 'active'
            end,
            last_idempotency_key = ${input.idempotencyKey},
            updated_at = now()
          returning user_id
        )
        select receipt.target_id
        from receipt
        join mutation on mutation.user_id = receipt.actor_user_id
      `;

      if (receipts[0]?.target_id !== input.contentId) {
        throw new EngagementIdempotencyConflictError();
      }

      return engagementState(sql, input.supabaseUserId, input.contentId);
    }
  };
}
