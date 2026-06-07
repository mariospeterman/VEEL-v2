import { randomUUID } from "node:crypto";
import postgres from "postgres";
import type { EngagementRepository } from "./types.js";
import {
  EngagementPolicyError,
  EngagementRepositoryConfigurationError
} from "./engagement-errors.js";
import { createEngagementPreferencesRepositoryMethods } from "./engagement-preferences-repository.js";
import {
  queueForSubject,
  shareUrl,
  toComment,
} from "./engagement-repository-mappers.js";
import type {
  CommentRow,
  ReportRow,
  ShareRow
} from "./engagement-repository-rows.js";
import {
  engagementState,
  visibleContentSql
} from "./engagement-repository-sql.js";

export {
  EngagementPolicyError,
  EngagementRepositoryConfigurationError
} from "./engagement-errors.js";

export function createPostgresEngagementRepository(databaseUrl?: string): EngagementRepository {
  if (!databaseUrl) {
    return {
      async getFeedPreferences() {
        throw new EngagementRepositoryConfigurationError();
      },
      async updateFeedPreferences() {
        throw new EngagementRepositoryConfigurationError();
      },
      async resetFeedRecommendations() {
        throw new EngagementRepositoryConfigurationError();
      },
      async hideCreator() {
        throw new EngagementRepositoryConfigurationError();
      },
      async hideTopic() {
        throw new EngagementRepositoryConfigurationError();
      },
      async toggleLike() {
        throw new EngagementRepositoryConfigurationError();
      },
      async toggleSave() {
        throw new EngagementRepositoryConfigurationError();
      },
      async listComments() {
        throw new EngagementRepositoryConfigurationError();
      },
      async createComment() {
        throw new EngagementRepositoryConfigurationError();
      },
      async createShare() {
        throw new EngagementRepositoryConfigurationError();
      },
      async createReport() {
        throw new EngagementRepositoryConfigurationError();
      },
      async blockUser() {
        throw new EngagementRepositoryConfigurationError();
      }
    };
  }

  const sql = postgres(databaseUrl, {
    max: 5,
    idle_timeout: 20,
    prepare: false
  });

  return {
    ...createEngagementPreferencesRepositoryMethods(sql),
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
    },
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
      const rows = await sql<CommentRow[]>`
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
          on conflict (user_id, idempotency_key) do nothing
          returning id, user_id, body, moderation_state, created_at
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
        from (
          select * from inserted
          union all
          select id, user_id, body, moderation_state, created_at
          from comments
          where user_id = (select id from actor)
            and idempotency_key = ${input.idempotencyKey}
        ) c
        join users u on u.id = c.user_id
        left join profiles p on p.user_id = u.id
        limit 1
      `;

      const row = rows[0];
      if (!row) throw new EngagementPolicyError("Comment is not allowed");
      return toComment(row);
    },
    async createShare(input) {
      const rows = await sql<ShareRow[]>`
        with actor as (
          select id
          from users
          where supabase_user_id = ${input.supabaseUserId}
          limit 1
        ),
        inserted as (
          insert into share_records (
            id,
            actor_user_id,
            target_type,
            target_id,
            mode,
            url,
            idempotency_key
          )
          select
            ${randomUUID()},
            actor.id,
            ${input.body.targetType},
            ${input.body.targetId},
            ${input.body.mode},
            ${shareUrl(input.webUrl, input.body.targetType, input.body.targetId, input.body.mode)},
            ${input.idempotencyKey}
          from actor
          on conflict (actor_user_id, idempotency_key) do nothing
          returning id, actor_user_id, target_type, target_id, mode, url
        ),
        existing as (
          select id, actor_user_id, target_type, target_id, mode, url
          from share_records
          where actor_user_id = (select id from actor)
            and idempotency_key = ${input.idempotencyKey}
        ),
        selected as (
          select * from inserted
          union all
          select * from existing
          limit 1
        ),
        audit as (
          insert into audit_events (id, actor_user_id, subject_type, subject_id, action, metadata)
          select ${randomUUID()}, actor_user_id, target_type, target_id, 'share.created', jsonb_build_object('mode', mode)
          from selected
          on conflict do nothing
          returning id
        )
        select id, mode, url
        from selected
      `;

      const row = rows[0];
      if (!row) throw new EngagementRepositoryConfigurationError();
      return { id: row.id, mode: row.mode, url: row.url };
    },
    async createReport(input) {
      const queue = queueForSubject(input.body.subjectType);
      const rows = await sql<ReportRow[]>`
        with actor as (
          select id
          from users
          where supabase_user_id = ${input.supabaseUserId}
          limit 1
        ),
        inserted as (
          insert into reports (
            id,
            reporter_user_id,
            subject_type,
            subject_id,
            reason,
            queue,
            state,
            idempotency_key
          )
          select
            ${randomUUID()},
            actor.id,
            ${input.body.subjectType},
            ${input.body.subjectId},
            ${input.body.reason},
            ${queue},
            'queued',
            ${input.idempotencyKey}
          from actor
          on conflict (reporter_user_id, idempotency_key) do nothing
          returning id, reporter_user_id, subject_type, subject_id, state, queue
        ),
        existing as (
          select id, reporter_user_id, subject_type, subject_id, state, queue
          from reports
          where reporter_user_id = (select id from actor)
            and idempotency_key = ${input.idempotencyKey}
        ),
        selected as (
          select * from inserted
          union all
          select * from existing
          limit 1
        ),
        audit as (
          insert into audit_events (id, actor_user_id, subject_type, subject_id, action, metadata)
          select ${randomUUID()}, reporter_user_id, subject_type, subject_id, 'report.created', jsonb_build_object('queue', queue)
          from selected
          on conflict do nothing
          returning id
        )
        select id, state, queue
        from selected
      `;

      const row = rows[0];
      if (!row) throw new EngagementRepositoryConfigurationError();
      return { id: row.id, state: row.state, queue: row.queue };
    },
    async blockUser(input) {
      const rows = await sql<{ blocked_user_id: string }[]>`
        with actor as (
          select id
          from users
          where supabase_user_id = ${input.supabaseUserId}
          limit 1
        ),
        target_user as (
          select id
          from users
          where id = ${input.blockedUserId}
          limit 1
        ),
        inserted as (
          insert into blocks (blocker_user_id, blocked_user_id, idempotency_key)
          select actor.id, target_user.id, ${input.idempotencyKey}
          from actor, target_user
          where actor.id <> target_user.id
          on conflict (blocker_user_id, blocked_user_id) do update
          set idempotency_key = blocks.idempotency_key
          returning blocker_user_id, blocked_user_id
        ),
        audit as (
          insert into audit_events (id, actor_user_id, subject_type, subject_id, action, metadata)
          select ${randomUUID()}, blocker_user_id, 'user', blocked_user_id, 'user.blocked', '{}'::jsonb
          from inserted
          on conflict do nothing
          returning id
        )
        select blocked_user_id
        from inserted
        limit 1
      `;

      const row = rows[0];
      if (!row) throw new EngagementPolicyError("Block is not allowed");
      return { blocked: true, blockedUserId: row.blocked_user_id };
    },
    async close() {
      await sql.end({ timeout: 5 });
    }
  };
}
