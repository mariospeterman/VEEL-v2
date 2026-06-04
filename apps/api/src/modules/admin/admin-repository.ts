import postgres from "postgres";
import type {
  AdminDatingSafety,
  AdminOpsSummary,
  AdminPaymentIntent,
  AdminProviderEvent,
  AdminRepository,
  AdminUnlock
} from "./types.js";

export class AdminRepositoryConfigurationError extends Error {
  constructor() {
    super("DATABASE_URL_NOT_CONFIGURED");
    this.name = "AdminRepositoryConfigurationError";
  }
}

interface CountRow {
  total: string | number;
  pending: string | number;
  submitted: string | number;
  confirmed: string | number;
  failed: string | number;
}

interface PaymentRow {
  id: string;
  product_type: AdminPaymentIntent["productType"];
  amount_minor: string | number;
  currency: AdminPaymentIntent["currency"];
  state: AdminPaymentIntent["state"];
  user_id: string;
  target_id: string;
  reference_address: string;
  submitted_signature: string | null;
  confirmed_signature: string | null;
  settlement_attempt_count: string | number;
  entitlement_id: string | null;
  created_at: Date;
  confirmed_at: Date | null;
}

interface UnlockRow {
  id: string;
  user_id: string;
  target_type: AdminUnlock["targetType"];
  target_id: string;
  product_type: AdminUnlock["productType"];
  payment_intent_id: string | null;
  state: AdminUnlock["state"];
  granted_at: Date;
  expires_at: Date | null;
}

interface ProviderEventRow {
  id: string;
  provider: string;
  event_type: string;
  normalized_state: AdminProviderEvent["state"];
  received_at: Date;
  processed_at: Date | null;
}

const pageSize = 50;

export function createPostgresAdminRepository(databaseUrl?: string): AdminRepository {
  if (!databaseUrl) {
    return {
      async hasAdminAccess() {
        throw new AdminRepositoryConfigurationError();
      },
      async getOpsSummary() {
        throw new AdminRepositoryConfigurationError();
      },
      async listPaymentIntents() {
        throw new AdminRepositoryConfigurationError();
      },
      async listUnlocks() {
        throw new AdminRepositoryConfigurationError();
      },
      async listProviderEvents() {
        throw new AdminRepositoryConfigurationError();
      },
      async getDatingSafety() {
        throw new AdminRepositoryConfigurationError();
      }
    };
  }

  const sql = postgres(databaseUrl, {
    max: 5,
    idle_timeout: 20,
    prepare: false
  });

  return {
    async hasAdminAccess(supabaseUserId) {
      const rows = await sql<{ allowed: boolean }[]>`
        select exists (
          select 1
          from users u
          join staff_memberships sm on sm.user_id = u.id
          where u.supabase_user_id = ${supabaseUserId}
            and u.state = 'active'
            and sm.state = 'active'
            and sm.role in ('owner', 'admin', 'finance', 'ops', 'support', 'creator_success', 'readonly_auditor')
        ) as allowed
      `;

      return Boolean(rows[0]?.allowed);
    },
    async getOpsSummary() {
      const [paymentRows, unlockRows, providerRows, reportRows] = await Promise.all([
        sql<CountRow[]>`
          select
            count(*) as total,
            count(*) filter (where state in ('pending', 'transaction_requested')) as pending,
            count(*) filter (where state = 'submitted') as submitted,
            count(*) filter (where state = 'confirmed') as confirmed,
            count(*) filter (where state in ('failed', 'expired')) as failed
          from payment_intents
        `,
        sql<CountRow[]>`
          select
            count(*) as total,
            0 as pending,
            0 as submitted,
            count(*) filter (where state = 'active') as confirmed,
            count(*) filter (where state in ('expired', 'revoked')) as failed
          from entitlements
        `,
        sql<CountRow[]>`
          select
            count(*) as total,
            count(*) filter (where normalized_state = 'received') as pending,
            0 as submitted,
            count(*) filter (where normalized_state in ('processed', 'replayed', 'ignored')) as confirmed,
            count(*) filter (where normalized_state = 'failed') as failed
          from provider_events
        `,
        sql<{ open_reports: string | number }[]>`
          select 0 as open_reports
        `
      ]);

      const providerCounts = toCounts(providerRows[0]);

      return {
        providerHealth: providerCounts.failed > 0 ? "degraded" : "ok",
        queueHealth: "ok",
        openReports: Number(reportRows[0]?.open_reports ?? 0),
        paymentCounts: toCounts(paymentRows[0]),
        unlockCounts: toCounts(unlockRows[0]),
        providerEventCounts: providerCounts
      };
    },
    async listPaymentIntents(input) {
      const rows = await sql<PaymentRow[]>`
        select
          pi.id,
          pi.product_type,
          pi.amount_minor,
          pi.currency,
          pi.state,
          pi.user_id,
          pi.target_id,
          pi.reference_address,
          pi.submitted_signature,
          pi.confirmed_signature,
          pi.created_at,
          pi.confirmed_at,
          count(psa.id) as settlement_attempt_count,
          max(e.id::text) as entitlement_id
        from payment_intents pi
        left join payment_settlement_attempts psa on psa.payment_intent_id = pi.id
        left join entitlements e on e.payment_intent_id = pi.id
        where (${input.cursor ?? null}::timestamptz is null or pi.created_at < ${input.cursor ?? null}::timestamptz)
          and (
            ${input.query ?? null}::text is null
            or pi.reference_address ilike '%' || ${input.query ?? ""} || '%'
            or pi.submitted_signature ilike '%' || ${input.query ?? ""} || '%'
            or pi.confirmed_signature ilike '%' || ${input.query ?? ""} || '%'
          )
        group by pi.id
        order by pi.created_at desc
        limit ${pageSize + 1}
      `;

      return page(rows, toPaymentIntent);
    },
    async listUnlocks(input) {
      const rows = await sql<UnlockRow[]>`
        select id, user_id, target_type, target_id, product_type, payment_intent_id, state, granted_at, ends_at as expires_at
        from entitlements
        where (${input.cursor ?? null}::timestamptz is null or granted_at < ${input.cursor ?? null}::timestamptz)
          and (
            ${input.query ?? null}::text is null
            or target_id::text = ${input.query ?? ""}
            or payment_intent_id::text = ${input.query ?? ""}
          )
        order by granted_at desc
        limit ${pageSize + 1}
      `;

      return page(rows, toUnlock);
    },
    async listProviderEvents(input) {
      const rows = await sql<ProviderEventRow[]>`
        select id, provider, event_type, normalized_state, received_at, processed_at
        from provider_events
        where (${input.cursor ?? null}::timestamptz is null or received_at < ${input.cursor ?? null}::timestamptz)
        order by received_at desc
        limit ${pageSize + 1}
      `;

      return page(rows, toProviderEvent);
    },
    async getDatingSafety() {
      const rows = await sql<{
        open_reports: string | number;
        active_matches: string | number;
        stale_matches: string | number;
      }[]>`
        select
          0 as open_reports,
          count(*) filter (where state = 'active') as active_matches,
          count(*) filter (where state = 'stale') as stale_matches
        from dating_matches
      `;
      const row = rows[0];

      return {
        openReports: Number(row?.open_reports ?? 0),
        activeMatches: Number(row?.active_matches ?? 0),
        staleMatches: Number(row?.stale_matches ?? 0)
      } satisfies AdminDatingSafety;
    },
    async close() {
      await sql.end({ timeout: 5 });
    }
  };
}

