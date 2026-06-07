import { appShellNavItems } from "@veel/ui";
import {
  getPaymentActivity,
  getWalletTransactionActivity,
  type ActivityItem,
  type ApiResult,
  type WalletTransaction,
  type WalletTransactionPage
} from "@/api-client";
import { requireAppAccess } from "@/supabase/route-guard";

export const dynamic = "force-dynamic";

export default async function ActivityPage() {
  await requireAppAccess("/activity");

  const [paymentActivity, walletTransactions] = await Promise.all([
    getPaymentActivity(),
    getWalletTransactionActivity()
  ]);

  return (
    <main className="min-h-screen bg-(--background) text-(--foreground)">
      <nav className="mx-auto flex w-full max-w-6xl items-center justify-between border-b border-(--line) px-5 py-4">
        <a className="text-lg font-semibold tracking-normal" href="/">
          VEEL
        </a>
        <div className="flex gap-1">
          {appShellNavItems.map((item) => (
            <a
              className="rounded px-3 py-2 text-sm text-(--muted) transition hover:bg-(--panel) hover:text-(--foreground)"
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
            <p className="text-sm font-medium text-(--accent)">Activity</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-normal">Payments</h1>
          </div>

          <div className="grid gap-3">
            {paymentActivity.ok ? (
              paymentActivity.data.items.length > 0 ? (
                paymentActivity.data.items.map((item) => <ActivityRow item={item} key={item.id} />)
              ) : (
                <EmptyState label="No payment activity yet" />
              )
            ) : (
              <UnavailableState result={paymentActivity} title="Payment activity unavailable" />
            )}
          </div>
        </section>

        <aside className="grid content-start gap-3">
          <div className="border-b border-(--line) pb-3">
            <p className="text-sm font-medium text-(--muted)">Wallet transactions</p>
          </div>
          {walletTransactions.ok ? (
            walletTransactions.data.items.length > 0 ? (
              walletTransactions.data.items.map((transaction) => (
                <WalletTransactionCard transaction={transaction} key={transaction.id} />
              ))
            ) : (
              <EmptyState label="No wallet transactions yet" />
            )
          ) : (
            <UnavailableState result={walletTransactions} title="Wallet transactions unavailable" />
          )}
        </aside>
      </section>
    </main>
  );
}

function ActivityRow({ item }: { item: ActivityItem }) {
  return (
    <article className="rounded border border-(--line) bg-(--panel) p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="font-medium">{item.title}</p>
          <p className="mt-1 text-sm text-(--muted)">{item.productType}</p>
        </div>
        <span className="rounded bg-(--accent-soft) px-2 py-1 text-xs font-semibold text-(--accent-strong)">
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
    <article className="rounded border border-(--line) bg-(--panel) p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium">{transaction.direction}</p>
          <p className="mt-1 text-sm text-(--muted)">{transaction.chain}</p>
        </div>
        <span className="rounded bg-(--background) px-2 py-1 text-xs text-(--muted)">
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
      <p className="text-xs uppercase text-(--muted)">{label}</p>
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

function EmptyState({ label }: { label: string }) {
  return (
    <div className="rounded border border-(--line) bg-(--panel) p-4 text-sm text-(--muted)">
      {label}
    </div>
  );
}

function UnavailableState({
  result,
  title
}: {
  result: ApiResult<unknown> | ApiResult<WalletTransactionPage>;
  title: string;
}) {
  if (result.ok) {
    return null;
  }

  return (
    <div className="rounded border border-(--line) bg-(--panel) p-4">
      <p className="text-sm font-medium text-(--accent)">HTTP {result.status}</p>
      <h2 className="mt-2 text-base font-semibold tracking-normal">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-(--muted)">{result.message}</p>
    </div>
  );
}
