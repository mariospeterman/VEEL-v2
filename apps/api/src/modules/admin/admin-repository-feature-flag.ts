import type postgres from "postgres";
import type { AdminRepository } from "./types.js";
import {
  FeatureFlagRow,
  pageSize,
  toFeatureFlag
} from "./admin-repository-mappers.js";

export function createFeatureFlagRepository(
  sql: postgres.Sql
): Pick<AdminRepository, "listFeatureFlags" | "updateFeatureFlag"> {
  return {
    async listFeatureFlags() {
      const rows = await sql<FeatureFlagRow[]>`
        select key, value, category, policy_boundary, state, updated_at
        from feature_flags
        order by updated_at desc, key asc
        limit ${pageSize}
      `;

      return {
        items: rows.map(toFeatureFlag),
        nextCursor: null
      };
    },
    async updateFeatureFlag(input) {
      const rows = await sql.begin(async (transaction) => {
        const updatedRows = await transaction<FeatureFlagRow[]>`
          with actor as (
            select id
            from users
            where supabase_user_id = ${input.supabaseUserId}
            limit 1
          ),
          current_flag as (
            select key, value, state, policy_boundary
            from feature_flags
            where key = ${input.featureFlagKey}
            for update
          ),
          updated_flag as (
            update feature_flags ff
            set
              value = ${JSON.stringify(input.body.value)}::jsonb,
              state = ${input.body.state},
              updated_at = now()
            from current_flag cf
            where ff.key = cf.key
            returning
              ff.key,
              ff.value,
              ff.category,
              ff.policy_boundary,
              ff.state,
              ff.updated_at,
              cf.value as previous_value,
              cf.state as previous_state
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
              'feature_flag',
              null,
              'feature_flag_updated',
              jsonb_build_object(
                'featureFlagKey', updated_flag.key,
                'reason', ${input.body.reason},
                'idempotencyKey', ${input.idempotencyKey},
                'previousValue', updated_flag.previous_value,
                'newValue', updated_flag.value,
                'previousState', updated_flag.previous_state,
                'newState', updated_flag.state,
                'policyBoundary', updated_flag.policy_boundary
              )
            from updated_flag
            cross join actor
            returning id
          )
          select key, value, category, policy_boundary, state, updated_at
          from updated_flag
          where exists (select 1 from audit_insert)
        `;

        return updatedRows;
      });

      return rows[0] ? toFeatureFlag(rows[0]) : null;
    },
  };
}
