import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import {
  decodeTimestampIdCursor,
  encodeTimestampIdCursor,
  keysetPage
} from "../../shared/keyset-pagination.js";
import type { EngagementRepository } from "./types.js";
import { EngagementIdempotencyConflictError, EngagementPolicyError } from "./engagement-errors.js";
import { toComment } from "./engagement-repository-mappers.js";
import type { CommentReplayRow, CommentRow } from "./engagement-repository-rows.js";
import { visibleContentSql } from "./engagement-repository-sql.js";

const mentionPattern = /(?:^|\s)@([a-z0-9_]{2,32})\b/gi;
export const engagementCommentsCursorScope = "GET /v1/engagement/:contentId/comments";

export function createEngagementCommentRepositoryMethods(
  sql: postgres.Sql
): Pick<EngagementRepository, "listComments" | "createComment" | "toggleCommentLike"> {
  return {
    async listComments(input) {
      const cursor = decodeTimestampIdCursor(engagementCommentsCursorScope, input.cursor);
      const rows = await sql<CommentRow[]>`
        with actor as (
          select id from users where supabase_user_id = ${input.supabaseUserId} limit 1
        ),
        visible_content as (
          ${visibleContentSql(sql, input.contentId, input.supabaseUserId)}
        )
        select
          c.id,
          c.body,
          c.moderation_state,
          c.parent_comment_id,
          c.created_at,
          u.id as author_id,
          p.handle,
          p.display_name,
          p.avatar_url,
          exists (
            select 1 from comment_reactions reaction, actor
            where reaction.comment_id = c.id
              and reaction.user_id = actor.id
              and reaction.state = 'active'
          ) as liked,
          (select count(*) from comment_reactions reaction
            where reaction.comment_id = c.id and reaction.state = 'active') as like_count,
          (select count(*) from comments reply
            where reply.parent_comment_id = c.id
              and reply.moderation_state = 'visible'
              and not exists (
                select 1 from blocks reply_block
                where (reply_block.blocker_user_id = actor.id and reply_block.blocked_user_id = reply.user_id)
                   or (reply_block.blocker_user_id = reply.user_id and reply_block.blocked_user_id = actor.id)
              )
              and not exists (
                select 1 from user_mutes reply_mute
                where reply_mute.muting_user_id = actor.id and reply_mute.muted_user_id = reply.user_id
              )) as reply_count,
          coalesce((
            select jsonb_agg(jsonb_build_object(
              'id', mentioned.id,
              'handle', mentioned_profile.handle,
              'displayName', mentioned_profile.display_name,
              'avatarUrl', mentioned_profile.avatar_url
            ) order by mentioned_profile.handle)
            from comment_mentions mention
            join users mentioned on mentioned.id = mention.mentioned_user_id
            left join profiles mentioned_profile on mentioned_profile.user_id = mentioned.id
            where mention.comment_id = c.id
              and not exists (
                select 1 from user_mutes mute
                where mute.muting_user_id = actor.id and mute.muted_user_id = mentioned.id
              )
              and not exists (
                select 1 from blocks block
                where (block.blocker_user_id = actor.id and block.blocked_user_id = mentioned.id)
                   or (block.blocker_user_id = mentioned.id and block.blocked_user_id = actor.id)
              )
              and mentioned.state = 'active'
              and not exists (
                select 1 from blocks mention_block
                where (mention_block.blocker_user_id = actor.id and mention_block.blocked_user_id = mentioned.id)
                   or (mention_block.blocker_user_id = mentioned.id and mention_block.blocked_user_id = actor.id)
              )
              and not exists (
                select 1 from user_mutes mention_mute
                where mention_mute.muting_user_id = actor.id and mention_mute.muted_user_id = mentioned.id
              )
          ), '[]'::jsonb) as mentions
        from comments c
        join visible_content on visible_content.id = c.content_item_id
        join users u on u.id = c.user_id
        left join profiles p on p.user_id = u.id
        join actor on true
        where c.moderation_state = 'visible'
          and (c.parent_comment_id is null or exists (
            select 1 from comments parent
            where parent.id = c.parent_comment_id
              and parent.content_item_id = c.content_item_id
              and parent.moderation_state = 'visible'
          ))
          and not exists (
            select 1 from blocks block
            where (block.blocker_user_id = actor.id and block.blocked_user_id = c.user_id)
               or (block.blocker_user_id = c.user_id and block.blocked_user_id = actor.id)
          )
          and not exists (
            select 1 from user_mutes mute
            where mute.muting_user_id = actor.id and mute.muted_user_id = c.user_id
          )
          and (
            ${cursor.timestamp}::timestamptz is null
            or (
              ${cursor.id}::uuid is null
              and c.created_at <= ${cursor.timestamp}::timestamptz
            )
            or (
              ${cursor.id}::uuid is not null
              and (c.created_at, c.id) < (${cursor.timestamp}::timestamptz, ${cursor.id}::uuid)
            )
          )
        order by c.created_at desc, c.id desc
        limit ${input.limit + 1}
      `;

      return keysetPage(rows, input.limit, toComment, (row) =>
        encodeTimestampIdCursor(engagementCommentsCursorScope, row.created_at, row.id)
      );
    },
    async createComment(input) {
      return sql.begin(async (transaction) => {
        const parentCommentId = input.body.parentCommentId ?? null;
        const rows = await transaction<CommentReplayRow[]>`
          with actor as (
            select id
            from users
            where supabase_user_id = ${input.supabaseUserId}
            limit 1
          ),
          visible_content as (
            ${visibleContentSql(transaction, input.contentId, input.supabaseUserId)}
          ),
          valid_parent as (
            select null::uuid as id
            where ${parentCommentId}::uuid is null
            union all
            select parent.id
            from comments parent, actor
            where parent.id = ${parentCommentId}::uuid
              and parent.content_item_id = ${input.contentId}
              and parent.parent_comment_id is null
              and parent.moderation_state = 'visible'
              and not exists (
                select 1 from blocks block
                where (block.blocker_user_id = actor.id and block.blocked_user_id = parent.user_id)
                   or (block.blocker_user_id = parent.user_id and block.blocked_user_id = actor.id)
              )
              and not exists (
                select 1 from user_mutes mute
                where mute.muting_user_id = actor.id and mute.muted_user_id = parent.user_id
              )
          ),
          inserted as (
            insert into comments (
              id,
              content_item_id,
              user_id,
              parent_comment_id,
              body,
              moderation_state,
              idempotency_key
            )
            select
              ${randomUUID()},
              visible_content.id,
              actor.id,
              valid_parent.id,
              ${input.body.body},
              'visible',
              ${input.idempotencyKey}
            from actor, visible_content, valid_parent
            on conflict (user_id, idempotency_key) do update
            set idempotency_key = comments.idempotency_key
            returning id, content_item_id, user_id, parent_comment_id, body, moderation_state, created_at
          )
          select
            c.id,
            c.content_item_id,
            c.body,
            c.moderation_state,
            c.parent_comment_id,
            c.created_at,
            u.id as author_id,
            p.handle,
            p.display_name,
            p.avatar_url,
            false as liked,
            (select count(*) from comment_reactions reaction
              where reaction.comment_id = c.id and reaction.state = 'active') as like_count,
            (select count(*) from comments reply
              where reply.parent_comment_id = c.id and reply.moderation_state = 'visible') as reply_count,
            '[]'::jsonb as mentions
          from inserted c
          join users u on u.id = c.user_id
          left join profiles p on p.user_id = u.id
          limit 1
        `;

        const row = rows[0];
        if (!row) throw new EngagementPolicyError("Comment is not allowed");
        if (
          row.content_item_id !== input.contentId ||
          row.body !== input.body.body ||
          row.parent_comment_id !== parentCommentId
        ) {
          throw new EngagementIdempotencyConflictError();
        }

        const handles = extractMentionHandles(input.body.body);
        if (handles.length > 0) {
          await transaction`
            with actor as (
              select id from users where supabase_user_id = ${input.supabaseUserId} limit 1
            )
            insert into comment_mentions (comment_id, mentioned_user_id)
            select ${row.id}, mentioned.id
            from users mentioned
            join profiles profile on profile.user_id = mentioned.id
            join actor on true
            where lower(profile.handle) = any(${transaction.array(handles)}::text[])
              and mentioned.id <> actor.id
              and mentioned.state = 'active'
              and not exists (
                select 1 from blocks block
                where (block.blocker_user_id = actor.id and block.blocked_user_id = mentioned.id)
                   or (block.blocker_user_id = mentioned.id and block.blocked_user_id = actor.id)
              )
              and not exists (
                select 1 from user_mutes mute
                where mute.muting_user_id = actor.id and mute.muted_user_id = mentioned.id
              )
            on conflict do nothing
          `;
          await transaction`
            insert into notifications (
              id, user_id, kind, title, body, action_url,
              related_resource_type, related_resource_id, idempotency_key
            )
            select
              gen_random_uuid(), mention.mentioned_user_id, 'engagement', 'You were mentioned',
              'Someone mentioned you in a comment.', '/content/' || ${input.contentId},
              'content', ${input.contentId}, 'comment-mention:' || ${row.id} || ':' || mention.mentioned_user_id
            from comment_mentions mention
            join comments source_comment on source_comment.id = mention.comment_id
            where mention.comment_id = ${row.id}
              and not exists (
                select 1
                from user_mutes recipient_mute
                where recipient_mute.muting_user_id = mention.mentioned_user_id
                  and recipient_mute.muted_user_id = source_comment.user_id
              )
            on conflict (user_id, idempotency_key) do nothing
          `;
        }

        const hydrated = await transaction<CommentRow[]>`
          with actor as (
            select id from users where supabase_user_id = ${input.supabaseUserId} limit 1
          )
          select
            c.id,
            c.body,
            c.moderation_state,
            c.parent_comment_id,
            c.created_at,
            u.id as author_id,
            p.handle,
            p.display_name,
            p.avatar_url,
            false as liked,
            (select count(*) from comment_reactions reaction
              where reaction.comment_id = c.id and reaction.state = 'active') as like_count,
            (select count(*) from comments reply
              where reply.parent_comment_id = c.id
                and reply.moderation_state = 'visible'
                and not exists (
                  select 1 from blocks reply_block
                  where (reply_block.blocker_user_id = actor.id and reply_block.blocked_user_id = reply.user_id)
                     or (reply_block.blocker_user_id = reply.user_id and reply_block.blocked_user_id = actor.id)
                )
                and not exists (
                  select 1 from user_mutes reply_mute
                  where reply_mute.muting_user_id = actor.id and reply_mute.muted_user_id = reply.user_id
                )) as reply_count,
            coalesce((
              select jsonb_agg(jsonb_build_object(
                'id', mentioned.id,
                'handle', mentioned_profile.handle,
                'displayName', mentioned_profile.display_name,
                'avatarUrl', mentioned_profile.avatar_url
              ) order by mentioned_profile.handle)
              from comment_mentions mention
              join users mentioned on mentioned.id = mention.mentioned_user_id
              left join profiles mentioned_profile on mentioned_profile.user_id = mentioned.id
              where mention.comment_id = c.id
                and mentioned.state = 'active'
                and not exists (
                  select 1 from blocks mention_block
                  where (mention_block.blocker_user_id = actor.id and mention_block.blocked_user_id = mentioned.id)
                     or (mention_block.blocker_user_id = mentioned.id and mention_block.blocked_user_id = actor.id)
                )
                and not exists (
                  select 1 from user_mutes mention_mute
                  where mention_mute.muting_user_id = actor.id and mention_mute.muted_user_id = mentioned.id
                )
            ), '[]'::jsonb) as mentions
          from comments c
          join users u on u.id = c.user_id
          left join profiles p on p.user_id = u.id
          join actor on true
          where c.id = ${row.id}
        `;
        return toComment(hydrated[0] ?? row);
      });
    },
    async toggleCommentLike(input) {
      return sql.begin(async (transaction) => {
        const claimed = await transaction<{ target_id: string }[]>`
          with actor as (
            select id from users where supabase_user_id = ${input.supabaseUserId} limit 1
          ),
          visible_comment as (
            ${visibleCommentSql(transaction, input.commentId)}
          )
          insert into engagement_action_receipts (actor_user_id, action, target_id, idempotency_key)
          select actor.id, 'comment.like', visible_comment.id, ${input.idempotencyKey}
          from actor, visible_comment
          on conflict (actor_user_id, action, idempotency_key) do nothing
          returning target_id
        `;
        const receipt = claimed[0] ?? (await transaction<{ target_id: string }[]>`
          with actor as (
            select id from users where supabase_user_id = ${input.supabaseUserId} limit 1
          ),
          visible_comment as (
            ${visibleCommentSql(transaction, input.commentId)}
          )
          select receipt.target_id
          from engagement_action_receipts receipt, actor, visible_comment
          where receipt.actor_user_id = actor.id
            and receipt.action = 'comment.like'
            and receipt.idempotency_key = ${input.idempotencyKey}
        `)[0];

        if (receipt?.target_id !== input.commentId) throw new EngagementIdempotencyConflictError();

        if (claimed.length > 0) {
          await transaction`
            insert into comment_reactions (comment_id, user_id, reaction_key, state, last_idempotency_key)
            select ${input.commentId}, actor.id, 'like', 'active', ${input.idempotencyKey}
            from users actor
            where actor.supabase_user_id = ${input.supabaseUserId}
            on conflict (comment_id, user_id, reaction_key) do update
            set
              state = case when comment_reactions.state = 'active' then 'inactive' else 'active' end,
              last_idempotency_key = ${input.idempotencyKey},
              updated_at = now()
          `;
        }

        const states = await transaction<{ like_count: string | number; liked: boolean }[]>`
          with actor as (
            select id from users where supabase_user_id = ${input.supabaseUserId} limit 1
          )
          select
            count(*) filter (where reaction.state = 'active') as like_count,
            coalesce(bool_or(reaction.user_id = actor.id and reaction.state = 'active'), false) as liked
          from actor
          left join comment_reactions reaction on reaction.comment_id = ${input.commentId}
        `;
        return {
          commentId: input.commentId,
          liked: Boolean(states[0]?.liked),
          likeCount: Number(states[0]?.like_count ?? 0)
        };
      });
    }
  };
}

