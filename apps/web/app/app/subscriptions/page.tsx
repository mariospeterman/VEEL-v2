import {
  getPlatformAccess,
  getSubscriptionPlans,
  getSubscriptions,
  type PlatformAccess,
  type Subscription,
  type SubscriptionPlan
} from "@/api-client";
import { requireAppAccess } from "@/supabase/route-guard";
import { formatTwoDecimalMinorAmount } from "@/format-asset-amount";
import { AppShell } from "../../app-shell";
import { Card, EmptyState, ErrorState, Fact, PageHeader, StatusPill } from "../../ui";
import { SubscriptionAuthorizationPanel } from "../../subscriptions/subscription-authorization-panel";
import { SubscriptionCancelPanel } from "../../subscriptions/subscription-cancel-panel";

export const dynamic = "force-dynamic";

export default async function SubscriptionsPage() {
  await requireAppAccess("/app/subscriptions");

  const [platformAccess, plans, subscriptions, subscriptionHistory] = await Promise.all([
    getPlatformAccess(),
    getSubscriptionPlans(),
    getSubscriptions(),
    getSubscriptions({ view: "history" })
  ]);
  const platformPlans = plans.ok ? plans.data.items.filter((plan) => plan.scope === "platform") : [];
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
            Choose a WeVid plan or manage memberships you joined from creator profiles.
          </PageHeader>

          <section className="grid gap-3" id="platform-plans">
            <h2 className="text-base font-semibold tracking-normal">Platform plans</h2>
            {platformAccess.ok ? (
              <PlatformTierGrid access={platformAccess.data} plans={platformPlans} />
            ) : (
              <ErrorState result={platformAccess} title="Platform plans unavailable" context="Platform access" />
            )}
          </section>

          <section className="grid gap-3">
            <h2 className="text-base font-semibold tracking-normal">Creator memberships</h2>
            <EmptyState title="Memberships start on creator profiles">
              Find a creator and review their current offer before joining. {" "}
              <a className="font-semibold underline" href="/app/search">Find creators</a>
            </EmptyState>
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
                  Joined creator memberships will appear here after activation.
                </EmptyState>
              )
            ) : (
              <ErrorState result={subscriptions} title="Subscriptions unavailable" context="Subscriptions" />
            )}
          </Card>

          <Card className="p-4">
            <p className="text-sm font-medium">Subscription history</p>
            {subscriptionHistory.ok ? (
              subscriptionHistory.data.items.length > 0 ? (
                subscriptionHistory.data.items.map((subscription) => (
                  <SubscriptionSummary subscription={subscription} key={subscription.id} />
                ))
              ) : (
                <p className="mt-3 text-sm text-(--muted)">No cancelled or interrupted subscriptions.</p>
              )
            ) : (
              <ErrorState
                result={subscriptionHistory}
                title="Subscription history unavailable"
                context="Subscription history"
              />
            )}
          </Card>

          <Card className="p-4">
            <p className="text-sm font-medium">Payment protection</p>
            <p className="mt-3 text-sm leading-6 text-(--muted)">
              Your wallet limits every automatic payment to the displayed price and billing period.
              Access starts only after payment is confirmed.
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
      <Fact label="Status" value={friendlyState(subscription.state)} />
      <Fact label="Renewal" value="Automatic" />
      <Fact label="Next collection" value={subscription.nextCollectionAt ?? "pending authorization"} />
      {subscription.failureReason ? (
        <>
          <Fact label="Action needed" value={failureGuidance(subscription.failureReason)} />
          <a className="secondary-button w-fit" href={failureActionHref(subscription)}>
            {failureActionLabel(subscription.failureReason)}
          </a>
        </>
      ) : null}
      <SubscriptionCancelPanel subscription={subscription} />
    </div>
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
                      : `${formatTwoDecimalMinorAmount(tier.monthlyPriceMinor, tier.currency ?? "USDC")} / month`}
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

function friendlyState(state: Subscription["state"]) {
  if (state === "active") return "Active";
  if (state === "authorization_pending") return "Waiting for wallet";
  if (state === "renewal_pending") return "Confirming payment";
  if (state === "grace_period") return "Payment needs attention";
  return state.charAt(0).toUpperCase() + state.slice(1).replaceAll("_", " ");
}

function failureGuidance(reason: NonNullable<Subscription["failureReason"]>) {
  if (reason === "insufficient_funds") return "Add funds; WeVid will retry the bounded collection.";
  if (reason === "authorization_revoked") return "Reconnect wallet authorization from the plan page.";
  if (reason === "provider_unavailable") return "Provider temporarily unavailable; retry later.";
  return "Wallet setup no longer matches this plan; review and reconnect authorization.";
}

function failureActionHref(subscription: Subscription) {
  if (subscription.failureReason === "insufficient_funds") return "/app/wallet";
  if (subscription.failureReason === "provider_unavailable") return "/app/subscriptions";
  return subscription.creator?.handle
    ? `/profile/${encodeURIComponent(subscription.creator.handle)}`
    : "/app/subscriptions#platform-plans";
}

function failureActionLabel(reason: NonNullable<Subscription["failureReason"]>) {
  if (reason === "insufficient_funds") return "Open wallet";
  if (reason === "provider_unavailable") return "Retry status";
  return "Reconnect authorization";
}
