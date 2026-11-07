import type postgres from "postgres";
import {
  bindCursorScope,
  decodeTimestampIdCursor,
  encodeTimestampIdCursor,
  keysetPage
} from "../../shared/keyset-pagination.js";
import { type AccessPassRow, toAccessPass } from "./activity-repository-mappers.js";
import type { ListActivityInput } from "./types.js";

const accessPassCursorScope = "GET /v1/activity/access-passes";

export async function listAccessPasses(sql: postgres.Sql, input: ListActivityInput) {
  const cursorScope = bindCursorScope(accessPassCursorScope, {
    actor: input.supabaseUserId,
    sort: "created_at:desc,id:desc"
  });
  const cursor = decodeTimestampIdCursor(cursorScope, input.cursor);
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
    where (
      ${cursor.timestamp}::timestamptz is null
      or (
        ${cursor.id}::uuid is null
        and te.created_at <= ${cursor.timestamp}::timestamptz
      )
      or (
        ${cursor.id}::uuid is not null
        and (te.created_at, te.id) < (${cursor.timestamp}::timestamptz, ${cursor.id}::uuid)
      )
    )
    order by te.created_at desc, te.id desc
    limit ${input.limit + 1}
  `;

  return keysetPage(rows, input.limit, toAccessPass, (row) =>
    encodeTimestampIdCursor(cursorScope, row.created_at, row.id)
  );
}
