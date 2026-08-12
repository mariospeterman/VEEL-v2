import {
  getPlatformAccess,
  getSubscriptionPlans,
  getSubscriptions,
  type PlatformAccess,
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

  const [platformAccess, plans, subscriptions] = await Promise.all([
    getPlatformAccess(),
    getSubscriptionPlans(),
    getSubscriptions()
  ]);
  const platformPlans = plans.ok ? plans.data.items.filter((plan) => plan.scope === "platform") : [];
  const creatorPlans = plans.ok ? plans.data.items.filter((plan) => plan.scope === "creator") : [];
  const platformSubscriptions = subscriptions.ok
    ? subscriptions.data.items.filter((subscription) => subscription.scope === "platform")
    : [];
  const creatorMemberships = subscriptions.ok
    ? subscriptions.data.items.filter((subscription) => subscription.scope === "creator")
    : [];

  return (
    <AppShell>
      <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="grid content-start gap-5">
          <PageHeader eyebrow="Plans" title="Your WeVid access">
            Choose platform tools separately from memberships you join with individual profiles.
          </PageHeader>

          <section className="grid gap-3">
            <h2 className="text-base font-semibold tracking-normal">Platform plans</h2>
            {platformAccess.ok ? (
              <PlatformTierGrid access={platformAccess.data} plans={platformPlans} />
            ) : (
              <ErrorState result={platformAccess} title="Platform plans unavailable" context="Platform access" />
            )}
          </section>

          <section className="grid gap-3">
            <h2 className="text-base font-semibold tracking-normal">Creator memberships</h2>
            {plans.ok ? (
              creatorPlans.length > 0 ? (
                creatorPlans.map((plan) => <PlanRow plan={plan} key={plan.id} />)
              ) : (
                <EmptyState title="No creator memberships available">
                  Membership offers appear when profiles enable a launch-ready recurring plan.
                </EmptyState>
              )
            ) : (
              <ErrorState result={plans} title="Subscription plans unavailable" context="Subscription plans" />
            )}
          </section>
        </section>

        <aside className="grid content-start gap-3">
          <Card className="p-4">
            <p className="text-sm font-medium">Platform access</p>
            {platformAccess.ok ? (
              <div className="mt-4 grid gap-3 text-sm">
                <Fact label="Current tier" value={platformAccess.data.currentTier.label} />
                <Fact
                  label="Public media used"
                  value={formatUsage(platformAccess.data)}
                />
                {platformSubscriptions.map((subscription) => (
                  <SubscriptionSummary subscription={subscription} key={subscription.id} />
                ))}
              </div>
            ) : (
              <ErrorState result={platformAccess} title="Platform access unavailable" context="Platform access" />
            )}
          </Card>

          <Card className="p-4">
            <p className="text-sm font-medium">Joined memberships</p>
            {subscriptions.ok ? (
              creatorMemberships.length > 0 ? (
                creatorMemberships.map((subscription) => (
                  <SubscriptionSummary subscription={subscription} key={subscription.id} />
                ))
              ) : (
                <EmptyState title="No joined memberships">
                  Profile membership access appears here after backend-verified activation.
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
      <SubscriptionAuthorizationPanel plan={plan} />
    </Card>
  );
}

function PlatformTierGrid({
  access,
  plans
}: {
  access: PlatformAccess;
  plans: SubscriptionPlan[];
}) {
  const plansById = new Map(plans.map((plan) => [plan.id, plan]));

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {access.tiers.map((tier) => {
        const plan = tier.subscriptionPlanId ? plansById.get(tier.subscriptionPlanId) : undefined;
        return (
          <Card className="p-4" key={tier.key}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium">{tier.label}</p>
                <p className="mt-1 text-sm text-(--muted)">
                  {tier.monthlyPriceMinor === null
                    ? "Custom contract"
                    : tier.monthlyPriceMinor === 0
                      ? "Included"
                      : `${formatAssetAmount(tier.monthlyPriceMinor, tier.currency ?? "USDC")} / month`}
                </p>
              </div>
              <StatusPill tone={tier.key === access.currentTier.key ? "good" : "neutral"}>
                {tier.key === access.currentTier.key ? "Current" : tier.purchaseState.replaceAll("_", " ")}
              </StatusPill>
            </div>
            <p className="mt-3 text-sm text-(--muted)">
              {tier.publicMediaAllowanceSeconds === null
                ? "Custom public-media allowance"
                : `${formatHours(tier.publicMediaAllowanceSeconds)} public-media hours per month`}
            </p>
            {plan ? <SubscriptionAuthorizationPanel plan={plan} /> : null}
          </Card>
        );
      })}
    </div>
  );
}

function formatHours(seconds: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(seconds / 3_600);
}

function formatUsage(access: PlatformAccess) {
  const used = formatHours(access.usage.publicMediaSeconds);
  const allowance = access.currentTier.publicMediaAllowanceSeconds;
  return allowance === null ? `${used} hours` : `${used} of ${formatHours(allowance)} hours`;
}
