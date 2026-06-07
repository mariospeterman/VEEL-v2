import type postgres from "postgres";
import type { AdminRepository } from "./types.js";
import {
  RefundDisputeRow,
  DataRequestRow,
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
          created_at,
          updated_at,
          resolved_at
        from refunds_and_disputes
        where (${input.cursor ?? null}::timestamptz is null or created_at < ${input.cursor ?? null}::timestamptz)
        order by created_at desc
        limit ${pageSize + 1}
      `;

      return page(rows, toRefundDispute);
    },
    async updateRefundDispute(input) {
      const rows = await sql.begin(async (transaction) => {
        const updatedRows = await transaction<RefundDisputeRow[]>`
          with actor as (
            select id
            from users
            where supabase_user_id = ${input.supabaseUserId}
            limit 1
          ),
          current_request as (
            select id, state, resolution
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
              actor.id,
              'refund_dispute',
              updated_request.id,
              'refund_dispute_updated',
              jsonb_build_object(
                'reason', ${input.body.reason},
                'idempotencyKey', ${input.idempotencyKey},
                'paymentIntentId', updated_request.payment_intent_id,
                'entitlementId', updated_request.entitlement_id,
                'previousState', updated_request.previous_state,
                'newState', updated_request.state,
                'previousResolution', updated_request.previous_resolution,
                'newResolution', updated_request.resolution,
                'custodyBoundary', updated_request.custody_boundary
              )
            from updated_request
            cross join actor
            returning id
          )
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
            created_at,
            updated_at,
            resolved_at
          from updated_request
          where exists (select 1 from audit_insert)
        `;

        return updatedRows;
      });

      return rows[0] ? toRefundDispute(rows[0]) : null;
    },
    async listDataRequests(input) {
      const rows = await sql<DataRequestRow[]>`
        select
          id,
          requester_user_id,
          type,
          state,
          privacy_boundary,
          created_at,
          updated_at,
          completed_at
        from data_requests
        where (${input.cursor ?? null}::timestamptz is null or created_at < ${input.cursor ?? null}::timestamptz)
        order by created_at desc
        limit ${pageSize + 1}
      `;

      return page(rows, toDataRequest);
    },
    async updateDataRequest(input) {
      const rows = await sql.begin(async (transaction) => {
        const updatedRows = await transaction<DataRequestRow[]>`
          with actor as (
            select id
            from users
            where supabase_user_id = ${input.supabaseUserId}
            limit 1
          ),
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
              actor.id,
              'data_request',
              updated_request.id,
              'data_request_updated',
              jsonb_build_object(
                'reason', ${input.body.reason},
                'idempotencyKey', ${input.idempotencyKey},
                'requesterUserId', updated_request.requester_user_id,
                'previousState', updated_request.previous_state,
                'newState', updated_request.state,
                'privacyBoundary', updated_request.privacy_boundary
              )
            from updated_request
            cross join actor
            returning id
          )
          select
            id,
            requester_user_id,
            type,
            state,
            privacy_boundary,
            created_at,
            updated_at,
            completed_at
          from updated_request
          where exists (select 1 from audit_insert)
        `;

        return updatedRows;
      });

      return rows[0] ? toDataRequest(rows[0]) : null;
    },
  };
}
