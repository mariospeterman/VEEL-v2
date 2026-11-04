import type postgres from "postgres";
import {
  executeWithMutationCommandReceipt,
  resolveMutationActorBySupabaseUserId
} from "../../shared/mutation-command-receipt.js";
import { withPostgresTransaction } from "../../shared/postgres.js";
import type { AdminRepository } from "./types.js";
import {
  decodeTimestampKeyCursor,
  encodeTimestampKeyCursor,
  FeatureFlagRow,
  page,
  pageSize,
  toFeatureFlag
} from "./admin-repository-mappers.js";

export function createFeatureFlagRepository(
  sql: postgres.Sql
): Pick<AdminRepository, "getFeatureFlag" | "listFeatureFlags" | "updateFeatureFlag"> {
  return {
    async getFeatureFlag(featureFlagKey) {
      const rows = await sql<FeatureFlagRow[]>`
        select key, value, category, policy_boundary, state, updated_at
        from feature_flags
        where key = ${featureFlagKey}
        limit 1
      `;

      return rows[0] ? toFeatureFlag(rows[0]) : null;
    },
    async listFeatureFlags(input) {
      const cursorScope = "GET /v1/admin/feature-flags";
      const cursor = decodeTimestampKeyCursor(cursorScope, input.cursor);
      const rows = await sql<FeatureFlagRow[]>`
        select key, value, category, policy_boundary, state, updated_at
        from feature_flags
        where (
          ${cursor.timestamp}::timestamptz is null
          or updated_at < ${cursor.timestamp}::timestamptz
          or (
            updated_at = ${cursor.timestamp}::timestamptz
            and (${cursor.key}::text is null or key > ${cursor.key}::text)
          )
        )
        order by updated_at desc, key asc
        limit ${pageSize + 1}
      `;

      return page(rows, toFeatureFlag, (row) =>
        encodeTimestampKeyCursor(cursorScope, row.updated_at, row.key)
      );
    },
    async updateFeatureFlag(input) {
      return withPostgresTransaction(sql, async (transaction) => {
        const actorUserId = await resolveMutationActorBySupabaseUserId(
          transaction,
          input.supabaseUserId
        );
        if (!actorUserId) return null;

        return executeWithMutationCommandReceipt(transaction, {
          actorUserId,
          action: "admin.feature_flag.update",
          targetType: "feature_flag",
          targetId: input.featureFlagKey,
          idempotencyKey: input.idempotencyKey,
          requestVersion: 1,
          requestBody: input.body,
          responseStatus: 200
        }, async () => {
          const updatedRows = await transaction<FeatureFlagRow[]>`
          with
          current_flag as (
            select key, value, state, policy_boundary
            from feature_flags
            where key = ${input.featureFlagKey}
            for update
          ),
          updated_flag as (
            update feature_flags ff
            set
              value = ${transaction.json(input.body.value as postgres.JSONValue)}::jsonb,
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
              ${actorUserId}::uuid,
              'feature_flag',
              null,
              'feature_flag_updated',
              jsonb_build_object(
                'featureFlagKey', updated_flag.key,
                'reason', ${input.body.reason}::text,
                'idempotencyKey', ${input.idempotencyKey}::text,
                'previousValue', updated_flag.previous_value,
                'newValue', updated_flag.value,
                'previousState', updated_flag.previous_state,
                'newState', updated_flag.state,
                'policyBoundary', updated_flag.policy_boundary
              )
            from updated_flag
            returning id
          )
          select key, value, category, policy_boundary, state, updated_at
          from updated_flag
          where exists (select 1 from audit_insert)
        `;

          return updatedRows[0] ? toFeatureFlag(updatedRows[0]) : null;
        });
      });
    },
  };
}