function page<Row, Item>(rows: Row[], mapper: (row: Row) => Item): { items: Item[]; nextCursor: string | null } {
  const visibleRows = rows.slice(0, pageSize);
  const next = rows.length > pageSize ? rows[pageSize] : null;

  return {
    items: visibleRows.map(mapper),
    nextCursor: cursorFor(next)
  };
}

function cursorFor(row: unknown): string | null {
  if (typeof row === "object" && row !== null) {
    if ("created_at" in row && row.created_at instanceof Date) {
      return row.created_at.toISOString();
    }

    if ("granted_at" in row && row.granted_at instanceof Date) {
      return row.granted_at.toISOString();
    }

    if ("received_at" in row && row.received_at instanceof Date) {
      return row.received_at.toISOString();
    }
  }

  return null;
}

function toCounts(row: CountRow | undefined): AdminOpsSummary["paymentCounts"] {
  return {
    total: Number(row?.total ?? 0),
    pending: Number(row?.pending ?? 0),
    submitted: Number(row?.submitted ?? 0),
    confirmed: Number(row?.confirmed ?? 0),
    failed: Number(row?.failed ?? 0)
  };
}

function toPaymentIntent(row: PaymentRow): AdminPaymentIntent {
  return {
    id: row.id,
    productType: row.product_type,
    amountMinor: Number(row.amount_minor),
    currency: row.currency,
    state: row.state,
    userId: row.user_id,
    targetId: row.target_id,
    referenceAddress: row.reference_address,
    submittedSignature: row.submitted_signature,
    confirmedSignature: row.confirmed_signature,
    settlementAttemptCount: Number(row.settlement_attempt_count),
    entitlementId: row.entitlement_id,
    createdAt: row.created_at.toISOString(),
    confirmedAt: row.confirmed_at?.toISOString() ?? null
  };
}

function toUnlock(row: UnlockRow): AdminUnlock {
  return {
    id: row.id,
    userId: row.user_id,
    targetType: row.target_type,
    targetId: row.target_id,
    productType: row.product_type,
    paymentIntentId: row.payment_intent_id,
    state: row.state,
    grantedAt: row.granted_at.toISOString(),
    expiresAt: row.expires_at?.toISOString() ?? null
  };
}

function toProviderEvent(row: ProviderEventRow): AdminProviderEvent {
  return {
    id: row.id,
    provider: row.provider,
    eventType: row.event_type,
    state: row.normalized_state,
    receivedAt: row.received_at.toISOString(),
    processedAt: row.processed_at?.toISOString() ?? null
  };
}
