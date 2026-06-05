import type { components } from "@veel/contracts";
import type { ReactNode } from "react";

type AdminOpsSummary = components["schemas"]["AdminOpsSummary"];
type AdminPaymentIntent = components["schemas"]["AdminPaymentIntent"];
type AdminUnlock = components["schemas"]["AdminUnlock"];
type AdminProviderEvent = components["schemas"]["AdminProviderEvent"];
type AdminComplianceLedgerEntry = components["schemas"]["AdminComplianceLedgerEntry"];
type AdminComplianceReport = components["schemas"]["AdminComplianceReport"];
type AdminVatDetermination = components["schemas"]["AdminVatDetermination"];
type AdminReceipt = components["schemas"]["AdminReceipt"];

const summary: AdminOpsSummary = {
  providerHealth: "ok",
  queueHealth: "ok",
  openReports: 0,
  paymentCounts: { total: 2, pending: 1, submitted: 0, confirmed: 1, failed: 0 },
  unlockCounts: { total: 1, pending: 0, submitted: 0, confirmed: 1, failed: 0 },
  providerEventCounts: { total: 1, pending: 0, submitted: 0, confirmed: 1, failed: 0 }
};

const payments: AdminPaymentIntent[] = [
  {
    id: "00000000-0000-4000-8000-000000000050",
    productType: "content_unlock",
    amountMinor: 10000000,
    currency: "SOL",
    state: "confirmed",
    userId: "00000000-0000-4000-8000-000000000011",
    targetId: "00000000-0000-4000-8000-000000000040",
    referenceAddress: "11111111111111111111111111111112",
    submittedSignature: "4".repeat(88),
    confirmedSignature: "5".repeat(88),
    settlementAttemptCount: 1,
    entitlementId: "00000000-0000-4000-8000-000000000090",
    createdAt: "2026-06-04T20:00:00.000Z",
    confirmedAt: "2026-06-04T20:01:00.000Z"
  }
];

const unlocks: AdminUnlock[] = [
  {
    id: "00000000-0000-4000-8000-000000000090",
    userId: "00000000-0000-4000-8000-000000000011",
    targetType: "content",
    targetId: "00000000-0000-4000-8000-000000000040",
    productType: "content_unlock",
    paymentIntentId: "00000000-0000-4000-8000-000000000050",
    state: "active",
    grantedAt: "2026-06-04T20:01:00.000Z",
    expiresAt: null
  }
];

const providerEvents: AdminProviderEvent[] = [
  {
    id: "00000000-0000-4000-8000-0000000000a0",
    provider: "solana_rpc",
    eventType: "payment.settlement",
    state: "processed",
    receivedAt: "2026-06-04T20:01:00.000Z",
    processedAt: "2026-06-04T20:01:01.000Z"
  }
];

const complianceLedger: AdminComplianceLedgerEntry[] = [
  {
    id: "00000000-0000-4000-8000-0000000000b0",
    eventType: "payment_settled",
    productType: "event_access_pass",
    settlementModel: "user_to_creator_split",
    sellerUserId: "00000000-0000-4000-8000-000000000010",
    buyerUserId: "00000000-0000-4000-8000-000000000011",
    paymentIntentId: "00000000-0000-4000-8000-000000000050",
    entitlementId: "00000000-0000-4000-8000-000000000091",
    receiptId: "00000000-0000-4000-8000-0000000000c0",
    invoiceId: null,
    grossAmountMinor: 10000000,
    platformFeeMinor: 1000000,
    creatorNetAmountMinor: 9000000,
    taxAmountMinor: null,
    currency: "SOL",
    fiatCurrency: "USD",
    fxRate: null,
    sellerCountry: "CH",
    buyerCountry: "DE",
    sellerOfRecord: "creator",
    vatStatus: "pending",
    dac7Reportable: true,
    carfReportable: false,
    immutableHash: "hash",
    createdAt: "2026-06-05T10:00:00.000Z"
  }
];

const reports: AdminComplianceReport[] = [
  {
    id: "00000000-0000-4000-8000-0000000000d0",
    reportType: "dac7",
    reportingYear: 2026,
    state: "draft",
    lineCount: 0,
    jurisdiction: "EU",
    exportId: null,
    carfReportingRequired: null,
    createdAt: "2026-06-05T10:00:00.000Z",
    exportedAt: null
  },
  {
    id: "00000000-0000-4000-8000-0000000000d1",
    reportType: "carf",
    reportingYear: 2026,
    state: "draft",
    lineCount: 0,
    jurisdiction: "EU",
    exportId: null,
    carfReportingRequired: false,
    createdAt: "2026-06-05T10:00:00.000Z",
    exportedAt: null
  }
];

