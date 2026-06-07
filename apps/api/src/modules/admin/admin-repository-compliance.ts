import type postgres from "postgres";
import type { AdminRepository } from "./types.js";
import {
  ComplianceLedgerRow,
  ComplianceReportRow,
  VatDeterminationRow,
  ReceiptRow,
  InvoiceRow,
  pageSize,
  page,
  toComplianceLedgerEntry,
  toComplianceReport,
  toVatDetermination,
  toReceipt,
  toInvoice
} from "./admin-repository-mappers.js";

export function createComplianceRepository(
  sql: postgres.Sql
): Pick<AdminRepository, "listComplianceLedger" | "listDac7Reports" | "listCarfReports" | "listVatDeterminations" | "listReceipts" | "listInvoices"> {
  return {
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
  };
}
