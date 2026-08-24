import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import type { EngagementRepository } from "./types.js";
import {
  EngagementIdempotencyConflictError,
  EngagementPolicyError,
  EngagementRepositoryConfigurationError
} from "./engagement-errors.js";
import { queueForSubject, shareUrl } from "./engagement-repository-mappers.js";
import type { ReportReplayRow, ShareReplayRow } from "./engagement-repository-rows.js";

export function createEngagementIntakeRepositoryMethods(
  sql: postgres.Sql
): Pick<EngagementRepository, "createShare" | "createReport"> {
  return {
    async createShare(input) {
      const rows = await sql<ShareReplayRow[]>`
        with actor as (
          select id
          from users
          where supabase_user_id = ${input.supabaseUserId}
          limit 1
        ),
        valid_target as (
          select content.id
          from content_items content
          join actor on true
          join private.eligible_content(actor.id, null) eligible
            on eligible.content_item_id = content.id
          where ${input.body.targetType} = 'content'
            and content.id = ${input.body.targetId}
          union all
          select target.id
          from users target
          join profiles profile on profile.user_id = target.id
          join actor on true
          where ${input.body.targetType} = 'profile'
            and target.id = ${input.body.targetId}
            and profile.handle is not null
            and profile.display_name is not null
            and not exists (
              select 1 from blocks block
              where (block.blocker_user_id = actor.id and block.blocked_user_id = target.id)
                 or (block.blocker_user_id = target.id and block.blocked_user_id = actor.id)
            )
          union all
          select event.id
          from events event
          join actor on true
          where ${input.body.targetType} = 'event'
            and event.id = ${input.body.targetId}
            and event.state in ('published', 'sold_out')
            and not exists (
              select 1 from blocks block
              where (block.blocker_user_id = actor.id and block.blocked_user_id = event.creator_user_id)
                 or (block.blocker_user_id = event.creator_user_id and block.blocked_user_id = actor.id)
            )
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
          from actor, valid_target
          on conflict (actor_user_id, idempotency_key) do update
          set idempotency_key = share_records.idempotency_key
          returning id, actor_user_id, target_type, target_id, mode, url
        ),
        selected as (
          select * from inserted
        ),
        audit as (
          insert into audit_events (
            id,
            actor_user_id,
            subject_type,
            subject_id,
            action,
            idempotency_key,
            metadata
          )
          select
            ${randomUUID()},
            actor_user_id,
            target_type,
            target_id,
            'share.created',
            ${input.idempotencyKey},
            jsonb_build_object('mode', mode)
          from selected
          on conflict do nothing
          returning id
        )
        select id, target_type, target_id, mode, url
        from selected
      `;

      const row = rows[0];
      if (!row) throw new EngagementPolicyError("Share target is not available");
      if (
        row.target_type !== input.body.targetType ||
        row.target_id !== input.body.targetId ||
        row.mode !== input.body.mode
      ) {
        throw new EngagementIdempotencyConflictError();
      }
      return { id: row.id, mode: row.mode, url: row.url };
    },
    async createReport(input) {
      const queue = queueForSubject(input.body.subjectType);
      const rows = await sql<ReportReplayRow[]>`
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
          on conflict (reporter_user_id, idempotency_key) do update
          set idempotency_key = reports.idempotency_key
          returning id, reporter_user_id, subject_type, subject_id, reason, state, queue
        ),
        selected as (
          select * from inserted
        ),
        audit as (
          insert into audit_events (
            id,
            actor_user_id,
            subject_type,
            subject_id,
            action,
            idempotency_key,
            metadata
          )
          select
            ${randomUUID()},
            reporter_user_id,
            subject_type,
            subject_id,
            'report.created',
            ${input.idempotencyKey},
            jsonb_build_object('queue', queue)
          from selected
          on conflict do nothing
          returning id
        )
        select id, subject_type, subject_id, reason, state, queue
        from selected
      `;

      const row = rows[0];
      if (!row) throw new EngagementRepositoryConfigurationError();
      if (
        row.subject_type !== input.body.subjectType ||
        row.subject_id !== input.body.subjectId ||
        row.reason !== input.body.reason
      ) {
        throw new EngagementIdempotencyConflictError();
      }
      return { id: row.id, state: row.state, queue: row.queue };
    }
  };
}
