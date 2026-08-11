import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import type { EngagementRepository } from "./types.js";
import { EngagementIdempotencyConflictError, EngagementPolicyError } from "./engagement-errors.js";
import { toComment } from "./engagement-repository-mappers.js";
import type { CommentReplayRow, CommentRow } from "./engagement-repository-rows.js";
import { visibleContentSql } from "./engagement-repository-sql.js";

export function createEngagementCommentRepositoryMethods(
  sql: postgres.Sql
): Pick<EngagementRepository, "listComments" | "createComment"> {
  return {
    async listComments(input) {
      const rows = await sql<CommentRow[]>`
        with visible_content as (
          ${visibleContentSql(sql, input.contentId, input.supabaseUserId)}
        )
        select
          c.id,
          c.body,
          c.moderation_state,
          c.created_at,
          u.id as author_id,
          p.handle,
          p.display_name,
          p.avatar_url
        from comments c
        join visible_content on visible_content.id = c.content_item_id
        join users u on u.id = c.user_id
        left join profiles p on p.user_id = u.id
        where c.moderation_state = 'visible'
          and (${input.cursor ?? null}::timestamptz is null or c.created_at < ${input.cursor ?? null}::timestamptz)
        order by c.created_at desc
        limit ${input.limit + 1}
      `;
      const visibleRows = rows.slice(0, input.limit);
      const next = rows[input.limit];

      return {
        items: visibleRows.map(toComment),
        nextCursor: next ? next.created_at.toISOString() : null
      };
    },
    async createComment(input) {
      const rows = await sql<CommentReplayRow[]>`
        with actor as (
          select id
          from users
          where supabase_user_id = ${input.supabaseUserId}
          limit 1
        ),
        visible_content as (
          ${visibleContentSql(sql, input.contentId, input.supabaseUserId)}
        ),
        inserted as (
          insert into comments (
            id,
            content_item_id,
            user_id,
            body,
            moderation_state,
            idempotency_key
          )
          select
            ${randomUUID()},
            visible_content.id,
            actor.id,
            ${input.body.body},
            'visible',
            ${input.idempotencyKey}
          from actor, visible_content
          on conflict (user_id, idempotency_key) do update
          set idempotency_key = comments.idempotency_key
          returning id, content_item_id, user_id, body, moderation_state, created_at
        )
        select
          c.id,
          c.content_item_id,
          c.body,
          c.moderation_state,
          c.created_at,
          u.id as author_id,
          p.handle,
          p.display_name,
          p.avatar_url
        from inserted c
        join users u on u.id = c.user_id
        left join profiles p on p.user_id = u.id
        limit 1
      `;

      const row = rows[0];
      if (!row) throw new EngagementPolicyError("Comment is not allowed");
      if (row.content_item_id !== input.contentId || row.body !== input.body.body) {
        throw new EngagementIdempotencyConflictError();
      }
      return toComment(row);
    }
  };
}
