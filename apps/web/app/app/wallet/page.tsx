import {
  getWallets,
  getWalletTransactionActivity,
  type Wallet,
  type WalletTransaction
} from "@/api-client";
import { requireConfiguredSession } from "@/supabase/route-guard";
import { formatAssetAmount } from "@/format-asset-amount";
import { AppShell } from "../../app-shell";
import { Card, EmptyState, ErrorState, Fact, PageHeader, StatusPill } from "../../ui";

export const dynamic = "force-dynamic";

export default async function WalletPage() {
  await requireConfiguredSession("/app/wallet");

  const [wallets, walletTransactions] = await Promise.all([getWallets(), getWalletTransactionActivity()]);
  const primaryWallet = wallets.ok
    ? (wallets.data.items.find((wallet) => wallet.isPrimary) ?? wallets.data.items[0] ?? null)
    : null;

  return (
    <AppShell>
      <PageHeader
        action={<StatusPill tone={primaryWallet ? "good" : "warn"}>{primaryWallet ? "Wallet linked" : "Connect wallet"}</StatusPill>}
        eyebrow="Wallet"
        title="Funding and receipts"
      >
        Non-custodial wallet state, linked wallets, funding handoff, and backend-issued receipts.
      </PageHeader>

      <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className="grid min-h-0 content-start gap-4 overflow-hidden">
          {wallets.ok ? (
            <>
              {primaryWallet ? (
                <PrimaryWalletCard wallet={primaryWallet} />
              ) : (
                <EmptyState
                  action={<a className="primary-button" href="/?mode=onboarding&step=wallet&next=%2Fapp%2Fwallet">Open wallet setup</a>}
                  title="No linked wallet yet"
                >
                  Wallet SDKs load only inside the explicit wallet setup flow.
                </EmptyState>
              )}

              <section className="grid gap-3">
                {wallets.data.items.map((wallet) => (
                  <WalletRow wallet={wallet} key={wallet.id} />
                ))}
              </section>
            </>
          ) : (
            <ErrorState result={wallets} title="Wallet state unavailable" context="Wallet" />
          )}
        </section>

        <aside className="grid min-h-0 content-start gap-4 overflow-hidden">
          <Card className="p-4">
            <p className="text-sm font-medium text-(--muted)">Top up</p>
            <h2 className="mt-1 text-lg font-semibold tracking-normal">User-owned wallet funding</h2>
            <p className="mt-3 text-sm leading-6 text-(--muted)">
              Funding sessions are created by the backend for a linked wallet only after explicit
              user action. Funding sessions do not unlock content, Event Access Passes, messages,
              memberships, or support.
            </p>
            {primaryWallet ? (
              <div className="mt-4 grid gap-2 text-sm">
                <Fact label="Destination" value={shorten(primaryWallet.address)} />
                <Fact label="Provider" value="server configured" />
                <Fact label="Access effect" value="none" />
              </div>
            ) : null}
          </Card>

          <section className="grid gap-3 overflow-hidden">
            <div className="border-b border-(--line) pb-3">
              <p className="text-sm font-medium text-(--muted)">Recent wallet transactions</p>
            </div>
            {walletTransactions.ok ? (
              walletTransactions.data.items.length > 0 ? (
                walletTransactions.data.items.map((transaction) => (
                  <TransactionRow transaction={transaction} key={transaction.id} />
                ))
              ) : (
                <EmptyState title="No wallet transactions yet">
                  Wallet movements appear after backend-visible wallet activity exists.
                </EmptyState>
              )
            ) : (
              <ErrorState result={walletTransactions} title="Wallet transactions unavailable" context="Wallet transactions" />
            )}
          </section>
        </aside>
      </section>
    </AppShell>
  );
}

function PrimaryWalletCard({ wallet }: { wallet: Wallet }) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm text-(--muted)">Primary wallet</p>
          <p className="mt-2 truncate text-xl font-semibold tracking-normal">{wallet.address}</p>
        </div>
        <StatusPill tone="good">primary</StatusPill>
      </div>
      <div className="mt-5 grid gap-3 text-sm sm:grid-cols-3">
        <Fact label="Provider" value={wallet.provider} />
        <Fact label="Chain" value={wallet.chain} />
        <Fact label="Payment proof" value="backend settlement only" />
      </div>
    </Card>
  );
}

function WalletRow({ wallet }: { wallet: Wallet }) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{wallet.provider}</p>
          <p className="mt-1 truncate text-sm text-(--muted)">{wallet.address}</p>
        </div>
        <StatusPill tone={wallet.isPrimary ? "good" : "neutral"}>{wallet.isPrimary ? "primary" : "linked"}</StatusPill>
      </div>
    </Card>
  );
}

function TransactionRow({ transaction }: { transaction: WalletTransaction }) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium">{transaction.direction}</p>
          <p className="mt-1 text-sm text-(--muted)">{transaction.source}</p>
        </div>
        <StatusPill>{transaction.state}</StatusPill>
      </div>
      <div className="mt-4 grid gap-2 text-sm">
        <Fact label="Amount" value={formatAssetAmount(transaction.amountMinor, transaction.currency)} />
        <Fact label="Signature" value={shorten(transaction.signature)} />
      </div>
    </Card>
  );
}

function shorten(value: string | null | undefined) {
  if (!value) {
    return "none";
  }

  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}
