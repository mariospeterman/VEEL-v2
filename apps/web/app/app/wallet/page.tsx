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
        Your wallet. Your funds. WeVid verifies every payment before granting access.
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
                  Set up a wallet when you’re ready to fund purchases or receive creator earnings.
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
              Add funds to your own linked wallet. Funding alone does not unlock content, Event Access,
              memberships, or any social feature.
            </p>
            {primaryWallet ? (
              <div className="mt-4 grid gap-2 text-sm">
                <Fact label="Destination" value={shorten(primaryWallet.address)} />
                <Fact label="Control" value="You" />
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
                  Confirmed wallet activity will appear here.
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
        <Fact label="Network" value={networkLabel(wallet.chain)} />
        <Fact label="Control" value="You" />
        <Fact label="Purchases" value="Access after confirmation" />
      </div>
    </Card>
  );
}

function WalletRow({ wallet }: { wallet: Wallet }) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{wallet.isPrimary ? "Primary wallet" : "Linked wallet"}</p>
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
          <p className="font-medium">{directionLabel(transaction.direction)}</p>
          <p className="mt-1 text-sm text-(--muted)">Wallet activity</p>
        </div>
        <StatusPill>{transactionStateLabel(transaction.state)}</StatusPill>
      </div>
      <div className="mt-4 grid gap-2 text-sm">
        <Fact label="Amount" value={formatAssetAmount(transaction.amountMinor, transaction.currency)} />
        <Fact label="Signature" value={shorten(transaction.signature)} />
      </div>
    </Card>
  );
}

function networkLabel(chain: string) {
  return chain.toLowerCase().includes("solana") ? "Solana" : "Connected network";
}

function directionLabel(direction: string) {
  if (direction === "inbound" || direction === "received") return "Received";
  if (direction === "outbound" || direction === "sent") return "Sent";
  return "Transaction";
}

function transactionStateLabel(state: string) {
  if (state === "confirmed" || state === "finalized") return "Confirmed";
  if (state === "failed" || state === "rejected") return "Needs attention";
  return "Pending";
}

function shorten(value: string | null | undefined) {
  if (!value) {
    return "none";
  }

  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}
