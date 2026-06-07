import type postgres from "postgres";
import type { EngagementRepository } from "./types.js";
import { visibleContentSql, engagementState } from "./engagement-repository-sql.js";

export function createEngagementContentActionRepositoryMethods(
  sql: postgres.Sql
): Pick<EngagementRepository, "toggleLike" | "toggleSave"> {
  return {
    async toggleLike(input) {
      await sql`
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
          on conflict (actor_user_id, action, idempotency_key) do nothing
          returning actor_user_id
        )
        insert into content_reactions (
          user_id,
          content_item_id,
          reaction_key,
          state,
          last_idempotency_key,
          updated_at
        )
        select actor.id, visible_content.id, 'like', 'active', ${input.idempotencyKey}, now()
        from actor, visible_content, receipt
        on conflict (user_id, content_item_id, reaction_key) do update
        set
          state = case
            when content_reactions.state = 'active' then 'inactive'
            else 'active'
          end,
          last_idempotency_key = ${input.idempotencyKey},
          updated_at = now()
      `;

      return engagementState(sql, input.supabaseUserId, input.contentId);
    },
    async toggleSave(input) {
      await sql`
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
          on conflict (actor_user_id, action, idempotency_key) do nothing
          returning actor_user_id
        )
        insert into content_saves (
          user_id,
          content_item_id,
          state,
          last_idempotency_key,
          updated_at
        )
        select actor.id, visible_content.id, 'active', ${input.idempotencyKey}, now()
        from actor, visible_content, receipt
        on conflict (user_id, content_item_id) do update
        set
          state = case
            when content_saves.state = 'active' then 'inactive'
            else 'active'
          end,
          last_idempotency_key = ${input.idempotencyKey},
          updated_at = now()
      `;

      return engagementState(sql, input.supabaseUserId, input.contentId);
    }
  };
}
