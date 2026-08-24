import {
  getPaymentActivity,
  queryAnalytics,
  getWalletTransactionActivity,
  type ActivityItem,
  type WalletTransaction
} from "@/api-client";
import { RefundRequestPanel } from "../../activity/refund-request-panel";
import { requireAppAccess } from "@/supabase/route-guard";
import { formatAssetAmount } from "@/format-asset-amount";
import { AppShell } from "../../app-shell";
import { Card, EmptyState, ErrorState, Fact, PageHeader, StatusPill } from "../../ui";
import { AnalyticsSummary, analyticsWindow } from "../analytics-summary";

export const dynamic = "force-dynamic";

export default async function ActivityPage() {
  await requireAppAccess("/app/activity");

  const [paymentActivity, walletTransactions, viewerAnalytics] = await Promise.all([
    getPaymentActivity(),
    getWalletTransactionActivity(),
    queryAnalytics({
      scope: { type: "viewer" },
      metricKeys: [
        "viewer.content.qualified_views", "viewer.content.watch_seconds", "viewer.content.completion_rate",
        "viewer.engagement.saves", "viewer.engagement.shares", "viewer.lifecycle.return_sessions"
      ],
      window: analyticsWindow(30),
      comparisonWindow: analyticsWindow(30, 30),
      granularity: "total",
      timezone: "UTC"
    })
  ]);

  return (
    <AppShell>
      <PageHeader eyebrow="Activity" title="Payments and receipts">
        Track purchases, receipts, wallet activity, and requests that need your attention.
      </PageHeader>

      <div className="mt-5">
        <AnalyticsSummary
          description="A restrained summary of your own credited activity. WeVid does not expose a surveillance-style viewing history."
          queries={[viewerAnalytics]}
          title="Your last 30 days"
        />
      </div>

      <section className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className="grid content-start gap-4">
          <div className="grid gap-3">
            {paymentActivity.ok ? (
              paymentActivity.data.items.length > 0 ? (
                paymentActivity.data.items.map((item) => <ActivityRow item={item} key={item.id} />)
              ) : (
                <EmptyState title="No payment activity yet">
                  Receipts and support review options appear after a payment is confirmed.
                </EmptyState>
              )
            ) : (
              <ErrorState result={paymentActivity} title="Payment activity unavailable" context="Payment activity" />
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
              <EmptyState title="No wallet transactions yet">
                Confirmed wallet activity will appear here.
              </EmptyState>
            )
          ) : (
            <ErrorState result={walletTransactions} title="Wallet transactions unavailable" context="Wallet transactions" />
          )}
        </aside>
      </section>
    </AppShell>
  );
}

function ActivityRow({ item }: { item: ActivityItem }) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="font-medium">{item.title}</p>
          <p className="mt-1 text-sm text-(--muted)">{friendlyLabel(item.productType ?? "payment")}</p>
        </div>
        <StatusPill>{friendlyLabel(item.state)}</StatusPill>
      </div>
      <div className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
        <Fact
          label="Amount"
          value={formatAssetAmount(item.amountMinor ?? 0, item.currency ?? "SOL")}
        />
        <Fact label="Kind" value={friendlyLabel(item.kind)} />
        <Fact label="Reference" value={shorten(item.referenceAddress)} />
        <Fact label="Receipt" value={item.receiptNumber ?? "pending"} />
        <Fact label="In-app confirmation" value={friendlyLabel(item.inAppConfirmationState ?? "pending")} />
        <Fact label="Email confirmation" value={friendlyLabel(item.emailConfirmationState ?? "pending")} />
        <Fact label="Withdrawal" value={withdrawalLabel(item.withdrawalRightStatus)} />
        <Fact label="Review" value={item.latestRefundRequestState ? friendlyLabel(item.latestRefundRequestState) : "Available if there’s a problem"} />
      </div>
      {item.paymentIntentId && item.supportReviewAvailable ? (
        <RefundRequestPanel
          latestRefundRequestState={item.latestRefundRequestState}
          paymentIntentId={item.paymentIntentId}
        />
      ) : null}
    </Card>
  );
}

function WalletTransactionCard({ transaction }: { transaction: WalletTransaction }) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium">{directionLabel(transaction.direction)}</p>
          <p className="mt-1 text-sm text-(--muted)">Solana wallet</p>
        </div>
        <StatusPill>{friendlyLabel(transaction.state)}</StatusPill>
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

function friendlyLabel(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function directionLabel(direction: string) {
  if (direction === "inbound" || direction === "received") return "Received";
  if (direction === "outbound" || direction === "sent") return "Sent";
  return "Transaction";
}

function withdrawalLabel(status: ActivityItem["withdrawalRightStatus"] | undefined | null) {
  switch (status) {
    case "waived_after_immediate_access":
      return "ended after access";
    case "review_required":
      return "review required";
    case "not_applicable":
    default:
      return "not applicable";
  }
}
