import type postgres from "postgres";
import type { AdminRepository } from "./types.js";
import {
  AdminContentRow,
  AdminReportRow,
  pageSize,
  page,
  toAdminContentItem,
  toAdminReport,
  contentModerationForAction
} from "./admin-repository-mappers.js";

export function createModerationRepository(
  sql: postgres.Sql
): Pick<AdminRepository, "listContent" | "updateContentModeration" | "listReports" | "updateReport"> {
  return {
    async listContent(input) {
      const rows = await sql<AdminContentRow[]>`
        select
          ci.id,
          u.id as creator_id,
          p.handle,
          p.display_name,
          p.avatar_url,
          ci.moderation_state,
          ci.state,
          ci.created_at
        from content_items ci
        join users u on u.id = ci.creator_user_id
        join profiles p on p.user_id = u.id
        where (${input.cursor ?? null}::timestamptz is null or ci.created_at < ${input.cursor ?? null}::timestamptz)
        order by
          case when ci.moderation_state in ('pending', 'reported', 'restricted') then 0 else 1 end,
          ci.created_at desc
        limit ${pageSize + 1}
      `;

      return page(rows, toAdminContentItem);
    },
    async updateContentModeration(input) {
      const moderation = contentModerationForAction(input.body.action);
      const rows = await sql.begin(async (transaction) => {
        const updatedRows = await transaction<AdminContentRow[]>`
          with actor as (
            select id
            from users
            where supabase_user_id = ${input.supabaseUserId}
            limit 1
          ),
          current_content as (
            select id, state, moderation_state, publish_state
            from content_items
            where id = ${input.contentId}
            for update
          ),
          updated_content as (
            update content_items ci
            set
              moderation_state = ${moderation.moderationState},
              state = ${moderation.state}::content_state,
              publish_state = case
                when ${input.body.action} in ('approve', 'reinstate')
                  and cc.publish_state = 'submitted_for_review'
                  and ${moderation.state} = 'ready'
                then 'published'
                when ${input.body.action} = 'block' then 'blocked'
                when ${input.body.action} = 'delete' then 'blocked'
                else ci.publish_state
              end,
              published_at = case
                when ${input.body.action} in ('approve', 'reinstate')
                  and cc.publish_state = 'submitted_for_review'
                  and ${moderation.state} = 'ready'
                then coalesce(ci.published_at, now())
                else ci.published_at
              end,
              updated_at = now()
            from current_content cc
            where ci.id = cc.id
            returning
              ci.id,
              ci.creator_user_id,
              ci.moderation_state,
              ci.state,
              ci.publish_state,
              ci.created_at,
              cc.state::text as previous_state,
              cc.publish_state as previous_publish_state,
              cc.moderation_state as previous_moderation_state
          ),
          audit_insert as (
            insert into audit_events (
              id,
              actor_user_id,
              subject_type,
              subject_id,
              action,
              metadata
            )
            select
              gen_random_uuid(),
              actor.id,
              'content',
              updated_content.id,
              'content_moderation_updated',
              jsonb_build_object(
                'reason', ${input.body.reason},
                'idempotencyKey', ${input.idempotencyKey},
                'adminAction', ${input.body.action},
                'previousState', updated_content.previous_state,
                'newState', updated_content.state,
                'previousPublishState', updated_content.previous_publish_state,
                'newPublishState', updated_content.publish_state,
                'previousModerationState', updated_content.previous_moderation_state,
                'newModerationState', updated_content.moderation_state
              )
            from updated_content
            cross join actor
            returning id
          )
          select
            updated_content.id,
            u.id as creator_id,
            p.handle,
            p.display_name,
            p.avatar_url,
            updated_content.moderation_state,
            updated_content.state,
            updated_content.created_at
          from updated_content
          join users u on u.id = updated_content.creator_user_id
          join profiles p on p.user_id = u.id
          where exists (select 1 from audit_insert)
        `;

        return updatedRows;
      });

      return rows[0] ? toAdminContentItem(rows[0]) : null;
    },
    async listReports(input) {
      const rows = await sql<AdminReportRow[]>`
        select id, subject_type, subject_id, state, reason, created_at
        from reports
        where (${input.cursor ?? null}::timestamptz is null or created_at < ${input.cursor ?? null}::timestamptz)
        order by
          case when state in ('submitted', 'queued', 'reviewing', 'escalated') then 0 else 1 end,
          created_at desc
        limit ${pageSize + 1}
      `;

      return page(rows, toAdminReport);
    },
    async updateReport(input) {
      const rows = await sql.begin(async (transaction) => {
        const updatedRows = await transaction<AdminReportRow[]>`
          with actor as (
            select id
            from users
            where supabase_user_id = ${input.supabaseUserId}
            limit 1
          ),
          current_report as (
            select id, state
            from reports
            where id = ${input.reportId}
            for update
          ),
          updated_report as (
            update reports r
            set
              state = ${input.body.state},
              reviewed_at = case
                when ${input.body.state} in ('resolved', 'rejected') then coalesce(r.reviewed_at, now())
                else r.reviewed_at
              end
            from current_report cr
            where r.id = cr.id
            returning
              r.id,
              r.subject_type,
              r.subject_id,
              r.state,
              r.reason,
              r.created_at,
              cr.state as previous_state
          ),
          audit_insert as (
            insert into audit_events (
              id,
              actor_user_id,
              subject_type,
              subject_id,
              action,
              metadata
            )
            select
              gen_random_uuid(),
              actor.id,
              'report',
              updated_report.id,
              'report_review_updated',
              jsonb_build_object(
                'reason', ${input.body.reason},
                'idempotencyKey', ${input.idempotencyKey},
                'reportedSubjectType', updated_report.subject_type,
                'reportedSubjectId', updated_report.subject_id,
                'previousState', updated_report.previous_state,
                'newState', updated_report.state
              )
            from updated_report
            cross join actor
            returning id
          )
          select id, subject_type, subject_id, state, reason, created_at
          from updated_report
          where exists (select 1 from audit_insert)
        `;

        return updatedRows;
      });

      return rows[0] ? toAdminReport(rows[0]) : null;
    },
  };
}
