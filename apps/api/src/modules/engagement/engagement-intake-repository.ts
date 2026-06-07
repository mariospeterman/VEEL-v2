import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import type { EngagementRepository } from "./types.js";
import {
  EngagementPolicyError,
  EngagementRepositoryConfigurationError
} from "./engagement-errors.js";
import { queueForSubject, shareUrl } from "./engagement-repository-mappers.js";
import type { ReportRow, ShareRow } from "./engagement-repository-rows.js";

export function createEngagementIntakeRepositoryMethods(
  sql: postgres.Sql
): Pick<EngagementRepository, "createShare" | "createReport" | "blockUser"> {
  return {
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
    }
  };
}
