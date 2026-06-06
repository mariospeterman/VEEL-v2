import type { components } from "@veel/contracts";
import { appShellNavItems } from "@veel/ui";

type Wallet = components["schemas"]["Wallet"];
type OnrampSession = components["schemas"]["OnrampSession"];
type WalletTransaction = components["schemas"]["WalletTransaction"];

const wallets: Wallet[] = [
  {
    id: "00000000-0000-4000-8000-000000000020",
    chain: "solana_devnet",
    address: "VeelWallet111111111111111111111111111111111",
    provider: "embedded_privy",
    isPrimary: true
  },
  {
    id: "00000000-0000-4000-8000-000000000021",
    chain: "solana_devnet",
    address: "ExternalWallet2222222222222222222222222222",
    provider: "phantom",
    isPrimary: false
  }
];

const fundingSession: OnrampSession = {
  id: "00000000-0000-4000-8000-000000000070",
  provider: "coinbase",
  launchUrl: "https://pay.coinbase.com/buy",
  walletId: "00000000-0000-4000-8000-000000000020",
  walletAddress: wallets[0]?.address ?? "",
  state: "created",
  createdAt: "2026-06-06T00:00:00.000Z",
  expiresAt: null
};

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
    walletId: "00000000-0000-4000-8000-000000000020",
    signature: "5".repeat(88),
    referenceAddress: "11111111111111111111111111111112",
    createdAt: "2026-06-04T20:00:00.000Z",
    submittedAt: "2026-06-04T20:00:00.000Z",
    confirmedAt: "2026-06-04T20:01:00.000Z"
  }
];

export default function WalletPage() {
  const primaryWallet = wallets.find((wallet) => wallet.isPrimary) ?? wallets[0];

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

          {primaryWallet ? <PrimaryWalletCard wallet={primaryWallet} /> : null}

          <section className="grid gap-3">
            {wallets.map((wallet) => (
              <WalletRow wallet={wallet} key={wallet.id} />
            ))}
          </section>
        </section>

        <aside className="grid min-h-0 content-start gap-4 overflow-hidden">
          <section className="rounded border border-[var(--line)] bg-[var(--panel)] p-4">
            <p className="text-sm font-medium text-[var(--muted)]">Top up</p>
            <h2 className="mt-1 text-lg font-semibold tracking-normal">User-owned wallet funding</h2>
            <div className="mt-4 grid gap-2 text-sm">
              <Fact label="Provider" value={fundingSession.provider} />
              <Fact label="Session state" value={fundingSession.state} />
              <Fact label="Destination" value={shorten(fundingSession.walletAddress)} />
            </div>
            <a
              className="mt-4 inline-flex w-full items-center justify-center rounded bg-[var(--accent-soft)] px-3 py-3 text-sm font-semibold text-[var(--accent-strong)]"
              href={fundingSession.launchUrl}
            >
              Open funding session
            </a>
            <p className="mt-3 text-xs leading-5 text-[var(--muted)]">
              Funding sessions do not unlock content, tickets, messages, memberships, or support.
            </p>
          </section>

          <section className="grid gap-3 overflow-hidden">
            <div className="border-b border-[var(--line)] pb-3">
              <p className="text-sm font-medium text-[var(--muted)]">Recent wallet transactions</p>
            </div>
            {walletTransactions.map((transaction) => (
              <TransactionRow transaction={transaction} key={transaction.id} />
            ))}
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
