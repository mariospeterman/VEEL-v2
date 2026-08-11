import {
  getSubscriptionPlans,
  getSubscriptions,
  type Subscription,
  type SubscriptionPlan
} from "@/api-client";
import { requireAppAccess } from "@/supabase/route-guard";
import { formatAssetAmount } from "@/format-asset-amount";
import { AppShell } from "../../app-shell";
import { Card, EmptyState, ErrorState, Fact, PageHeader, StatusPill } from "../../ui";
import { SubscriptionAuthorizationPanel } from "../../subscriptions/subscription-authorization-panel";
import { SubscriptionCancelPanel } from "../../subscriptions/subscription-cancel-panel";

export const dynamic = "force-dynamic";

export default async function SubscriptionsPage() {
  await requireAppAccess("/app/subscriptions");

  const [plans, subscriptions] = await Promise.all([
    getSubscriptionPlans(),
    getSubscriptions()
  ]);
  const currentSubscription = subscriptions.ok ? (subscriptions.data.items[0] ?? null) : null;

  return (
    <AppShell>
      <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="grid content-start gap-5">
          <PageHeader eyebrow="Subscriptions" title="Auto-renewing access">
              Token-based Solana subscriptions authorize bounded collection once, then renew through
              backend-verified collection only when the provider is configured.
          </PageHeader>

          <section className="grid gap-3">
            <h2 className="text-base font-semibold tracking-normal">Plans</h2>
            {plans.ok ? (
              plans.data.items.length > 0 ? (
                plans.data.items.map((plan) => <PlanRow plan={plan} key={plan.id} />)
              ) : (
                <EmptyState title="No subscription plans are available">
                  Platform plans and creator memberships appear after the backend exposes launch-approved plans.
                </EmptyState>
              )
            ) : (
              <ErrorState result={plans} title="Subscription plans unavailable" context="Subscription plans" />
            )}
          </section>
        </section>

        <aside className="grid content-start gap-3">
          <Card className="p-4">
            <p className="text-sm font-medium">Current subscription</p>
            {subscriptions.ok ? (
              currentSubscription ? (
                <SubscriptionSummary subscription={currentSubscription} />
              ) : (
                <EmptyState title="No active or pending subscriptions">
                  Subscription access appears here after backend verification.
                </EmptyState>
              )
            ) : (
              <ErrorState result={subscriptions} title="Subscriptions unavailable" context="Subscriptions" />
            )}
          </Card>

          <Card className="p-4">
            <p className="text-sm font-medium">Recovery path</p>
            <p className="mt-3 text-sm leading-6 text-(--muted)">
              Manual Solana Pay renewal is reserved for failed delegated setup or collection. It is
              not the normal product path and does not replace backend settlement verification.
            </p>
          </Card>
        </aside>
      </section>
    </AppShell>
  );
}

function SubscriptionSummary({ subscription }: { subscription: Subscription }) {
  return (
    <div className="mt-4 grid gap-3 text-sm">
      <Fact label="State" value={subscription.state} />
      <Fact label="Renewal" value={subscription.renewalMode} />
      <Fact label="Next collection" value={subscription.nextCollectionAt ?? "pending authorization"} />
      <Fact label="Authority" value={subscription.authorityAddress ?? "not verified"} />
      <SubscriptionCancelPanel subscription={subscription} />
    </div>
  );
}

function PlanRow({ plan }: { plan: SubscriptionPlan }) {
  return (
    <Card className="p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-medium">{plan.label}</p>
          <p className="mt-1 text-sm text-(--muted)">
            {formatAssetAmount(plan.amountMinor, plan.currency)} every {plan.periodDays} days
          </p>
        </div>
        <StatusPill tone={plan.providerState === "launch_approved" ? "good" : "warn"}>{plan.providerState}</StatusPill>
      </div>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
        <Fact label="Billing" value={plan.billingMode} />
        <Fact label="Token" value={plan.tokenProgram ?? "unconfigured"} />
        <Fact label="Mint" value={plan.tokenMint ?? "unconfigured"} />
      </dl>
      <SubscriptionAuthorizationPanel plan={plan} />
    </Card>
  );
}