const vatDeterminations: AdminVatDetermination[] = [
  {
    id: "00000000-0000-4000-8000-0000000000e0",
    productType: "event_access_pass",
    sellerOfRecord: "creator",
    buyerCountry: "DE",
    sellerCountry: "CH",
    buyerVatId: null,
    viesStatus: "not_checked",
    placeOfSupply: null,
    vatStatus: "pending",
    vatRateBps: null,
    vatAmountMinor: null,
    reviewState: "clear",
    createdAt: "2026-06-05T10:00:00.000Z"
  }
];

const receipts: AdminReceipt[] = [
  {
    id: "00000000-0000-4000-8000-0000000000c0",
    receiptNumber: "R-2026-0001",
    productType: "event_access_pass",
    buyerUserId: "00000000-0000-4000-8000-000000000011",
    sellerUserId: "00000000-0000-4000-8000-000000000010",
    paymentIntentId: "00000000-0000-4000-8000-000000000050",
    grossAmountMinor: 10000000,
    currency: "SOL",
    state: "issued",
    issuedAt: "2026-06-05T10:00:00.000Z"
  }
];

export default function AdminPage() {
  return (
    <main className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <nav className="mx-auto flex w-full max-w-7xl items-center justify-between border-b border-[var(--line)] px-5 py-4">
        <a className="text-lg font-semibold tracking-normal" href="/">
          VEEL
        </a>
        <div className="rounded border border-[var(--line)] px-3 py-1 text-xs font-medium text-[var(--muted)]">
          Admin
        </div>
      </nav>

      <section className="mx-auto grid w-full max-w-7xl gap-5 px-5 py-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-[var(--accent)]">Admin ops</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-normal">Payments and unlocks</h1>
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <Metric label="Provider" value={summary.providerHealth} />
            <Metric label="Queue" value={summary.queueHealth} />
            <Metric label="Payments" value={summary.paymentCounts.total.toString()} />
            <Metric label="Unlocks" value={summary.unlockCounts.total.toString()} />
          </div>
        </div>

        <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="grid content-start gap-4">
            <Panel title="Payments">
              <div className="grid gap-2">
                {payments.map((payment) => (
                  <PaymentRow payment={payment} key={payment.id} />
                ))}
              </div>
            </Panel>

            <Panel title="Unlocks">
              <div className="grid gap-2">
                {unlocks.map((unlock) => (
                  <UnlockRow key={unlock.id} unlock={unlock} />
                ))}
              </div>
            </Panel>

            <Panel title="Compliance ledger">
              <div className="grid gap-2">
                {complianceLedger.map((entry) => (
                  <ComplianceRow entry={entry} key={entry.id} />
                ))}
              </div>
            </Panel>

            <Panel title="DAC7 and CARF reports">
              <div className="grid gap-2">
                {reports.map((report) => (
                  <ReportRow key={report.id} report={report} />
                ))}
              </div>
            </Panel>
          </div>

          <div className="grid content-start gap-4">
            <Panel title="Provider events">
              <div className="grid gap-2">
                {providerEvents.map((event) => (
                  <ProviderEventRow event={event} key={event.id} />
                ))}
              </div>
            </Panel>

            <Panel title="VAT and receipts">
              <div className="grid gap-2">
                {vatDeterminations.map((determination) => (
                  <VatRow determination={determination} key={determination.id} />
                ))}
                {receipts.map((receipt) => (
                  <ReceiptRow key={receipt.id} receipt={receipt} />
                ))}
              </div>
            </Panel>
          </div>
        </section>
      </section>
    </main>
  );
}

function Panel({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section className="rounded border border-[var(--line)] bg-[var(--panel)] p-4">
      <h2 className="text-base font-semibold tracking-normal">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-[120px] rounded border border-[var(--line)] bg-[var(--panel)] px-3 py-2">
      <p className="text-xs uppercase text-[var(--muted)]">{label}</p>
      <p className="mt-1 font-semibold tracking-normal">{value}</p>
    </div>
  );
}

