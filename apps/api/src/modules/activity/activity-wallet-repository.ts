import type postgres from "postgres";
import {
  decodeTimestampIdCursor,
  encodeTimestampIdCursor,
  keysetPage
} from "../../shared/keyset-pagination.js";
import {
  type WalletTransactionRow,
  toWalletTransaction
} from "./activity-repository-mappers.js";
import type { ListActivityInput } from "./types.js";

const walletTransactionCursorScope = "GET /v1/activity/wallet-transactions";

export async function listWalletTransactions(sql: postgres.Sql, input: ListActivityInput) {
  const cursor = decodeTimestampIdCursor(walletTransactionCursorScope, input.cursor);
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
    where (
      ${cursor.timestamp}::timestamptz is null
      or (
        ${cursor.id}::uuid is null
        and wtr.created_at <= ${cursor.timestamp}::timestamptz
      )
      or (
        ${cursor.id}::uuid is not null
        and (wtr.created_at, wtr.id) < (${cursor.timestamp}::timestamptz, ${cursor.id}::uuid)
      )
    )
    order by wtr.created_at desc, wtr.id desc
    limit ${input.limit + 1}
  `;

  return keysetPage(rows, input.limit, toWalletTransaction, (row) =>
    encodeTimestampIdCursor(walletTransactionCursorScope, row.created_at, row.id)
  );
}
