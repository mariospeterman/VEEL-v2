import type { components } from "@veel/contracts";
import type { ReactNode } from "react";

type AdminOpsSummary = components["schemas"]["AdminOpsSummary"];
type AdminPaymentIntent = components["schemas"]["AdminPaymentIntent"];
type AdminUnlock = components["schemas"]["AdminUnlock"];
type AdminProviderEvent = components["schemas"]["AdminProviderEvent"];

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
          </div>

          <Panel title="Provider events">
            <div className="grid gap-2">
              {providerEvents.map((event) => (
                <ProviderEventRow event={event} key={event.id} />
              ))}
            </div>
          </Panel>
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
