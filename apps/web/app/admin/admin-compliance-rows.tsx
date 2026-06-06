import type {
  AdminComplianceLedgerEntry,
  AdminComplianceReport,
  AdminInvoice,
  AdminReceipt,
  AdminVatDetermination
} from "@/api-client";
import {
  Fact
} from "./admin-ui";

export function ComplianceRow({ entry }: { entry: AdminComplianceLedgerEntry }) {
  return (
    <article className="grid gap-3 rounded border border-(--line) bg-(--background) p-3 text-sm md:grid-cols-[1fr_120px_160px]">
      <div className="min-w-0">
        <p className="font-medium">{entry.productType}</p>
        <p className="mt-1 truncate text-(--muted)">{entry.eventType}</p>
      </div>
      <Fact label="VAT" value={entry.vatStatus} />
      <Fact label="DAC7" value={entry.dac7Reportable ? "reportable" : "not reportable"} />
    </article>
  );
}

export function ReportRow({ report }: { report: AdminComplianceReport }) {
  return (
    <article className="grid gap-3 rounded border border-(--line) bg-(--background) p-3 text-sm md:grid-cols-[1fr_120px_160px]">
      <div className="min-w-0">
        <p className="font-medium">{report.reportType.toUpperCase()}</p>
        <p className="mt-1 truncate text-(--muted)">{report.reportingYear}</p>
      </div>
      <Fact label="State" value={report.state} />
      <Fact label="Lines" value={report.lineCount.toString()} />
    </article>
  );
}

export function VatRow({ determination }: { determination: AdminVatDetermination }) {
  return (
    <article className="rounded border border-(--line) bg-(--background) p-3 text-sm">
      <p className="font-medium">{determination.productType}</p>
      <div className="mt-3 grid gap-2">
        <Fact label="Seller" value={determination.sellerOfRecord} />
        <Fact label="VAT" value={determination.vatStatus} />
      </div>
    </article>
  );
}

export function InvoiceRow({ invoice }: { invoice: AdminInvoice }) {
  return (
    <article className="rounded border border-(--line) bg-(--background) p-3 text-sm">
      <p className="font-medium">{invoice.invoiceNumber}</p>
      <div className="mt-3 grid gap-2">
        <Fact label="Seller of record" value={invoice.sellerOfRecord} />
        <Fact label="State" value={invoice.state} />
      </div>
    </article>
  );
}

export function ReceiptRow({ receipt }: { receipt: AdminReceipt }) {
  return (
    <article className="rounded border border-(--line) bg-(--background) p-3 text-sm">
      <p className="font-medium">{receipt.receiptNumber}</p>
      <div className="mt-3 grid gap-2">
        <Fact label="Product" value={receipt.productType} />
        <Fact label="State" value={receipt.state} />
      </div>
    </article>
  );
}
