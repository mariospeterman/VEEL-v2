import postgres from "postgres";
import type {
  ActivityItem,
  ActivityRepository,
  TicketPage,
  WalletTransaction
} from "./types.js";

export class ActivityRepositoryConfigurationError extends Error {
  constructor() {
    super("DATABASE_URL_NOT_CONFIGURED");
    this.name = "ActivityRepositoryConfigurationError";
  }
}

interface ActivityRow {
  id: string;
  kind: ActivityItem["kind"];
  title: string;
  state: string;
  product_type: ActivityItem["productType"] | null;
  target_id: string | null;
  amount_minor: number | null;
  currency: ActivityItem["currency"] | null;
  payment_intent_id: string | null;
  signature: string | null;
  reference_address: string | null;
  created_at: Date;
  confirmed_at: Date | null;
}

interface WalletTransactionRow {
  id: string;
  chain: WalletTransaction["chain"];
  direction: WalletTransaction["direction"];
  amount_minor: number;
  currency: WalletTransaction["currency"];
  state: WalletTransaction["state"];
  source: WalletTransaction["source"];
  payment_intent_id: string | null;
  wallet_id: string | null;
  signature: string | null;
  reference_address: string | null;
  created_at: Date;
  submitted_at: Date | null;
  confirmed_at: Date | null;
}

interface TicketRow {
  id: string;
  event_id: string;
  ticket_type_id: string;
  holder_user_id: string;
  payment_intent_id: string | null;
  qr_token: string;
  state: TicketPage["items"][number]["state"];
  checked_in_at: Date | null;
  created_at: Date;
}

export function createPostgresActivityRepository(databaseUrl?: string): ActivityRepository {
  if (!databaseUrl) {
    return {
      async listActivity() {
        throw new ActivityRepositoryConfigurationError();
      },
      async listPaymentActivity() {
        throw new ActivityRepositoryConfigurationError();
      },
      async listWalletTransactions() {
        throw new ActivityRepositoryConfigurationError();
      },
      async listTickets() {
        throw new ActivityRepositoryConfigurationError();
      }
    };
  }

  const sql = postgres(databaseUrl, {
    max: 5,
    idle_timeout: 20,
    prepare: false
  });

  return {
    async listActivity(input) {
      const rows = await sql<ActivityRow[]>`
        with target_user as (
          select id
          from users
          where supabase_user_id = ${input.supabaseUserId}
          limit 1
        ),
        payment_activity as (
          select
            pi.id,
            'payment_intent' as kind,
            initcap(replace(pi.product_type, '_', ' ')) as title,
            pi.state,
            pi.product_type,
            pi.target_id,
            pi.amount_minor,
            pi.currency,
            pi.id as payment_intent_id,
            pi.coalesce_signature as signature,
            pi.reference_address,
            pi.created_at,
            pi.confirmed_at
          from (
            select
              *,
              coalesce(confirmed_signature, submitted_signature) as coalesce_signature
            from payment_intents
          ) pi
          join target_user tu on tu.id = pi.user_id
        ),
        wallet_activity as (
          select
            wtr.id,
            'wallet_transaction' as kind,
            'Wallet transaction' as title,
            wtr.state,
            pi.product_type,
            pi.target_id,
            wtr.amount_minor,
            wtr.currency,
            wtr.payment_intent_id,
            wtr.signature,
            wtr.reference_address,
            wtr.created_at,
            wtr.confirmed_at
          from wallet_transaction_records wtr
          join target_user tu on tu.id = wtr.user_id
          left join payment_intents pi on pi.id = wtr.payment_intent_id
        )
        select *
        from (
          select * from payment_activity
          union all
          select * from wallet_activity
        ) activity
        where (${input.cursor ?? null}::timestamptz is null or created_at < ${input.cursor ?? null}::timestamptz)
        order by created_at desc
        limit ${input.limit + 1}
      `;

      return toActivityPage(rows, input.limit);
    },
    async listPaymentActivity(input) {
      const rows = await sql<ActivityRow[]>`
        with target_user as (
          select id
          from users
          where supabase_user_id = ${input.supabaseUserId}
          limit 1
        )
        select
          pi.id,
          'payment_intent' as kind,
          initcap(replace(pi.product_type, '_', ' ')) as title,
          pi.state,
          pi.product_type,
          pi.target_id,
          pi.amount_minor,
          pi.currency,
          pi.id as payment_intent_id,
          coalesce(pi.confirmed_signature, pi.submitted_signature) as signature,
          pi.reference_address,
          pi.created_at,
          pi.confirmed_at
        from payment_intents pi
        join target_user tu on tu.id = pi.user_id
        where (${input.cursor ?? null}::timestamptz is null or pi.created_at < ${input.cursor ?? null}::timestamptz)
        order by pi.created_at desc
        limit ${input.limit + 1}
      `;

      return toActivityPage(rows, input.limit);
    },
    async listWalletTransactions(input) {
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
    },
    async listTickets(input) {
      const rows = await sql<TicketRow[]>`
        with target_user as (
          select id
          from users
          where supabase_user_id = ${input.supabaseUserId}
          limit 1
        )
        select
          te.id,
          te.event_id,
          te.ticket_type_id,
          te.holder_user_id,
          te.payment_intent_id,
          te.qr_token,
          te.state,
          te.checked_in_at,
          te.created_at
        from ticket_entitlements te
        join target_user tu on tu.id = te.holder_user_id
        where (${input.cursor ?? null}::timestamptz is null or te.created_at < ${input.cursor ?? null}::timestamptz)
        order by te.created_at desc
        limit ${input.limit + 1}
      `;
      const pageRows = rows.slice(0, input.limit);
      const extraRow = rows[input.limit];

      return {
        items: pageRows.map(toTicket),
        nextCursor: extraRow ? extraRow.created_at.toISOString() : null
      };
    },
    async close() {
      await sql.end({ timeout: 5 });
    }
  };
}

