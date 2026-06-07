import type {
  AdminComplianceLedgerEntry,
  AdminComplianceReport,
  AdminVatDetermination,
  AdminReceipt,
  AdminInvoice
} from "./types.js";

import { nullableNumber, normalizeAdminProductType } from "./admin-repository-mapper-utils.js";

export interface ComplianceLedgerRow {
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

export interface ComplianceReportRow {
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

export interface VatDeterminationRow {
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

export interface ReceiptRow {
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

export interface InvoiceRow {
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

export function toComplianceLedgerEntry(row: ComplianceLedgerRow): AdminComplianceLedgerEntry {
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

export function toComplianceReport(
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

export function toVatDetermination(row: VatDeterminationRow): AdminVatDetermination {
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

export function toReceipt(row: ReceiptRow): AdminReceipt {
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

export function toInvoice(row: InvoiceRow): AdminInvoice {
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
