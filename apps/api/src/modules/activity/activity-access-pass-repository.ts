import type postgres from "postgres";
import { type AccessPassRow, toAccessPass } from "./activity-repository-mappers.js";
import type { ListActivityInput } from "./types.js";

export async function listAccessPasses(sql: postgres.Sql, input: ListActivityInput) {
  const rows = await sql<AccessPassRow[]>`
    with target_user as (
      select id
      from users
      where supabase_user_id = ${input.supabaseUserId}
      limit 1
    )
    select
      te.id,
      te.event_id,
      te.access_pass_type_id,
      te.holder_user_id,
      te.payment_intent_id,
      te.qr_token,
      te.state,
      te.checked_in_at,
      te.created_at
    from event_access_passes te
    join target_user tu on tu.id = te.holder_user_id
    where (${input.cursor ?? null}::timestamptz is null or te.created_at < ${input.cursor ?? null}::timestamptz)
    order by te.created_at desc
    limit ${input.limit + 1}
  `;
  const pageRows = rows.slice(0, input.limit);
  const extraRow = rows[input.limit];

  return {
    items: pageRows.map(toAccessPass),
    nextCursor: extraRow ? extraRow.created_at.toISOString() : null
  };
}