function toActivityPage(rows: ActivityRow[], limit: number) {
  const pageRows = rows.slice(0, limit);
  const extraRow = rows[limit];

  return {
    items: pageRows.map(toActivityItem),
    nextCursor: extraRow ? extraRow.created_at.toISOString() : null
  };
}

function toActivityItem(row: ActivityRow): ActivityItem {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    state: row.state,
    ...(row.product_type ? { productType: row.product_type } : {}),
    targetId: row.target_id,
    amountMinor: row.amount_minor === null ? null : Number(row.amount_minor),
    ...(row.currency ? { currency: row.currency } : {}),
    paymentIntentId: row.payment_intent_id,
    signature: row.signature,
    referenceAddress: row.reference_address,
    createdAt: row.created_at.toISOString(),
    confirmedAt: row.confirmed_at ? row.confirmed_at.toISOString() : null
  };
}

function toWalletTransaction(row: WalletTransactionRow): WalletTransaction {
  return {
    id: row.id,
    chain: row.chain,
    direction: row.direction,
    amountMinor: Number(row.amount_minor),
    currency: row.currency,
    state: row.state,
    source: row.source,
    paymentIntentId: row.payment_intent_id,
    walletId: row.wallet_id,
    signature: row.signature,
    referenceAddress: row.reference_address,
    createdAt: row.created_at.toISOString(),
    submittedAt: row.submitted_at ? row.submitted_at.toISOString() : null,
    confirmedAt: row.confirmed_at ? row.confirmed_at.toISOString() : null
  };
}

function toTicket(row: TicketRow): TicketPage["items"][number] {
  return {
    id: row.id,
    eventId: row.event_id,
    ticketTypeId: row.ticket_type_id,
    holderUserId: row.holder_user_id,
    paymentIntentId: row.payment_intent_id,
    state: row.state,
    qrToken: row.qr_token,
    checkedInAt: row.checked_in_at ? row.checked_in_at.toISOString() : null,
    createdAt: row.created_at.toISOString()
  };
}
