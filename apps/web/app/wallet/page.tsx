import { appShellNavItems } from "@veel/ui";
import {
  getWallets,
  getWalletTransactionActivity,
  type ApiResult,
  type Wallet,
  type WalletList,
  type WalletTransaction,
  type WalletTransactionPage
} from "@/api-client";

export default async function WalletPage() {
  const [wallets, walletTransactions] = await Promise.all([
    getWallets(),
    getWalletTransactionActivity()
  ]);
  const primaryWallet = wallets.ok
    ? (wallets.data.items.find((wallet) => wallet.isPrimary) ?? wallets.data.items[0] ?? null)
    : null;

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

      <section className="mx-auto grid h-[calc(100vh-65px)] w-full max-w-6xl gap-5 overflow-hidden px-5 py-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className="grid min-h-0 content-start gap-4 overflow-hidden">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-[var(--accent)]">Wallet</p>
              <h1 className="mt-1 text-2xl font-semibold tracking-normal">Funding and receipts</h1>
            </div>
            <span className="hidden rounded border border-[var(--line)] bg-[var(--panel)] px-3 py-2 text-sm text-[var(--muted)] sm:block">
              /v1/wallets
            </span>
          </div>

          {wallets.ok ? (
            <>
              {primaryWallet ? (
                <PrimaryWalletCard wallet={primaryWallet} />
              ) : (
                <EmptyState label="No linked wallets yet" />
              )}

              <section className="grid gap-3">
                {wallets.data.items.map((wallet) => (
                  <WalletRow wallet={wallet} key={wallet.id} />
                ))}
              </section>
            </>
          ) : (
            <UnavailableState result={wallets} title="Wallets unavailable" />
          )}
        </section>

        <aside className="grid min-h-0 content-start gap-4 overflow-hidden">
          <section className="rounded border border-[var(--line)] bg-[var(--panel)] p-4">
            <p className="text-sm font-medium text-[var(--muted)]">Top up</p>
            <h2 className="mt-1 text-lg font-semibold tracking-normal">User-owned wallet funding</h2>
            <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
              Funding sessions are created by the backend for a linked wallet only after explicit
              user action. Funding sessions do not unlock content, tickets, messages, memberships,
              or support.
            </p>
            {primaryWallet ? (
              <div className="mt-4 grid gap-2 text-sm">
                <Fact label="Destination" value={shorten(primaryWallet.address)} />
                <Fact label="Provider" value="server configured" />
                <Fact label="Access effect" value="none" />
              </div>
            ) : null}
          </section>

          <section className="grid gap-3 overflow-hidden">
            <div className="border-b border-[var(--line)] pb-3">
              <p className="text-sm font-medium text-[var(--muted)]">Recent wallet transactions</p>
            </div>
            {walletTransactions.ok ? (
              walletTransactions.data.items.length > 0 ? (
                walletTransactions.data.items.map((transaction) => (
                  <TransactionRow transaction={transaction} key={transaction.id} />
                ))
              ) : (
                <EmptyState label="No wallet transactions yet" />
              )
            ) : (
              <UnavailableState result={walletTransactions} title="Wallet transactions unavailable" />
            )}
          </section>
        </aside>
      </section>
    </main>
  );
}

function PrimaryWalletCard({ wallet }: { wallet: Wallet }) {
  return (
    <article className="rounded border border-[var(--line)] bg-[var(--panel)] p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm text-[var(--muted)]">Primary wallet</p>
          <p className="mt-2 truncate text-xl font-semibold tracking-normal">{wallet.address}</p>
        </div>
        <span className="rounded bg-[var(--accent-soft)] px-2 py-1 text-xs font-semibold text-[var(--accent-strong)]">
          primary
        </span>
      </div>
      <div className="mt-5 grid gap-3 text-sm sm:grid-cols-3">
        <Fact label="Provider" value={wallet.provider} />
        <Fact label="Chain" value={wallet.chain} />
        <Fact label="Payment proof" value="backend settlement only" />
      </div>
    </article>
  );
}

function WalletRow({ wallet }: { wallet: Wallet }) {
  return (
    <article className="rounded border border-[var(--line)] bg-[var(--panel)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{wallet.provider}</p>
          <p className="mt-1 truncate text-sm text-[var(--muted)]">{wallet.address}</p>
        </div>
        <span className="rounded bg-[var(--background)] px-2 py-1 text-xs text-[var(--muted)]">
          {wallet.isPrimary ? "primary" : "linked"}
        </span>
      </div>
    </article>
  );
}

function TransactionRow({ transaction }: { transaction: WalletTransaction }) {
  return (
    <article className="rounded border border-[var(--line)] bg-[var(--panel)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium">{transaction.direction}</p>
          <p className="mt-1 text-sm text-[var(--muted)]">{transaction.source}</p>
        </div>
        <span className="rounded bg-[var(--background)] px-2 py-1 text-xs text-[var(--muted)]">
          {transaction.state}
        </span>
      </div>
      <div className="mt-4 grid gap-2 text-sm">
        <Fact label="Amount" value={`${transaction.amountMinor.toLocaleString()} ${transaction.currency}`} />
        <Fact label="Signature" value={shorten(transaction.signature)} />
      </div>
    </article>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="rounded border border-[var(--line)] bg-[var(--panel)] p-4 text-sm text-[var(--muted)]">
      {label}
    </div>
  );
}

function UnavailableState({
  result,
  title
}: {
  result: ApiResult<WalletList> | ApiResult<WalletTransactionPage>;
  title: string;
}) {
  if (result.ok) {
    return null;
  }

  return (
    <div className="rounded border border-[var(--line)] bg-[var(--panel)] p-4">
      <p className="text-sm font-medium text-[var(--accent)]">HTTP {result.status}</p>
      <h2 className="mt-2 text-base font-semibold tracking-normal">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{result.message}</p>
    </div>
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
