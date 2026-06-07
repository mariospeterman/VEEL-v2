import { appShellNavItems } from "@veel/ui";
import {
  getSubscriptionPlans,
  getSubscriptions,
  type ApiResult,
  type Subscription,
  type SubscriptionPage,
  type SubscriptionPlan,
  type SubscriptionPlanPage
} from "@/api-client";
import { requireConfiguredSession } from "@/supabase/route-guard";

export const dynamic = "force-dynamic";

export default async function SubscriptionsPage() {
  await requireConfiguredSession("/subscriptions");

  const [plans, subscriptions] = await Promise.all([
    getSubscriptionPlans(),
    getSubscriptions()
  ]);
  const currentSubscription = subscriptions.ok ? (subscriptions.data.items[0] ?? null) : null;

  return (
    <main className="min-h-screen bg-(--background) text-(--foreground)">
      <AppNav />

      <section className="mx-auto grid w-full max-w-6xl gap-6 px-5 py-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="grid content-start gap-5">
          <div>
            <p className="text-sm font-medium text-(--accent)">Subscriptions</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-normal">Auto-renewing access</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-(--muted)">
              Delegated Solana subscriptions authorize bounded USDC collection once, then renew
              through backend collection until cancelled in Veel or revoked in the wallet.
            </p>
          </div>

          <section className="grid gap-3">
            <h2 className="text-base font-semibold tracking-normal">Plans</h2>
            {plans.ok ? (
              plans.data.items.length > 0 ? (
                plans.data.items.map((plan) => <PlanRow plan={plan} key={plan.id} />)
              ) : (
                <EmptyState label="No subscription plans are available" />
              )
            ) : (
              <UnavailableState result={plans} title="Subscription plans unavailable" />
            )}
          </section>
        </section>

        <aside className="grid content-start gap-3">
          <section className="rounded border border-(--line) bg-(--panel) p-4">
            <p className="text-sm font-medium">Current subscription</p>
            {subscriptions.ok ? (
              currentSubscription ? (
                <SubscriptionSummary subscription={currentSubscription} />
              ) : (
                <EmptyState label="No active or pending subscriptions" />
              )
            ) : (
              <UnavailableState result={subscriptions} title="Subscriptions unavailable" />
            )}
          </section>

          <section className="rounded border border-(--line) bg-(--panel) p-4">
            <p className="text-sm font-medium">Recovery path</p>
            <p className="mt-3 text-sm leading-6 text-(--muted)">
              Manual Solana Pay renewal is reserved for failed delegated setup or collection. It is
              not the normal product path and does not replace backend settlement verification.
            </p>
          </section>
        </aside>
      </section>
    </main>
  );
}

function SubscriptionSummary({ subscription }: { subscription: Subscription }) {
  return (
    <div className="mt-4 grid gap-3 text-sm">
      <Fact label="State" value={subscription.state} />
      <Fact label="Renewal" value={subscription.renewalMode} />
      <Fact label="Next collection" value={subscription.nextCollectionAt ?? "pending authorization"} />
      <Fact label="Authority" value={subscription.authorityAddress ?? "not verified"} />
    </div>
  );
}

function PlanRow({ plan }: { plan: SubscriptionPlan }) {
  return (
    <article className="rounded border border-(--line) bg-(--panel) p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-medium">{plan.label}</p>
          <p className="mt-1 text-sm text-(--muted)">
            {formatAmount(plan.amountMinor, plan.currency)} every {plan.periodDays} days
          </p>
        </div>
        <span className="rounded bg-(--background) px-2 py-1 text-xs text-(--muted)">
          {plan.providerState}
        </span>
      </div>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
        <Fact label="Billing" value={plan.billingMode} />
        <Fact label="Token" value={plan.tokenProgram ?? "unconfigured"} />
        <Fact label="Mint" value={plan.tokenMint ?? "unconfigured"} />
      </dl>
    </article>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="rounded border border-(--line) bg-(--background) p-4 text-sm text-(--muted)">
      {label}
    </div>
  );
}

function UnavailableState({
  result,
  title
}: {
  result: ApiResult<SubscriptionPage> | ApiResult<SubscriptionPlanPage>;
  title: string;
}) {
  if (result.ok) {
    return null;
  }

  return (
    <div className="mt-4 rounded border border-(--line) bg-(--background) p-4">
      <p className="text-sm font-medium text-(--accent)">HTTP {result.status}</p>
      <h2 className="mt-2 text-base font-semibold tracking-normal">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-(--muted)">{result.message}</p>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase text-(--muted)">{label}</dt>
      <dd className="mt-1 break-words font-medium">{value}</dd>
    </div>
  );
}

function AppNav() {
  return (
    <nav className="mx-auto flex w-full max-w-6xl items-center justify-between border-b border-(--line) px-5 py-4">
      <a className="text-lg font-semibold tracking-normal" href="/">
        VEEL
      </a>
      <div className="flex flex-wrap justify-end gap-1">
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
  );
}

function formatAmount(amountMinor: number, currency: string) {
  return `${(amountMinor / 1_000_000).toLocaleString()} ${currency}`;
}
