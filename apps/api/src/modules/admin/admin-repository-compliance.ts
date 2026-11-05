import type postgres from "postgres";
import { bindCursorScope } from "../../shared/keyset-pagination.js";
import type { AdminRepository } from "./types.js";
import {
  ComplianceLedgerRow,
  ComplianceReportRow,
  VatDeterminationRow,
  ReceiptRow,
  InvoiceRow,
  decodeTimestampIdCursor,
  encodeTimestampIdCursor,
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
      const cursorScope = bindCursorScope("GET /v1/admin/compliance/ledger", {
        sort: "created_at:desc,id:desc"
      });
      const cursor = decodeTimestampIdCursor(cursorScope, input.cursor);
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
        where (
          ${cursor.timestamp}::timestamptz is null
          or created_at < ${cursor.timestamp}::timestamptz
          or (
            created_at = ${cursor.timestamp}::timestamptz
            and (${cursor.id}::uuid is null or id < ${cursor.id}::uuid)
          )
        )
        order by created_at desc, id desc
        limit ${pageSize + 1}
      `;

      return page(rows, toComplianceLedgerEntry, (row) =>
        encodeTimestampIdCursor(cursorScope, row.created_at, row.id)
      );
    },
    async listDac7Reports(input) {
      const cursorScope = bindCursorScope("GET /v1/admin/compliance/dac7/reports", {
        sort: "created_at:desc,id:desc"
      });
      const cursor = decodeTimestampIdCursor(cursorScope, input.cursor);
      const rows = await sql<ComplianceReportRow[]>`
        select id, reporting_year, jurisdiction, state, line_count, export_id::text, null::boolean as carf_reporting_required, created_at, exported_at
        from dac7_reports
        where (
          ${cursor.timestamp}::timestamptz is null
          or created_at < ${cursor.timestamp}::timestamptz
          or (
            created_at = ${cursor.timestamp}::timestamptz
            and (${cursor.id}::uuid is null or id < ${cursor.id}::uuid)
          )
        )
        order by created_at desc, id desc
        limit ${pageSize + 1}
      `;

      return page(
        rows,
        (row) => toComplianceReport(row, "dac7"),
        (row) => encodeTimestampIdCursor(cursorScope, row.created_at, row.id)
      );
    },
    async listCarfReports(input) {
      const cursorScope = bindCursorScope("GET /v1/admin/compliance/carf/reports", {
        sort: "created_at:desc,id:desc"
      });
      const cursor = decodeTimestampIdCursor(cursorScope, input.cursor);
      const rows = await sql<ComplianceReportRow[]>`
        select id, reporting_year, jurisdiction, state, line_count, export_id::text, carf_reporting_required, created_at, exported_at
        from carf_reports
        where (
          ${cursor.timestamp}::timestamptz is null
          or created_at < ${cursor.timestamp}::timestamptz
          or (
            created_at = ${cursor.timestamp}::timestamptz
            and (${cursor.id}::uuid is null or id < ${cursor.id}::uuid)
          )
        )
        order by created_at desc, id desc
        limit ${pageSize + 1}
      `;

      return page(
        rows,
        (row) => toComplianceReport(row, "carf"),
        (row) => encodeTimestampIdCursor(cursorScope, row.created_at, row.id)
      );
    },
    async listVatDeterminations(input) {
      const cursorScope = bindCursorScope("GET /v1/admin/compliance/vat/determinations", {
        sort: "created_at:desc,id:desc"
      });
      const cursor = decodeTimestampIdCursor(cursorScope, input.cursor);
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
        where (
          ${cursor.timestamp}::timestamptz is null
          or created_at < ${cursor.timestamp}::timestamptz
          or (
            created_at = ${cursor.timestamp}::timestamptz
            and (${cursor.id}::uuid is null or id < ${cursor.id}::uuid)
          )
        )
        order by created_at desc, id desc
        limit ${pageSize + 1}
      `;

      return page(rows, toVatDetermination, (row) =>
        encodeTimestampIdCursor(cursorScope, row.created_at, row.id)
      );
    },
    async listReceipts(input) {
      const cursorScope = bindCursorScope("GET /v1/admin/compliance/receipts", {
        sort: "issued_at:desc,id:desc"
      });
      const cursor = decodeTimestampIdCursor(cursorScope, input.cursor);
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
        where (
          ${cursor.timestamp}::timestamptz is null
          or issued_at < ${cursor.timestamp}::timestamptz
          or (
            issued_at = ${cursor.timestamp}::timestamptz
            and (${cursor.id}::uuid is null or id < ${cursor.id}::uuid)
          )
        )
        order by issued_at desc, id desc
        limit ${pageSize + 1}
      `;

      return page(rows, toReceipt, (row) =>
        encodeTimestampIdCursor(cursorScope, row.issued_at, row.id)
      );
    },
    async listInvoices(input) {
      const cursorScope = bindCursorScope("GET /v1/admin/compliance/invoices", {
        sort: "issued_at:desc,id:desc"
      });
      const cursor = decodeTimestampIdCursor(cursorScope, input.cursor);
      const rows = await sql<InvoiceRow[]>`
        select id, invoice_number, seller_of_record, buyer_user_id, seller_user_id, total_amount_minor, vat_amount_minor, currency, state, issued_at
        from vat_invoices
        where (
          ${cursor.timestamp}::timestamptz is null
          or issued_at < ${cursor.timestamp}::timestamptz
          or (
            issued_at = ${cursor.timestamp}::timestamptz
            and (${cursor.id}::uuid is null or id < ${cursor.id}::uuid)
          )
        )
        order by issued_at desc, id desc
        limit ${pageSize + 1}
      `;

      return page(rows, toInvoice, (row) =>
        encodeTimestampIdCursor(cursorScope, row.issued_at, row.id)
      );
    },
  };
}