function visibleCommentSql(sql: postgres.TransactionSql, commentId: string) {
  return sql`
    select comment.id
    from comments comment
    join content_items content on content.id = comment.content_item_id
    join actor on true
    join private.eligible_content(actor.id, null) eligible on eligible.content_item_id = content.id
    where comment.id = ${commentId}
      and comment.moderation_state = 'visible'
      and (comment.parent_comment_id is null or exists (
        select 1 from comments parent
        where parent.id = comment.parent_comment_id
          and parent.content_item_id = comment.content_item_id
          and parent.moderation_state = 'visible'
      ))
      and not exists (
        select 1 from blocks block
        where (block.blocker_user_id = actor.id and block.blocked_user_id = comment.user_id)
           or (block.blocker_user_id = comment.user_id and block.blocked_user_id = actor.id)
      )
      and not exists (
        select 1 from user_mutes mute
        where mute.muting_user_id = actor.id and mute.muted_user_id = comment.user_id
      )
  `;
}

function extractMentionHandles(body: string): string[] {
  return [...body.matchAll(mentionPattern)]
    .map((match) => match[1]?.toLowerCase())
    .filter((handle): handle is string => Boolean(handle))
    .filter((handle, index, handles) => handles.indexOf(handle) === index)
    .slice(0, 10);
}