function PaymentRow({ payment }: { payment: AdminPaymentIntent }) {
  return (
    <article className="grid gap-3 rounded border border-[var(--line)] bg-[var(--background)] p-3 text-sm md:grid-cols-[1fr_120px_160px]">
      <div className="min-w-0">
        <p className="font-medium">{payment.productType}</p>
        <p className="mt-1 truncate text-[var(--muted)]">{shorten(payment.referenceAddress)}</p>
      </div>
      <Fact label="State" value={payment.state} />
      <Fact label="Settlement attempts" value={(payment.settlementAttemptCount ?? 0).toString()} />
    </article>
  );
}

function UnlockRow({ unlock }: { unlock: AdminUnlock }) {
  return (
    <article className="grid gap-3 rounded border border-[var(--line)] bg-[var(--background)] p-3 text-sm md:grid-cols-[1fr_120px_160px]">
      <div className="min-w-0">
        <p className="font-medium">{unlock.productType}</p>
        <p className="mt-1 truncate text-[var(--muted)]">{unlock.targetId}</p>
      </div>
      <Fact label="State" value={unlock.state} />
      <Fact label="Target" value={unlock.targetType} />
    </article>
  );
}

function ProviderEventRow({ event }: { event: AdminProviderEvent }) {
  return (
    <article className="rounded border border-[var(--line)] bg-[var(--background)] p-3 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{event.provider}</p>
          <p className="mt-1 truncate text-[var(--muted)]">{event.eventType}</p>
        </div>
        <span className="rounded bg-[var(--accent-soft)] px-2 py-1 text-xs font-medium text-[var(--accent-strong)]">
          {event.state}
        </span>
      </div>
      <div className="mt-3 grid gap-2">
        <Fact label="Received" value={formatDate(event.receivedAt)} />
        <Fact label="Processed" value={formatDate(event.processedAt ?? null)} />
      </div>
    </article>
  );
}

function ComplianceRow({ entry }: { entry: AdminComplianceLedgerEntry }) {
  return (
    <article className="grid gap-3 rounded border border-[var(--line)] bg-[var(--background)] p-3 text-sm md:grid-cols-[1fr_120px_160px]">
      <div className="min-w-0">
        <p className="font-medium">{entry.productType}</p>
        <p className="mt-1 truncate text-[var(--muted)]">{entry.eventType}</p>
      </div>
      <Fact label="VAT" value={entry.vatStatus} />
      <Fact label="DAC7" value={entry.dac7Reportable ? "reportable" : "not reportable"} />
    </article>
  );
}

function ReportRow({ report }: { report: AdminComplianceReport }) {
  return (
    <article className="grid gap-3 rounded border border-[var(--line)] bg-[var(--background)] p-3 text-sm md:grid-cols-[1fr_120px_160px]">
      <div className="min-w-0">
        <p className="font-medium">{report.reportType.toUpperCase()}</p>
        <p className="mt-1 truncate text-[var(--muted)]">{report.reportingYear}</p>
      </div>
      <Fact label="State" value={report.state} />
      <Fact label="Lines" value={report.lineCount.toString()} />
    </article>
  );
}

function VatRow({ determination }: { determination: AdminVatDetermination }) {
  return (
    <article className="rounded border border-[var(--line)] bg-[var(--background)] p-3 text-sm">
      <p className="font-medium">{determination.productType}</p>
      <div className="mt-3 grid gap-2">
        <Fact label="Seller" value={determination.sellerOfRecord} />
        <Fact label="VAT" value={determination.vatStatus} />
      </div>
    </article>
  );
}

function ReceiptRow({ receipt }: { receipt: AdminReceipt }) {
  return (
    <article className="rounded border border-[var(--line)] bg-[var(--background)] p-3 text-sm">
      <p className="font-medium">{receipt.receiptNumber}</p>
      <div className="mt-3 grid gap-2">
        <Fact label="Product" value={receipt.productType} />
        <Fact label="State" value={receipt.state} />
      </div>
    </article>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs uppercase text-[var(--muted)]">{label}</p>
      <p className="mt-1 truncate font-medium">{value}</p>
    </div>
  );
}

function formatDate(value: string | null) {
  if (!value) {
    return "none";
  }

  return new Date(value).toISOString();
}

function shorten(value: string) {
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}
