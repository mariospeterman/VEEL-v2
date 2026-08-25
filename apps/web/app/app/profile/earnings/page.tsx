import { getMyCreatorDashboard, getMyCreatorMembershipOffer, getMyCreatorOnboarding, getWallets, queryAnalytics, type AnalyticsQueryRequest } from "@/api-client";
import { requireAppAccess } from "@/supabase/route-guard";
import { AppShell } from "../../../app-shell";
import { Card, ErrorState, Fact, PageHeader, StatusPill } from "../../../ui";
import { EarningsSetupForm } from "./earnings-setup-form";
import { MembershipOfferForm } from "./membership-offer-form";
import { AnalyticsSummary, analyticsWindow } from "../../analytics-summary";

export const dynamic = "force-dynamic";

export default async function EarningsSetupPage() {
  await requireAppAccess("/app/profile/earnings");
  const window = analyticsWindow(30);
  const comparisonWindow = analyticsWindow(30, 30);
  const creatorBaseQuery: AnalyticsQueryRequest = {
    scope: { type: "creator" },
    metricKeys: [
      "creator.content.qualified_views", "creator.content.watch_seconds", "creator.content.completion_rate",
      "creator.engagement.saves", "creator.engagement.shares", "creator.social.profile_opens",
      "creator.social.follow_conversion"
    ],
    window,
    comparisonWindow,
    granularity: "total",
    timezone: "UTC"
  };
  const creatorCommerceQuery = (currency: "SOL" | "USDC"): AnalyticsQueryRequest => ({
    scope: { type: "creator" },
    metricKeys: [
      "creator.commerce.offer_impressions", "creator.commerce.confirmed_purchases",
      "creator.commerce.unlock_conversion", "creator.commerce.confirmed_gross_minor",
      "creator.commerce.earnings_minor", "creator.membership.starts", "creator.membership.cancellations"
    ],
    window,
    comparisonWindow,
    granularity: "total",
    timezone: "UTC",
    dimensions: { currency }
  });
  const [dashboard, onboarding, wallets, membershipOffer, creatorAnalytics, solAnalytics, usdcAnalytics] = await Promise.all([
    getMyCreatorDashboard(),
    getMyCreatorOnboarding(),
    getWallets(),
    getMyCreatorMembershipOffer(),
    queryAnalytics(creatorBaseQuery),
    queryAnalytics(creatorCommerceQuery("SOL")),
    queryAnalytics(creatorCommerceQuery("USDC"))
  ]);

  return (
    <AppShell>
      <section className="mx-auto grid w-full max-w-3xl content-start gap-5">
        <PageHeader eyebrow="Profile / Earnings" title="Enable earnings">
          Set one noncustodial recipient wallet and complete only the checks currently required
          for creator-paid products.
        </PageHeader>

        <AnalyticsSummary
          description="Privacy-safe performance and confirmed commerce for the last 30 days, compared with the preceding 30 days. No viewer identities or private messages are analyzed."
          queries={[creatorAnalytics, solAnalytics, usdcAnalytics]}
          title="Creator analytics"
        />

        {onboarding.ok ? (
          <Card className="p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-sm font-semibold">Earnings readiness</h2>
                <p className="mt-1 text-sm text-(--muted)">
                  {onboarding.data.readinessScore}% complete
                </p>
              </div>
              <StatusPill tone={onboarding.data.canStartEarning ? "good" : "warn"}>
                {onboarding.data.canStartEarning ? "ready" : "setup"}
              </StatusPill>
            </div>
            <div className="mt-4 grid gap-2">
              {onboarding.data.steps.map((step) => (
                <a
                  className="flex min-h-12 items-center justify-between gap-3 rounded border border-(--line) bg-(--background) px-3 py-2 text-sm"
                  href={step.actionHref ?? "/app/profile/earnings"}
                  key={step.key}
                >
                  <span>
                    <span className="block font-medium">{step.label}</span>
                    <span className="text-xs text-(--muted)">
                      {step.required ? "Required now" : "Optional until needed"}
                    </span>
                  </span>
                  <StatusPill>{step.state}</StatusPill>
                </a>
              ))}
            </div>
          </Card>
        ) : (
          <ErrorState result={onboarding} title="Earnings setup unavailable" context="Earnings setup" />
        )}

        {dashboard.ok ? (
          <Card className="p-4">
            <h2 className="text-sm font-semibold">Current authority and product mix</h2>
            <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <Fact label="Earning state" value={dashboard.data.readiness.earningState} />
              <Fact label="Identity check" value={dashboard.data.readiness.kycState} />
              <Fact label="Tax profile" value={dashboard.data.readiness.taxProfileState} />
              <Fact label="Recipient wallet" value={dashboard.data.readiness.recipientWalletState} />
              {dashboard.data.products.map((product) => (
                <Fact
                  key={`${product.productType}-${product.currency}`}
                  label={`${product.productType} · ${product.currency}`}
                  value={`${product.confirmedPaymentCount} confirmed · ${product.enabled ? "enabled" : "disabled"}`}
                />
              ))}
            </div>
          </Card>
        ) : null}

        {dashboard.ok && onboarding.ok && wallets.ok ? (
          <EarningsSetupForm
            initialOnboarding={onboarding.data}
            wallets={wallets.data.items}
          />
        ) : !wallets.ok ? (
          <ErrorState result={wallets} title="Linked wallets unavailable" context="Earnings wallet" />
        ) : null}

        {onboarding.ok && onboarding.data.configuration.products.memberships ? (
          <MembershipOfferForm initialOffer={membershipOffer.ok ? membershipOffer.data : null} />
        ) : null}

        <Card className="p-4">
          <h2 className="text-sm font-semibold">Separate capabilities</h2>
          <p className="mt-2 text-sm leading-6 text-(--muted)">
            Earnings verification does not grant adult publishing. Performer consent is bound to
            each content revision. Enterprise management requires a separately accepted agreement.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <a className="rounded border border-(--line) px-3 py-2 text-sm" href="/app/create">
              Adult publishing setup
            </a>
            <a className="rounded border border-(--line) px-3 py-2 text-sm" href="/app/enterprise">
              Enterprise relationships
            </a>
          </div>
        </Card>
      </section>
    </AppShell>
  );
}
