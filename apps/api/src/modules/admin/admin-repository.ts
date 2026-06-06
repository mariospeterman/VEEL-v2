import postgres from "postgres";
import type {
  AdminComplianceLedgerEntry,
  AdminComplianceReport,
  AdminDatingSafety,
  AdminInvoice,
  AdminNotificationHealth,
  AdminOpsSummary,
  AdminOrganization,
  AdminPartnerCampaign,
  AdminPaymentIntent,
  AdminProviderEvent,
  AdminReceipt,
  AdminRepository,
  AdminReferralProgram,
  AdminTierWaiver,
  AdminVatDetermination,
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

interface NotificationHealthRow {
  unread_count: string | number;
  read_count: string | number;
  archived_count: string | number;
  active_device_count: string | number;
  revoked_device_count: string | number;
  push_enabled_preference_count: string | number;
  latest_notification_at: Date | null;
  latest_device_seen_at: Date | null;
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

interface ComplianceLedgerRow {
  id: string;
  event_type: AdminComplianceLedgerEntry["eventType"];
  product_type: AdminComplianceLedgerEntry["productType"];
  settlement_model: AdminComplianceLedgerEntry["settlementModel"];
  seller_user_id: string | null;
  buyer_user_id: string | null;
  payment_intent_id: string | null;
  entitlement_id: string | null;
  receipt_id: string | null;
  vat_invoice_id: string | null;
  gross_amount_minor: string | number;
  platform_fee_minor: string | number | null;
  creator_net_amount_minor: string | number | null;
  tax_amount_minor: string | number | null;
  currency: AdminComplianceLedgerEntry["currency"];
  fiat_currency: string;
  fx_rate: string | null;
  seller_country: string | null;
  buyer_country: string | null;
  seller_of_record: AdminComplianceLedgerEntry["sellerOfRecord"];
  vat_status: AdminComplianceLedgerEntry["vatStatus"];
  dac7_reportable: boolean;
  carf_reportable: boolean;
  immutable_hash: string | null;
  created_at: Date;
}

interface ComplianceReportRow {
  id: string;
  reporting_year: string | number;
  jurisdiction: string | null;
  state: AdminComplianceReport["state"];
  line_count: string | number;
  export_id: string | null;
  carf_reporting_required?: boolean | null;
  created_at: Date;
  exported_at: Date | null;
}

interface VatDeterminationRow {
  id: string;
  product_type: AdminVatDetermination["productType"];
  seller_of_record: AdminVatDetermination["sellerOfRecord"];
  buyer_country: string | null;
  seller_country: string | null;
  buyer_vat_id_hash: string | null;
  vies_status: AdminVatDetermination["viesStatus"];
  place_of_supply: string | null;
  vat_status: AdminVatDetermination["vatStatus"];
  vat_rate_bps: string | number | null;
  vat_amount_minor: string | number | null;
  review_state: AdminVatDetermination["reviewState"];
  created_at: Date;
}

interface ReceiptRow {
  id: string;
  receipt_number: string;
  product_type: AdminReceipt["productType"];
  buyer_user_id: string | null;
  seller_user_id: string | null;
  payment_intent_id: string | null;
  gross_amount_minor: string | number;
  currency: AdminReceipt["currency"];
  state: AdminReceipt["state"];
  issued_at: Date;
}

interface InvoiceRow {
  id: string;
  invoice_number: string;
  seller_of_record: AdminInvoice["sellerOfRecord"];
  buyer_user_id: string | null;
  seller_user_id: string | null;
  total_amount_minor: string | number;
  vat_amount_minor: string | number;
  currency: AdminInvoice["currency"];
  state: AdminInvoice["state"];
  issued_at: Date;
}

interface ReferralProgramRow {
  id: string;
  name: string;
  state: AdminReferralProgram["state"];
  priority: AdminReferralProgram["priority"];
  commission_source: AdminReferralProgram["commissionSource"];
  created_at: Date;
}

interface PartnerCampaignRow {
  id: string;
  name: string;
  partner_name: string;
  state: AdminPartnerCampaign["state"];
  contract_id: string | null;
  created_at: Date;
}

interface TierWaiverRow {
  id: string;
  subject_type: AdminTierWaiver["subjectType"];
  subject_id: string;
  tier_key: AdminTierWaiver["tierKey"];
  state: AdminTierWaiver["state"];
  starts_at: Date;
  ends_at: Date | null;
}

interface OrganizationRow {
  id: string;
  name: string;
  state: AdminOrganization["state"];
  plan: AdminOrganization["plan"];
  kyb_state: AdminOrganization["kybState"];
  created_at: Date;
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
      async getNotificationHealth() {
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
      },
      async listComplianceLedger() {
        throw new AdminRepositoryConfigurationError();
      },
      async listDac7Reports() {
        throw new AdminRepositoryConfigurationError();
      },
      async listCarfReports() {
        throw new AdminRepositoryConfigurationError();
      },
      async listVatDeterminations() {
        throw new AdminRepositoryConfigurationError();
      },
      async listReceipts() {
        throw new AdminRepositoryConfigurationError();
      },
      async listInvoices() {
        throw new AdminRepositoryConfigurationError();
      },
      async listReferralPrograms() {
        throw new AdminRepositoryConfigurationError();
      },
      async listPartnerCampaigns() {
        throw new AdminRepositoryConfigurationError();
      },
      async listTierWaivers() {
        throw new AdminRepositoryConfigurationError();
      },
      async listOrganizations() {
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
    async getNotificationHealth() {
      const rows = await sql<NotificationHealthRow[]>`
        select
          (select count(*) from notifications where state = 'unread') as unread_count,
          (select count(*) from notifications where state = 'read') as read_count,
          (select count(*) from notifications where state = 'archived') as archived_count,
          (select count(*) from notification_devices where state = 'active') as active_device_count,
          (select count(*) from notification_devices where state = 'revoked') as revoked_device_count,
          (select count(*) from notification_preferences where push_enabled) as push_enabled_preference_count,
          (select max(created_at) from notifications) as latest_notification_at,
          (select max(last_seen_at) from notification_devices) as latest_device_seen_at
      `;

      return toNotificationHealth(rows[0]);
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
    async listComplianceLedger(input) {
      const rows = await sql<ComplianceLedgerRow[]>`
        select
          id,
          event_type,
          product_type,
          settlement_model,
          seller_user_id,
          buyer_user_id,
          payment_intent_id,
          entitlement_id,
          receipt_id,
          vat_invoice_id,
          gross_amount_minor,
          platform_fee_minor,
          creator_net_amount_minor,
          tax_amount_minor,
          currency,
          fiat_currency,
          fx_rate::text,
          seller_country,
          buyer_country,
          seller_of_record,
          vat_status,
          dac7_reportable,
          carf_reportable,
          immutable_hash,
          created_at
        from compliance_ledger_entries
        where (${input.cursor ?? null}::timestamptz is null or created_at < ${input.cursor ?? null}::timestamptz)
        order by created_at desc
        limit ${pageSize + 1}
      `;

      return page(rows, toComplianceLedgerEntry);
    },
    async listDac7Reports(input) {
      const rows = await sql<ComplianceReportRow[]>`
        select id, reporting_year, jurisdiction, state, line_count, export_id::text, null::boolean as carf_reporting_required, created_at, exported_at
        from dac7_reports
        where (${input.cursor ?? null}::timestamptz is null or created_at < ${input.cursor ?? null}::timestamptz)
        order by created_at desc
        limit ${pageSize + 1}
      `;

      return page(rows, (row) => toComplianceReport(row, "dac7"));
    },
    async listCarfReports(input) {
      const rows = await sql<ComplianceReportRow[]>`
        select id, reporting_year, jurisdiction, state, line_count, export_id::text, carf_reporting_required, created_at, exported_at
        from carf_reports
        where (${input.cursor ?? null}::timestamptz is null or created_at < ${input.cursor ?? null}::timestamptz)
        order by created_at desc
        limit ${pageSize + 1}
      `;

      return page(rows, (row) => toComplianceReport(row, "carf"));
    },
    async listVatDeterminations(input) {
      const rows = await sql<VatDeterminationRow[]>`
        select
          id,
          product_type,
          seller_of_record,
          buyer_country,
          seller_country,
          buyer_vat_id_hash,
          vies_status,
          place_of_supply,
          vat_status,
          vat_rate_bps,
          vat_amount_minor,
          review_state,
          created_at
        from vat_determinations
        where (${input.cursor ?? null}::timestamptz is null or created_at < ${input.cursor ?? null}::timestamptz)
        order by created_at desc
        limit ${pageSize + 1}
      `;

      return page(rows, toVatDetermination);
    },
    async listReceipts(input) {
      const rows = await sql<ReceiptRow[]>`
        select
          id,
          receipt_number,
          product_type,
          buyer_user_id,
          seller_user_id,
          payment_intent_id,
          gross_amount_minor,
          currency,
          state,
          issued_at
        from receipts
        where (${input.cursor ?? null}::timestamptz is null or issued_at < ${input.cursor ?? null}::timestamptz)
        order by issued_at desc
        limit ${pageSize + 1}
      `;

      return page(rows, toReceipt);
    },
    async listInvoices(input) {
      const rows = await sql<InvoiceRow[]>`
        select id, invoice_number, seller_of_record, buyer_user_id, seller_user_id, total_amount_minor, vat_amount_minor, currency, state, issued_at
        from vat_invoices
        where (${input.cursor ?? null}::timestamptz is null or issued_at < ${input.cursor ?? null}::timestamptz)
        order by issued_at desc
        limit ${pageSize + 1}
      `;

      return page(rows, toInvoice);
    },
    async listReferralPrograms(input) {
      const rows = await sql<ReferralProgramRow[]>`
        select id, name, state, priority, commission_source, created_at
        from referral_programs
        where (${input.cursor ?? null}::timestamptz is null or created_at < ${input.cursor ?? null}::timestamptz)
        order by created_at desc
        limit ${pageSize + 1}
      `;

      return page(rows, toReferralProgram);
    },
    async listPartnerCampaigns(input) {
      const rows = await sql<PartnerCampaignRow[]>`
        select id, name, partner_name, state, contract_id, created_at
        from partner_campaigns
        where (${input.cursor ?? null}::timestamptz is null or created_at < ${input.cursor ?? null}::timestamptz)
        order by created_at desc
        limit ${pageSize + 1}
      `;

      return page(rows, toPartnerCampaign);
    },
    async listTierWaivers(input) {
      const rows = await sql<TierWaiverRow[]>`
        select id, subject_type, subject_id, tier_key, state, starts_at, ends_at
        from tier_waivers
        where (${input.cursor ?? null}::timestamptz is null or starts_at < ${input.cursor ?? null}::timestamptz)
        order by starts_at desc
        limit ${pageSize + 1}
      `;

      return page(rows, toTierWaiver);
    },
    async listOrganizations(input) {
      const rows = await sql<OrganizationRow[]>`
        select id, name, state, plan, kyb_state, created_at
        from organizations
        where (${input.cursor ?? null}::timestamptz is null or created_at < ${input.cursor ?? null}::timestamptz)
        order by created_at desc
        limit ${pageSize + 1}
      `;

      return page(rows, toOrganization);
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

    if ("issued_at" in row && row.issued_at instanceof Date) {
      return row.issued_at.toISOString();
    }

    if ("starts_at" in row && row.starts_at instanceof Date) {
      return row.starts_at.toISOString();
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

function toNotificationHealth(row: NotificationHealthRow | undefined): AdminNotificationHealth {
  return {
    unreadCount: Number(row?.unread_count ?? 0),
    readCount: Number(row?.read_count ?? 0),
    archivedCount: Number(row?.archived_count ?? 0),
    activeDeviceCount: Number(row?.active_device_count ?? 0),
    revokedDeviceCount: Number(row?.revoked_device_count ?? 0),
    pushEnabledPreferenceCount: Number(row?.push_enabled_preference_count ?? 0),
    latestNotificationAt: row?.latest_notification_at?.toISOString() ?? null,
    latestDeviceSeenAt: row?.latest_device_seen_at?.toISOString() ?? null
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

function toComplianceLedgerEntry(row: ComplianceLedgerRow): AdminComplianceLedgerEntry {
  return {
    id: row.id,
    eventType: row.event_type,
    productType: normalizeAdminProductType(row.product_type),
    settlementModel: row.settlement_model,
    sellerUserId: row.seller_user_id,
    buyerUserId: row.buyer_user_id,
    paymentIntentId: row.payment_intent_id,
    entitlementId: row.entitlement_id,
    receiptId: row.receipt_id,
    invoiceId: row.vat_invoice_id,
    grossAmountMinor: Number(row.gross_amount_minor),
    platformFeeMinor: nullableNumber(row.platform_fee_minor),
    creatorNetAmountMinor: nullableNumber(row.creator_net_amount_minor),
    taxAmountMinor: nullableNumber(row.tax_amount_minor),
    currency: row.currency,
    fiatCurrency: row.fiat_currency,
    fxRate: row.fx_rate,
    sellerCountry: row.seller_country,
    buyerCountry: row.buyer_country,
    sellerOfRecord: row.seller_of_record ?? "undetermined",
    vatStatus: row.vat_status,
    dac7Reportable: row.dac7_reportable,
    carfReportable: row.carf_reportable,
    immutableHash: row.immutable_hash,
    createdAt: row.created_at.toISOString()
  };
}

function toComplianceReport(
  row: ComplianceReportRow,
  reportType: AdminComplianceReport["reportType"]
): AdminComplianceReport {
  return {
    id: row.id,
    reportType,
    reportingYear: Number(row.reporting_year),
    state: row.state,
    lineCount: Number(row.line_count),
    jurisdiction: row.jurisdiction,
    exportId: row.export_id,
    carfReportingRequired: row.carf_reporting_required ?? null,
    createdAt: row.created_at.toISOString(),
    exportedAt: row.exported_at?.toISOString() ?? null
  };
}

function toVatDetermination(row: VatDeterminationRow): AdminVatDetermination {
  return {
    id: row.id,
    productType: normalizeAdminProductType(row.product_type),
    sellerOfRecord: row.seller_of_record,
    buyerCountry: row.buyer_country,
    sellerCountry: row.seller_country,
    buyerVatId: row.buyer_vat_id_hash,
    viesStatus: row.vies_status ?? null,
    placeOfSupply: row.place_of_supply,
    vatStatus: row.vat_status,
    vatRateBps: nullableNumber(row.vat_rate_bps),
    vatAmountMinor: nullableNumber(row.vat_amount_minor),
    reviewState: row.review_state ?? "clear",
    createdAt: row.created_at.toISOString()
  };
}

function toReceipt(row: ReceiptRow): AdminReceipt {
  return {
    id: row.id,
    receiptNumber: row.receipt_number,
    productType: normalizeAdminProductType(row.product_type),
    buyerUserId: row.buyer_user_id,
    sellerUserId: row.seller_user_id,
    paymentIntentId: row.payment_intent_id,
    grossAmountMinor: Number(row.gross_amount_minor),
    currency: row.currency,
    state: row.state,
    issuedAt: row.issued_at.toISOString()
  };
}

function toInvoice(row: InvoiceRow): AdminInvoice {
  return {
    id: row.id,
    invoiceNumber: row.invoice_number,
    sellerOfRecord: row.seller_of_record,
    buyerUserId: row.buyer_user_id,
    sellerUserId: row.seller_user_id,
    totalAmountMinor: Number(row.total_amount_minor),
    vatAmountMinor: Number(row.vat_amount_minor),
    currency: row.currency,
    state: row.state,
    issuedAt: row.issued_at.toISOString()
  };
}

function toReferralProgram(row: ReferralProgramRow): AdminReferralProgram {
  return {
    id: row.id,
    name: row.name,
    state: row.state,
    priority: row.priority,
    ...(row.commission_source ? { commissionSource: row.commission_source } : {}),
    createdAt: row.created_at.toISOString()
  };
}

function toPartnerCampaign(row: PartnerCampaignRow): AdminPartnerCampaign {
  return {
    id: row.id,
    name: row.name,
    partnerName: row.partner_name,
    state: row.state,
    contractId: row.contract_id,
    createdAt: row.created_at.toISOString()
  };
}

function toTierWaiver(row: TierWaiverRow): AdminTierWaiver {
  return {
    id: row.id,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    tierKey: row.tier_key,
    state: row.state,
    startsAt: row.starts_at.toISOString(),
    endsAt: row.ends_at?.toISOString() ?? null
  };
}

function toOrganization(row: OrganizationRow): AdminOrganization {
  return {
    id: row.id,
    name: row.name,
    state: row.state,
    plan: row.plan,
    ...(row.kyb_state ? { kybState: row.kyb_state } : {}),
    createdAt: row.created_at.toISOString()
  };
}

function nullableNumber(value: string | number | null): number | null {
  return value === null ? null : Number(value);
}

function normalizeAdminProductType(productType: string): AdminComplianceLedgerEntry["productType"] {
  switch (productType) {
    case "tip":
      return "support";
    case "event_ticket":
      return "event_access_pass";
    case "creator_subscription":
      return "membership";
    case "platform_subscription":
      return "platform_plus";
    default:
      return productType as AdminComplianceLedgerEntry["productType"];
  }
}
