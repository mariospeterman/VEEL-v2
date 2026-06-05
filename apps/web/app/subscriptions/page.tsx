import type { components } from "@veel/contracts";
import { appShellNavItems } from "@veel/ui";

type SubscriptionPlan = components["schemas"]["SubscriptionPlan"];
type Subscription = components["schemas"]["Subscription"];

const plans: SubscriptionPlan[] = [
  {
    id: "platform_plus_monthly",
    scope: "platform",
    label: "Veel Plus",
    amountMinor: 15000000,
    currency: "USDC",
    periodDays: 30,
    billingMode: "delegated_solana_subscription",
    providerState: "staging_required",
    tokenMint: "USDC_MINT_CONFIG_REQUIRED",
    tokenProgram: "spl_token"
  },
  {
    id: "platform_studio_monthly",
    scope: "platform",
    label: "Veel Studio",
    amountMinor: 29000000,
    currency: "USDC",
    periodDays: 30,
    billingMode: "delegated_solana_subscription",
    providerState: "staging_required",
    tokenMint: "USDC_MINT_CONFIG_REQUIRED",
    tokenProgram: "spl_token"
  }
];

const subscription: Subscription = {
  id: "00000000-0000-4000-8000-000000000070",
  scope: "platform",
  planId: "platform_plus_monthly",
  state: "authorization_pending",
  renewalMode: "delegated_solana_subscription",
  currentPeriodEndsAt: null,
  nextCollectionAt: null,
  cancelledAt: null,
  revokedAt: null,
  authorityAddress: null,
  delegationAddress: null
};

export default function SubscriptionsPage() {
  return (
    <main className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <AppNav />

      <section className="mx-auto grid w-full max-w-6xl gap-6 px-5 py-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="grid content-start gap-5">
          <div>
            <p className="text-sm font-medium text-[var(--accent)]">Subscriptions</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-normal">Auto-renewing access</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">
              Delegated Solana subscriptions authorize bounded USDC collection once, then renew
              through backend collection until cancelled in Veel or revoked in the wallet.
            </p>
          </div>

          <section className="grid gap-3">
            <h2 className="text-base font-semibold tracking-normal">Plans</h2>
            {plans.map((plan) => (
              <PlanRow plan={plan} key={plan.id} />
            ))}
          </section>
        </section>

        <aside className="grid content-start gap-3">
          <section className="rounded border border-[var(--line)] bg-[var(--panel)] p-4">
            <p className="text-sm font-medium">Current subscription</p>
            <div className="mt-4 grid gap-3 text-sm">
              <Fact label="State" value={subscription.state} />
              <Fact label="Renewal" value={subscription.renewalMode} />
              <Fact label="Next collection" value={subscription.nextCollectionAt ?? "pending authorization"} />
              <Fact label="Authority" value={subscription.authorityAddress ?? "not verified"} />
            </div>
          </section>

          <section className="rounded border border-[var(--line)] bg-[var(--panel)] p-4">
            <p className="text-sm font-medium">Recovery path</p>
            <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
              Manual Solana Pay renewal is reserved for failed delegated setup or collection. It is
              not the normal product path and does not replace backend settlement verification.
            </p>
          </section>
        </aside>
      </section>
    </main>
  );
}

function PlanRow({ plan }: { plan: SubscriptionPlan }) {
  return (
    <article className="rounded border border-[var(--line)] bg-[var(--panel)] p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-medium">{plan.label}</p>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {formatAmount(plan.amountMinor, plan.currency)} every {plan.periodDays} days
          </p>
        </div>
        <span className="rounded bg-[var(--background)] px-2 py-1 text-xs text-[var(--muted)]">
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

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase text-[var(--muted)]">{label}</dt>
      <dd className="mt-1 break-words font-medium">{value}</dd>
    </div>
  );
}

function AppNav() {
  return (
    <nav className="mx-auto flex w-full max-w-6xl items-center justify-between border-b border-[var(--line)] px-5 py-4">
      <a className="text-lg font-semibold tracking-normal" href="/">
        VEEL
      </a>
      <div className="flex flex-wrap justify-end gap-1">
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
  );
}

function formatAmount(amountMinor: number, currency: string) {
  return `${(amountMinor / 1_000_000).toLocaleString()} ${currency}`;
}
