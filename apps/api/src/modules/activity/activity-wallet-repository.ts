import type postgres from "postgres";
import {
  type WalletTransactionRow,
  toWalletTransaction
} from "./activity-repository-mappers.js";
import type { ListActivityInput } from "./types.js";

export async function listWalletTransactions(sql: postgres.Sql, input: ListActivityInput) {
  const rows = await sql<WalletTransactionRow[]>`
    with target_user as (
      select id
      from users
      where supabase_user_id = ${input.supabaseUserId}
      limit 1
    )
    select
      wtr.id,
      wtr.chain,
      wtr.direction,
      wtr.amount_minor,
      wtr.currency,
      wtr.state,
      wtr.source,
      wtr.payment_intent_id,
      wtr.wallet_id,
      wtr.signature,
      wtr.reference_address,
      wtr.created_at,
      wtr.submitted_at,
      wtr.confirmed_at
    from wallet_transaction_records wtr
    join target_user tu on tu.id = wtr.user_id
    where (${input.cursor ?? null}::timestamptz is null or wtr.created_at < ${input.cursor ?? null}::timestamptz)
    order by wtr.created_at desc
    limit ${input.limit + 1}
  `;

  const pageRows = rows.slice(0, input.limit);
  const extraRow = rows[input.limit];

  return {
    items: pageRows.map(toWalletTransaction),
    nextCursor: extraRow ? extraRow.created_at.toISOString() : null
  };
}
