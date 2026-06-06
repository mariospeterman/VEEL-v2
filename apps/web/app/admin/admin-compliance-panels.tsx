import type {
  AdminComplianceReport,
  AdminInvoice,
  AdminPage,
  AdminReceipt,
  AdminVatDetermination,
  ApiResult
} from "@/api-client";
import {
  EmptyState,
  UnavailableState
} from "./admin-ui";
import {
  InvoiceRow,
  ReceiptRow,
  ReportRow,
  VatRow
} from "./admin-rows";

export function ReportPanel({
  carfReports,
  dac7Reports
}: {
  carfReports: ApiResult<AdminPage<AdminComplianceReport>>;
  dac7Reports: ApiResult<AdminPage<AdminComplianceReport>>;
}) {
  if (!dac7Reports.ok) {
    return <UnavailableState result={dac7Reports} />;
  }

  const reports = [...dac7Reports.data.items, ...(carfReports.ok ? carfReports.data.items : [])];

  if (reports.length === 0 && carfReports.ok) {
    return <EmptyState label="No DAC7 or CARF reports" />;
  }

  return (
    <div className="grid gap-2">
      {reports.map((report) => (
        <ReportRow key={report.id} report={report} />
      ))}
      {!carfReports.ok ? <UnavailableState result={carfReports} /> : null}
    </div>
  );
}

export function VatReceiptPanel({
  invoices,
  receipts,
  vatDeterminations
}: {
  invoices: ApiResult<AdminPage<AdminInvoice>>;
  receipts: ApiResult<AdminPage<AdminReceipt>>;
  vatDeterminations: ApiResult<AdminPage<AdminVatDetermination>>;
}) {
  if (!vatDeterminations.ok) {
    return <UnavailableState result={vatDeterminations} />;
  }

  if (!receipts.ok) {
    return <UnavailableState result={receipts} />;
  }

  if (!invoices.ok) {
    return <UnavailableState result={invoices} />;
  }

  if (
    vatDeterminations.data.items.length === 0 &&
    receipts.data.items.length === 0 &&
    invoices.data.items.length === 0
  ) {
    return <EmptyState label="No VAT determinations, receipts, or invoices" />;
  }

  return (
    <div className="grid gap-2">
      {vatDeterminations.data.items.map((determination) => (
        <VatRow determination={determination} key={determination.id} />
      ))}
      {receipts.data.items.map((receipt) => (
        <ReceiptRow key={receipt.id} receipt={receipt} />
      ))}
      {invoices.data.items.map((invoice) => (
        <InvoiceRow invoice={invoice} key={invoice.id} />
      ))}
    </div>
  );
}
