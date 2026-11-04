import type postgres from "postgres";
import {
  executeWithMutationCommandReceipt,
  resolveMutationActorBySupabaseUserId
} from "../../shared/mutation-command-receipt.js";
import { withPostgresTransaction } from "../../shared/postgres.js";
import type { AdminRepository } from "./types.js";
import {
  SupportCaseRow,
  SupportPolicyRow,
  decodeTimestampIdCursor,
  encodeTimestampIdCursor,
  pageSize,
  page,
  toSupportCase,
  toSupportPolicy
} from "./admin-repository-mappers.js";

export function createSupportRepository(
  sql: postgres.Sql
): Pick<AdminRepository, "listSupportCases" | "updateSupportCase" | "listSupportPolicies" | "updateSupportPolicy"> {
  return {
    async listSupportCases(input) {
      const cursorScope = "GET /v1/admin/support/cases";
      const cursor = decodeTimestampIdCursor(cursorScope, input.cursor);
      const rows = await sql<SupportCaseRow[]>`
        select
          id,
          organization_id,
          requester_user_id,
          assigned_staff_user_id,
          subject_type,
          subject_id,
          category,
          state,
          priority,
          created_at,
          updated_at,
          closed_at
        from support_cases
        where (
          ${cursor.timestamp}::timestamptz is null
          or created_at < ${cursor.timestamp}::timestamptz
          or (
            created_at = ${cursor.timestamp}::timestamptz
            and (${cursor.id}::uuid is null or id < ${cursor.id}::uuid)
          )
        )
        order by created_at desc, id desc
        limit ${pageSize + 1}
      `;

      return page(
        rows,
        toSupportCase,
        (row) => encodeTimestampIdCursor(cursorScope, row.created_at, row.id)
      );
    },
    async updateSupportCase(input) {
      return withPostgresTransaction(sql, async (transaction) => {
        const actorUserId = await resolveMutationActorBySupabaseUserId(
          transaction,
          input.supabaseUserId
        );
        if (!actorUserId) return null;

        return executeWithMutationCommandReceipt(transaction, {
          actorUserId,
          action: "admin.support_case.update",
          targetType: "support_case",
          targetId: input.supportCaseId,
          idempotencyKey: input.idempotencyKey,
          requestVersion: 1,
          requestBody: input.body,
          responseStatus: 200
        }, async () => {
          const updatedRows = await transaction<SupportCaseRow[]>`
          with
          current_case as (
            select id, state
            from support_cases
            where id = ${input.supportCaseId}
            for update
          ),
          updated_case as (
            update support_cases sc
            set
              state = ${input.body.state},
              updated_at = now(),
              closed_at = case
                when ${input.body.state} in ('resolved', 'closed') then coalesce(sc.closed_at, now())
                else null
              end
            from current_case cc
            where sc.id = cc.id
            returning
              sc.id,
              sc.organization_id,
              sc.requester_user_id,
              sc.assigned_staff_user_id,
              sc.subject_type,
              sc.subject_id,
              sc.category,
              sc.state,
              sc.priority,
              sc.created_at,
              sc.updated_at,
              sc.closed_at,
              cc.state as previous_state
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
              'support_case',
              updated_case.id,
              'support_case_updated',
              jsonb_build_object(
                'reason', ${input.body.reason}::text,
                'idempotencyKey', ${input.idempotencyKey}::text,
                'previousState', updated_case.previous_state,
                'newState', updated_case.state,
                'organizationId', updated_case.organization_id
              )
            from updated_case
            returning id
          )
          select
            id,
            organization_id,
            requester_user_id,
            assigned_staff_user_id,
            subject_type,
            subject_id,
            category,
            state,
            priority,
            created_at,
            updated_at,
            closed_at
          from updated_case
          where exists (select 1 from audit_insert)
        `;

          return updatedRows[0] ? toSupportCase(updatedRows[0]) : null;
        });
      });
    },
    async listSupportPolicies(input) {
      const cursorScope = "GET /v1/admin/support/policies";
      const cursor = decodeTimestampIdCursor(cursorScope, input.cursor);
      const rows = await sql<SupportPolicyRow[]>`
        select
          id,
          organization_id,
          support_state,
          sla_tier,
          state,
          policy_reason,
          money_boundary,
          created_at,
          updated_at
        from organization_support_policies
        where (
          ${cursor.timestamp}::timestamptz is null
          or updated_at < ${cursor.timestamp}::timestamptz
          or (
            updated_at = ${cursor.timestamp}::timestamptz
            and (${cursor.id}::uuid is null or id < ${cursor.id}::uuid)
          )
        )
        order by updated_at desc, id desc
        limit ${pageSize + 1}
      `;

      return page(
        rows,
        toSupportPolicy,
        (row) => encodeTimestampIdCursor(cursorScope, row.updated_at, row.id)
      );
    },
    async updateSupportPolicy(input) {
      return withPostgresTransaction(sql, async (transaction) => {
        const actorUserId = await resolveMutationActorBySupabaseUserId(
          transaction,
          input.supabaseUserId
        );
        if (!actorUserId) return null;

        return executeWithMutationCommandReceipt(transaction, {
          actorUserId,
          action: "admin.support_policy.update",
          targetType: "support_policy",
          targetId: input.supportPolicyId,
          idempotencyKey: input.idempotencyKey,
          requestVersion: 1,
          requestBody: input.body,
          responseStatus: 200
        }, async () => {
          const updatedRows = await transaction<SupportPolicyRow[]>`
          with
          current_policy as (
            select id, support_state, sla_tier, state
            from organization_support_policies
            where id = ${input.supportPolicyId}
            for update
          ),
          updated_policy as (
            update organization_support_policies osp
            set
              support_state = ${input.body.supportState},
              sla_tier = ${input.body.slaTier},
              state = ${input.body.state},
              policy_reason = ${input.body.reason},
              updated_at = now()
            from current_policy cp
            where osp.id = cp.id
            returning
              osp.id,
              osp.organization_id,
              osp.support_state,
              osp.sla_tier,
              osp.state,
              osp.policy_reason,
              osp.money_boundary,
              osp.created_at,
              osp.updated_at,
              cp.support_state as previous_support_state,
              cp.sla_tier as previous_sla_tier,
              cp.state as previous_state
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
              'organization_support_policy',
              updated_policy.id,
              'organization_support_policy_updated',
              jsonb_build_object(
                'reason', ${input.body.reason}::text,
                'idempotencyKey', ${input.idempotencyKey}::text,
                'organizationId', updated_policy.organization_id,
                'previousSupportState', updated_policy.previous_support_state,
                'newSupportState', updated_policy.support_state,
                'previousSlaTier', updated_policy.previous_sla_tier,
                'newSlaTier', updated_policy.sla_tier,
                'previousState', updated_policy.previous_state,
                'newState', updated_policy.state,
                'moneyBoundary', updated_policy.money_boundary
              )
            from updated_policy
            returning id
          )
          select
            id,
            organization_id,
            support_state,
            sla_tier,
            state,
            policy_reason,
            money_boundary,
            created_at,
            updated_at
          from updated_policy
          where exists (select 1 from audit_insert)
        `;

          return updatedRows[0] ? toSupportPolicy(updatedRows[0]) : null;
        });
      });
    },
  };
}
