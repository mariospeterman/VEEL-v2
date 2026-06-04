import type { components } from "@veel/contracts";
import { appShellNavItems } from "@veel/ui";

type ActivityItem = components["schemas"]["ActivityItem"];
type WalletTransaction = components["schemas"]["WalletTransaction"];

const paymentActivity: ActivityItem[] = [
  {
    id: "00000000-0000-4000-8000-000000000050",
    kind: "payment_intent",
    title: "Tip",
    state: "confirmed",
    productType: "tip",
    targetId: "00000000-0000-4000-8000-000000000010",
    amountMinor: 10000000,
    currency: "SOL",
    paymentIntentId: "00000000-0000-4000-8000-000000000050",
    signature: "5".repeat(88),
    referenceAddress: "11111111111111111111111111111112",
    createdAt: "2026-06-04T20:00:00.000Z",
    confirmedAt: "2026-06-04T20:01:00.000Z"
  },
  {
    id: "00000000-0000-4000-8000-000000000051",
    kind: "payment_intent",
    title: "Paid message",
    state: "submitted",
    productType: "paid_message",
    targetId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaab10",
    amountMinor: 25000000,
    currency: "SOL",
    paymentIntentId: "00000000-0000-4000-8000-000000000051",
    signature: "4".repeat(88),
    referenceAddress: "11111111111111111111111111111113",
    createdAt: "2026-06-04T20:05:00.000Z",
    confirmedAt: null
  }
];

const walletTransactions: WalletTransaction[] = [
  {
    id: "00000000-0000-4000-8000-000000000060",
    chain: "solana_devnet",
    direction: "outgoing",
    amountMinor: 10000000,
    currency: "SOL",
    state: "confirmed",
    source: "payment_intent",
    paymentIntentId: "00000000-0000-4000-8000-000000000050",
    walletId: "00000000-0000-4000-8000-000000000030",
    signature: "5".repeat(88),
    referenceAddress: "11111111111111111111111111111112",
    createdAt: "2026-06-04T20:00:00.000Z",
    submittedAt: "2026-06-04T20:00:00.000Z",
    confirmedAt: "2026-06-04T20:01:00.000Z"
  }
];

export default function ActivityPage() {
  return (
    <main className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <nav className="mx-auto flex w-full max-w-6xl items-center justify-between border-b border-[var(--line)] px-5 py-4">
        <a className="text-lg font-semibold tracking-normal" href="/">
          VEEL
        </a>
        <div className="flex gap-1">
          {appShellNavItems.map((item) => (
            <a
              className="rounded px-3 py-2 text-sm text-[var(--muted)] transition hover:bg-[var(--panel)] hover:text-[var(--foreground)]"
              href={item.href}
              key={item.href}
            >
              {item.label}
            </a>
          ))}
        </div>
      </nav>

      <section className="mx-auto grid w-full max-w-6xl gap-5 px-5 py-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className="grid content-start gap-4">
          <div>
            <p className="text-sm font-medium text-[var(--accent)]">Activity</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-normal">Payments</h1>
          </div>

          <div className="grid gap-3">
            {paymentActivity.map((item) => (
              <ActivityRow item={item} key={item.id} />
            ))}
          </div>
        </section>

        <aside className="grid content-start gap-3">
          <div className="border-b border-[var(--line)] pb-3">
            <p className="text-sm font-medium text-[var(--muted)]">Wallet transactions</p>
          </div>
          {walletTransactions.map((transaction) => (
            <WalletTransactionCard transaction={transaction} key={transaction.id} />
          ))}
        </aside>
      </section>
    </main>
  );
}

function ActivityRow({ item }: { item: ActivityItem }) {
  return (
    <article className="rounded border border-[var(--line)] bg-[var(--panel)] p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="font-medium">{item.title}</p>
          <p className="mt-1 text-sm text-[var(--muted)]">{item.productType}</p>
        </div>
        <span className="rounded bg-[var(--accent-soft)] px-2 py-1 text-xs font-semibold text-[var(--accent-strong)]">
          {item.state}
        </span>
      </div>
      <div className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
        <Fact label="Amount" value={`${item.amountMinor?.toLocaleString() ?? "0"} ${item.currency ?? ""}`} />
        <Fact label="Kind" value={item.kind} />
        <Fact label="Reference" value={shorten(item.referenceAddress)} />
      </div>
    </article>
  );
}

function WalletTransactionCard({ transaction }: { transaction: WalletTransaction }) {
  return (
    <article className="rounded border border-[var(--line)] bg-[var(--panel)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium">{transaction.direction}</p>
          <p className="mt-1 text-sm text-[var(--muted)]">{transaction.chain}</p>
        </div>
        <span className="rounded bg-[var(--background)] px-2 py-1 text-xs text-[var(--muted)]">
          {transaction.state}
        </span>
      </div>
      <div className="mt-4 grid gap-2 text-sm">
        <Fact label="Amount" value={`${transaction.amountMinor.toLocaleString()} ${transaction.currency}`} />
        <Fact label="Source" value={transaction.source} />
        <Fact label="Signature" value={shorten(transaction.signature)} />
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

function shorten(value: string | null | undefined) {
  if (!value) {
    return "none";
  }

  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}
