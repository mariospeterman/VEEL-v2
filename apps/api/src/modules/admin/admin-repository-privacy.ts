import type postgres from "postgres";
import { bindCursorScope } from "../../shared/keyset-pagination.js";
import {
  executeWithMutationCommandReceipt,
  resolveMutationActorBySupabaseUserId
} from "../../shared/mutation-command-receipt.js";
import { withPostgresTransaction } from "../../shared/postgres.js";
import { AdminRepositoryStateConflictError } from "./admin-repository-errors.js";
import type { AdminRepository } from "./types.js";
import {
  RefundDisputeRow,
  DataRequestRow,
  decodeTimestampIdCursor,
  encodeTimestampIdCursor,
  pageSize,
  page,
  toRefundDispute,
  toDataRequest
} from "./admin-repository-mappers.js";

export function createPrivacyRepository(
  sql: postgres.Sql
): Pick<AdminRepository, "listRefundDisputes" | "updateRefundDispute" | "listDataRequests" | "updateDataRequest"> {
  return {
    async listRefundDisputes(input) {
      const cursorScope = bindCursorScope("GET /v1/admin/refunds/disputes", {
        sort: "created_at:desc,id:desc"
      });
      const cursor = decodeTimestampIdCursor(cursorScope, input.cursor);
      const rows = await sql<RefundDisputeRow[]>`
        select
          id,
          payment_intent_id,
          entitlement_id,
          reporter_user_id,
          kind,
          requested_action,
          state,
          resolution,
          custody_boundary,
          coalesce(evidence.remediation_evidence_count, 0)::text as remediation_evidence_count,
          evidence.latest_remediation_evidence_at,
          created_at,
          updated_at,
          resolved_at
        from refunds_and_disputes
        left join lateral (
          select
            count(*) as remediation_evidence_count,
            max(rre.created_at) as latest_remediation_evidence_at
          from refund_remediation_evidence rre
          where rre.refund_dispute_id = refunds_and_disputes.id
        ) evidence on true
        where (
          ${cursor.timestamp}::timestamptz is null
          or refunds_and_disputes.created_at < ${cursor.timestamp}::timestamptz
          or (
            refunds_and_disputes.created_at = ${cursor.timestamp}::timestamptz
            and (${cursor.id}::uuid is null or refunds_and_disputes.id < ${cursor.id}::uuid)
          )
        )
        order by refunds_and_disputes.created_at desc, refunds_and_disputes.id desc
        limit ${pageSize + 1}
      `;

      return page(
        rows,
        toRefundDispute,
        (row) => encodeTimestampIdCursor(cursorScope, row.created_at, row.id)
      );
    },
    async updateRefundDispute(input) {
      const evidence = input.body.remediationEvidence;
      return withPostgresTransaction(sql, async (transaction) => {
        const actorUserId = await resolveMutationActorBySupabaseUserId(
          transaction,
          input.supabaseUserId
        );
        if (!actorUserId) return null;

        return executeWithMutationCommandReceipt(transaction, {
          actorUserId,
          action: "admin.refund_dispute.update",
          targetType: "refund_dispute",
          targetId: input.refundDisputeId,
          idempotencyKey: input.idempotencyKey,
          requestVersion: 1,
          requestBody: input.body,
          responseStatus: 200
        }, async () => {
          const updatedRows = await transaction<RefundDisputeRow[]>`
          with
          current_request as (
            select id, payment_intent_id, state, resolution
            from refunds_and_disputes
            where id = ${input.refundDisputeId}
            for update
          ),
          updated_request as (
            update refunds_and_disputes rd
            set
              state = ${input.body.state},
              resolution = ${input.body.resolution},
              updated_at = now(),
              resolved_at = case
                when ${input.body.state} in ('rejected', 'withdrawn', 'resolved', 'closed') then coalesce(rd.resolved_at, now())
                else null
              end
            from current_request cr
            where rd.id = cr.id
            returning
              rd.id,
              rd.payment_intent_id,
              rd.entitlement_id,
              rd.reporter_user_id,
              rd.kind,
              rd.requested_action,
              rd.state,
              rd.resolution,
              rd.custody_boundary,
              rd.created_at,
              rd.updated_at,
              rd.resolved_at,
              cr.state as previous_state,
              cr.resolution as previous_resolution
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
              ${actorUserId}::uuid,
              'refund_dispute',
              updated_request.id,
              'refund_dispute_updated',
              jsonb_build_object(
                'reason', ${input.body.reason}::text,
                'idempotencyKey', ${input.idempotencyKey}::text,
                'paymentIntentId', updated_request.payment_intent_id,
                'entitlementId', updated_request.entitlement_id,
                'previousState', updated_request.previous_state,
                'newState', updated_request.state,
                'previousResolution', updated_request.previous_resolution,
                'newResolution', updated_request.resolution,
                'custodyBoundary', updated_request.custody_boundary
              )
            from updated_request
            returning id
          ),
          evidence_insert as (
            insert into refund_remediation_evidence (
              id,
              refund_dispute_id,
              payment_intent_id,
              recorded_by_user_id,
              evidence_type,
              evidence_source,
              external_reference,
              amount_minor,
              currency,
              refund_value_basis,
              refund_wallet,
              notes,
              idempotency_key
            )
            select
              gen_random_uuid(),
              updated_request.id,
              updated_request.payment_intent_id,
              ${actorUserId}::uuid,
              ${evidence?.evidenceType ?? null}::text,
              ${evidence?.evidenceSource ?? null}::text,
              ${evidence?.externalReference ?? null}::text,
              ${evidence?.amountMinor ?? null}::bigint,
              ${evidence?.currency ?? null}::text,
              ${evidence?.refundValueBasis ?? null}::text,
              ${evidence?.refundWallet ?? null}::text,
              ${evidence?.notes ?? null}::text,
              ${input.idempotencyKey}
            from updated_request
            where ${evidence ? true : false}
            on conflict (refund_dispute_id, idempotency_key) do nothing
            returning id, created_at
          )
          select
            updated_request.id,
            updated_request.payment_intent_id,
            updated_request.entitlement_id,
            updated_request.reporter_user_id,
            updated_request.kind,
            updated_request.requested_action,
            updated_request.state,
            updated_request.resolution,
            updated_request.custody_boundary,
            (coalesce(evidence.remediation_evidence_count, 0) + (select count(*) from evidence_insert))::text
              as remediation_evidence_count,
            coalesce(
              (select max(created_at) from evidence_insert),
              evidence.latest_remediation_evidence_at
            ) as latest_remediation_evidence_at,
            updated_request.created_at,
            updated_request.updated_at,
            updated_request.resolved_at
          from updated_request
          left join lateral (
            select
              count(*) as remediation_evidence_count,
              max(rre.created_at) as latest_remediation_evidence_at
            from refund_remediation_evidence rre
            where rre.refund_dispute_id = updated_request.id
          ) evidence on true
          where exists (select 1 from audit_insert)
        `;

          return updatedRows[0] ? toRefundDispute(updatedRows[0]) : null;
        });
      });
    },
    async listDataRequests(input) {
      const cursorScope = bindCursorScope("GET /v1/admin/data-requests", {
        sort: "created_at:desc,id:desc"
      });
      const cursor = decodeTimestampIdCursor(cursorScope, input.cursor);
      const rows = await sql<DataRequestRow[]>`
        select
          request.id,
          request.requester_user_id,
          request.type,
          request.state,
          request.privacy_boundary,
          export_job.id as content_export_job_id,
          export_job.state as content_export_job_state,
          export_job.cleanup_state as content_export_cleanup_state,
          export_job.archive_upload_started_at as content_export_archive_upload_started_at,
          request.created_at,
          request.updated_at,
          request.completed_at
        from data_requests request
        left join content_export_jobs export_job
          on request.type = 'export'
          and export_job.data_request_id = request.id
        where (
          ${cursor.timestamp}::timestamptz is null
          or request.created_at < ${cursor.timestamp}::timestamptz
          or (
            request.created_at = ${cursor.timestamp}::timestamptz
            and (${cursor.id}::uuid is null or request.id < ${cursor.id}::uuid)
          )
        )
        order by request.created_at desc, request.id desc
        limit ${pageSize + 1}
      `;

      return page(
        rows,
        toDataRequest,
        (row) => encodeTimestampIdCursor(cursorScope, row.created_at, row.id)
      );
    },
    async updateDataRequest(input) {
      return withPostgresTransaction(sql, async (transaction) => {
        const actorUserId = await resolveMutationActorBySupabaseUserId(
          transaction,
          input.supabaseUserId
        );
        if (!actorUserId) return null;

        const requests = await transaction<Array<{ type: "delete" | "export" }>>`
          select type
          from data_requests
          where id = ${input.dataRequestId}
          for update
        `;
        const request = requests[0];
        if (!request) return null;
        if (request.type === "export") {
          throw new AdminRepositoryStateConflictError(
            "Content export lifecycle is managed by the content export job"
          );
        }

        return executeWithMutationCommandReceipt(transaction, {
          actorUserId,
          action: "admin.data_request.update",
          targetType: "data_request",
          targetId: input.dataRequestId,
          idempotencyKey: input.idempotencyKey,
          requestVersion: 1,
          requestBody: input.body,
          responseStatus: 200
        }, async () => {
          const updatedRows = await transaction<DataRequestRow[]>`
          with
          current_request as (
            select id, state
            from data_requests
            where id = ${input.dataRequestId}
            for update
          ),
          updated_request as (
            update data_requests dr
            set
              state = ${input.body.state},
              reason = ${input.body.reason},
              updated_at = now(),
              completed_at = case
                when ${input.body.state} in ('completed', 'rejected') then coalesce(dr.completed_at, now())
                else null
              end
            from current_request cr
            where dr.id = cr.id
            returning
              dr.id,
              dr.requester_user_id,
              dr.type,
              dr.state,
              dr.privacy_boundary,
              dr.created_at,
              dr.updated_at,
              dr.completed_at,
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
              ${actorUserId}::uuid,
              'data_request',
              updated_request.id,
              'data_request_updated',
              jsonb_build_object(
                'reason', ${input.body.reason}::text,
                'idempotencyKey', ${input.idempotencyKey}::text,
                'requesterUserId', updated_request.requester_user_id,
                'previousState', updated_request.previous_state,
                'newState', updated_request.state,
                'privacyBoundary', updated_request.privacy_boundary
              )
            from updated_request
            returning id
          )
          select
            updated_request.id,
            updated_request.requester_user_id,
            updated_request.type,
            updated_request.state,
            updated_request.privacy_boundary,
            export_job.id as content_export_job_id,
            export_job.state as content_export_job_state,
            export_job.cleanup_state as content_export_cleanup_state,
            export_job.archive_upload_started_at as content_export_archive_upload_started_at,
            updated_request.created_at,
            updated_request.updated_at,
            updated_request.completed_at
          from updated_request
          left join content_export_jobs export_job
            on updated_request.type = 'export'
            and export_job.data_request_id = updated_request.id
          where exists (select 1 from audit_insert)
        `;

          return updatedRows[0] ? toDataRequest(updatedRows[0]) : null;
        });
      });
    },
  };
}
