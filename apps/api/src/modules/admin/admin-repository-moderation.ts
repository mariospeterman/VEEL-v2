import { createHash, randomUUID } from "node:crypto";
import { type PostgresSql, withPostgresTransaction } from "../../shared/postgres.js";
import type { AdminRepository } from "./types.js";
import { AdminRepositoryStateConflictError } from "./admin-repository-errors.js";
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
  sql: PostgresSql
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
          coalesce(msc.state, ci.moderation_state) as moderation_state,
          ci.state,
          ci.created_at
        from content_items ci
        left join media_safety_cases msc
          on msc.content_item_id = ci.id
          and msc.state <> 'superseded'
        join users u on u.id = ci.creator_user_id
        join profiles p on p.user_id = u.id
        where (${input.cursor ?? null}::timestamptz is null or ci.created_at < ${input.cursor ?? null}::timestamptz)
        order by
          case when coalesce(msc.state, ci.moderation_state) in (
            'quarantined', 'preprocessing', 'hash_checking', 'classification',
            'review_required', 'changes_requested', 'held_for_reporting', 'appealed', 'pending', 'reported', 'restricted'
          ) then 0 else 1 end,
          ci.created_at desc
        limit ${pageSize + 1}
      `;

      return page(rows, toAdminContentItem);
    },
    async updateContentModeration(input) {
      const moderation = contentModerationForAction(input.body.action);
      const rows = await withPostgresTransaction(sql, async (transaction) => {
        const actorRows = await transaction<{ id: string }[]>`
          select id
          from users
          where supabase_user_id = ${input.supabaseUserId}
          limit 1
        `;
        const actor = actorRows[0];
        if (!actor) return [] as AdminContentRow[];

        const currentContentRows = await transaction<
          { id: string; state: string; moderation_state: string; publish_state: string }[]
        >`
          select id, state, moderation_state, publish_state
          from content_items
          where id = ${input.contentId}
          for update
        `;
        const currentContent = currentContentRows[0];
        if (!currentContent) return [] as AdminContentRow[];

        const safetyCaseRows = await transaction<{ id: string; state: string }[]>`
          select id, state
          from media_safety_cases
          where content_item_id = ${input.contentId}
            and state <> 'superseded'
          for update
        `;
        const safetyCase = safetyCaseRows[0];
        if (!safetyCase) {
          throw new AdminRepositoryStateConflictError("Media safety case is missing");
        }
        assertModerationTransition(
          input.body.action,
          safetyCase.state,
          currentContent.state
        );

        const approving = input.body.action === "approve" || input.body.action === "reinstate";
        const requestingChanges = input.body.action === "request_changes";
        const decidingAppeal = safetyCase.state === "appealed";

        if (approving) {
          const evidenceRows = await transaction<{ media_asset_id: string | null }[]>`
            select private.content_safety_automated_candidate_asset(${input.contentId}) as media_asset_id
          `;
          const releaseMediaAssetId = evidenceRows[0]?.media_asset_id;
          if (!releaseMediaAssetId) {
            throw new AdminRepositoryStateConflictError(
              "Required automated safety checks are incomplete"
            );
          }

          const reviewEventId = `staff-review:${input.contentId}:${randomUUID()}`;
          await transaction`
            insert into provider_media_scan_events (
              media_safety_case_id,
              media_asset_id,
              provider,
              provider_event_id,
              scan_type,
              normalized_signal,
              payload_hash,
              model_or_ruleset_version,
              observed_at
            )
            values (
              ${safetyCase.id},
              ${releaseMediaAssetId},
              'internal',
              ${reviewEventId},
              'manual_review',
              'clear',
              ${moderationReviewHash({
                action: input.body.action,
                actorUserId: actor.id,
                contentId: input.contentId,
                reason: input.body.reason
              })},
              'media-safety-v2',
              now()
            )
          `;

          await transaction`
            update content_items
            set release_media_asset_id = ${releaseMediaAssetId}, updated_at = now()
            where id = ${input.contentId}
          `;
        }

        await transaction`
          update media_safety_cases
          set
            state = ${approving ? "approved" : requestingChanges ? "changes_requested" : input.body.action === "restrict" ? "review_required" : "rejected"},
            decision_source = 'staff',
            reason_code = ${approving ? "staff_approved" : requestingChanges ? "changes_requested" : input.body.action === "restrict" ? "staff_review_required" : "policy_rejected"},
            decision_message = ${input.body.reason.trim()},
            provider_release_allowed = ${approving},
            reviewed_by_user_id = ${actor.id},
            decided_at = now(),
            updated_at = now()
          where id = ${safetyCase.id}
        `;

        if (decidingAppeal) {
          await transaction`
            update media_moderation_appeals
            set
              state = ${approving ? "overturned" : "upheld"},
              resolution_reason = ${`staff_${input.body.action}`},
              reviewed_by_user_id = ${actor.id},
              reviewed_at = now(),
              updated_at = now()
            where media_safety_case_id = ${safetyCase.id}
              and state in ('submitted', 'reviewing')
          `;
        }

        let updatedRows: AdminContentRow[];
        try {
          updatedRows = await transaction<AdminContentRow[]>`
            update content_items ci
            set
              moderation_state = ${moderation.moderationState},
              state = ${moderation.state}::content_state,
              publish_state = case
                when ${approving}
                  and ci.publish_state = 'submitted_for_review'
                  and ${moderation.state} = 'ready'
                  and ci.scheduled_for > now()
                then 'scheduled'
                when ${approving}
                  and ci.publish_state = 'submitted_for_review'
                  and ${moderation.state} = 'ready'
                then 'published'
                when ${input.body.action} = 'approve'
                  and ci.publish_state = 'blocked'
                  and (${decidingAppeal} or ci.published_at is not null)
                  and ${moderation.state} = 'ready'
                then 'published'
                when ${input.body.action} in ('block', 'delete') then 'blocked'
                when ${requestingChanges} then 'submitted_for_review'
                when ${input.body.action} = 'reinstate' and ci.publish_state = 'blocked' then 'unpublished'
                else ci.publish_state
              end,
              published_at = case
                when ${approving}
                  and (
                    ci.publish_state = 'submitted_for_review'
                    or (
                      ${input.body.action} = 'approve'
                      and ci.publish_state = 'blocked'
                      and (${decidingAppeal} or ci.published_at is not null)
                    )
                  )
                  and ${moderation.state} = 'ready'
                  and (ci.scheduled_for is null or ci.scheduled_for <= now())
                then coalesce(ci.published_at, now())
                else ci.published_at
              end,
              expires_at = case
                when ${approving}
                  and ci.distribution_mode = 'moment'
                  and ci.publish_state = 'submitted_for_review'
                  and ${moderation.state} = 'ready'
                  and (ci.scheduled_for is null or ci.scheduled_for <= now())
                then coalesce(ci.expires_at, now() + interval '24 hours')
                else ci.expires_at
              end,
              updated_at = now()
            where ci.id = ${input.contentId}
            returning
              ci.id,
              ci.creator_user_id as creator_id,
              ''::text as handle,
              ''::text as display_name,
              null::text as avatar_url,
              ci.moderation_state,
              ci.state,
              ci.created_at
          `;
        } catch (error) {
          if (error instanceof Error && error.message.includes("content_safety_release_not_ready")) {
            throw new AdminRepositoryStateConflictError(
              "Performer verification, consent, or provider review is incomplete"
            );
          }
          throw error;
        }

        const updated = updatedRows[0];
        if (!updated) return [] as AdminContentRow[];

        await transaction`
          insert into audit_events (
            id,
            actor_user_id,
            subject_type,
            subject_id,
            action,
            metadata
          )
          values (
            gen_random_uuid(),
            ${actor.id},
            'content',
            ${input.contentId},
            'content_moderation_updated',
            ${transaction.json({
              reason: input.body.reason,
              idempotencyKey: input.idempotencyKey,
              adminAction: input.body.action,
              previousState: currentContent.state,
              newState: updated.state,
              previousPublishState: currentContent.publish_state,
              previousModerationState: safetyCase.state,
              newModerationState: updated.moderation_state,
              safetyCaseId: safetyCase.id
            })}::jsonb
          )
        `;

        return await transaction<AdminContentRow[]>`
          select
            ci.id,
            u.id as creator_id,
            p.handle,
            p.display_name,
            p.avatar_url,
            msc.state as moderation_state,
            ci.state,
            ci.created_at
          from content_items ci
          join media_safety_cases msc
            on msc.content_item_id = ci.id
            and msc.state <> 'superseded'
          join users u on u.id = ci.creator_user_id
          join profiles p on p.user_id = u.id
          where ci.id = ${input.contentId}
        `;
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
      const rows = await withPostgresTransaction(sql, async (transaction) => {
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

function moderationReviewHash(input: {
  action: string;
  actorUserId: string;
  contentId: string;
  reason: string;
}): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function assertModerationTransition(
  action: string,
  safetyState: string,
  contentState: string
): void {
  const allowedSafetyStates: Record<string, readonly string[]> = {
    approve: ["review_required", "appealed", "changes_requested"],
    request_changes: ["review_required", "appealed"],
    reinstate: ["rejected"]
  };
  const allowed = allowedSafetyStates[action];

  if (action === "reinstate" && contentState === "deleted") {
    throw new AdminRepositoryStateConflictError("Deleted content cannot be reinstated");
  }
  if (allowed && !allowed.includes(safetyState)) {
    throw new AdminRepositoryStateConflictError(
      `Moderation action ${action} is invalid while the safety case is ${safetyState}`
    );
  }
}
