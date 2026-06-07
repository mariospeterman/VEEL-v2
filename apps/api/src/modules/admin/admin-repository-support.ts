import type postgres from "postgres";
import type { AdminRepository } from "./types.js";
import {
  SupportCaseRow,
  SupportPolicyRow,
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
        where (${input.cursor ?? null}::timestamptz is null or created_at < ${input.cursor ?? null}::timestamptz)
        order by created_at desc
        limit ${pageSize + 1}
      `;

      return page(rows, toSupportCase);
    },
    async updateSupportCase(input) {
      const rows = await sql.begin(async (transaction) => {
        const updatedRows = await transaction<SupportCaseRow[]>`
          with actor as (
            select id
            from users
            where supabase_user_id = ${input.supabaseUserId}
            limit 1
          ),
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
              actor.id,
              'support_case',
              updated_case.id,
              'support_case_updated',
              jsonb_build_object(
                'reason', ${input.body.reason},
                'idempotencyKey', ${input.idempotencyKey},
                'previousState', updated_case.previous_state,
                'newState', updated_case.state,
                'organizationId', updated_case.organization_id
              )
            from updated_case
            cross join actor
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

        return updatedRows;
      });

      return rows[0] ? toSupportCase(rows[0]) : null;
    },
    async listSupportPolicies(input) {
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
        where (${input.cursor ?? null}::timestamptz is null or updated_at < ${input.cursor ?? null}::timestamptz)
        order by updated_at desc
        limit ${pageSize + 1}
      `;

      return page(rows, toSupportPolicy);
    },
    async updateSupportPolicy(input) {
      const rows = await sql.begin(async (transaction) => {
        const updatedRows = await transaction<SupportPolicyRow[]>`
          with actor as (
            select id
            from users
            where supabase_user_id = ${input.supabaseUserId}
            limit 1
          ),
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
              actor.id,
              'organization_support_policy',
              updated_policy.id,
              'organization_support_policy_updated',
              jsonb_build_object(
                'reason', ${input.body.reason},
                'idempotencyKey', ${input.idempotencyKey},
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
            cross join actor
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

        return updatedRows;
      });

      return rows[0] ? toSupportPolicy(rows[0]) : null;
    },
  };
}
