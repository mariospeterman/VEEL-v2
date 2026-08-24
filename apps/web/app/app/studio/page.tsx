import {
  getMyContent,
  getMyCreatorDashboard,
  getMyCreatorOnboarding,
  getPlatformAccess,
  queryAnalytics,
  type AnalyticsQueryRequest
} from "@/api-client";
import { formatAssetAmount } from "@/format-asset-amount";
import { requireAppAccess } from "@/supabase/route-guard";
import type { Route } from "next";
import { redirect } from "next/navigation";
import { AppShell } from "../../app-shell";
import { Card, ErrorState, Fact, MetricCard, PageHeader, StatusPill } from "../../ui";
import { AnalyticsSummary, analyticsWindow } from "../analytics-summary";
import { ProfileMediaWorkspace } from "../profile/profile-media-workspace";

export const dynamic = "force-dynamic";

export default async function StudioPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  if (params.organizationId || params.relationshipId || params.workspace === "enterprise") {
    const enterpriseParams = new URLSearchParams();
    for (const key of ["organizationId", "relationshipId"]) {
      const value = params[key];
      if (typeof value === "string") enterpriseParams.set(key, value);
    }
    redirect(`/app/enterprise${enterpriseParams.size > 0 ? `?${enterpriseParams}` : ""}` as Route);
  }
  await requireAppAccess("/app/studio");
  const window = analyticsWindow(30);
  const comparisonWindow = analyticsWindow(30, 30);
  const creatorQuery: AnalyticsQueryRequest = {
    scope: { type: "creator" },
    metricKeys: [
      "creator.content.qualified_views",
      "creator.content.watch_seconds",
      "creator.content.completion_rate",
      "creator.engagement.saves",
      "creator.engagement.shares",
      "creator.social.profile_opens",
      "creator.social.follow_conversion"
    ],
    window,
    comparisonWindow,
    granularity: "total",
    timezone: "UTC"
  };
  const commerceQuery = (currency: "SOL" | "USDC"): AnalyticsQueryRequest => ({
    scope: { type: "creator" },
    metricKeys: [
      "creator.commerce.offer_impressions",
      "creator.commerce.confirmed_purchases",
      "creator.commerce.unlock_conversion",
      "creator.commerce.confirmed_gross_minor",
      "creator.commerce.earnings_minor",
      "creator.membership.starts",
      "creator.membership.cancellations"
    ],
    window,
    comparisonWindow,
    granularity: "total",
    timezone: "UTC",
    dimensions: { currency }
  });
  const [access, dashboard, onboarding, media, creatorAnalytics, solAnalytics, usdcAnalytics] = await Promise.all([
    getPlatformAccess(),
    getMyCreatorDashboard(),
    getMyCreatorOnboarding(),
    getMyContent(),
    queryAnalytics(creatorQuery),
    queryAnalytics(commerceQuery("SOL")),
    queryAnalytics(commerceQuery("USDC"))
  ]);
  const capabilities = access.ok ? new Set(access.data.currentTier.capabilities) : new Set<string>();
  const hasStudio = capabilities.has("advanced_analytics");

  return (
    <AppShell>
      <section className="grid content-start gap-5">
        <PageHeader
          action={<a className="rounded-lg bg-(--foreground) px-4 py-2 text-sm font-semibold text-(--background)" href="/app/create">Create</a>}
          eyebrow="Creator workspace"
          title="Studio"
        >
          Create, publish, understand performance, and manage creator products. Studio tools never buy reach or social priority.
        </PageHeader>

        <nav aria-label="Studio sections" className="flex gap-2 overflow-x-auto pb-1 text-sm">
          {[
            ["Overview", "#overview"],
            ["Content", "#content"],
            ["Analytics", "#analytics"],
            ["Monetisation", "#monetisation"],
            ["Readiness", "#readiness"]
          ].map(([label, href]) => <a className="min-h-11 shrink-0 rounded-full border border-(--line) px-4 py-2.5" href={href} key={href}>{label}</a>)}
        </nav>

        {dashboard.ok ? (
          <section className="grid gap-4" id="overview">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard label="Confirmed earnings" value={formatAssetAmount(dashboard.data.earnings.creatorEarningsMinor, dashboard.data.earnings.currency)} />
              <MetricCard label="Confirmed sales" value={String(dashboard.data.earnings.confirmedPaymentCount)} />
              <MetricCard label="Creator readiness" value={`${dashboard.data.readiness.readinessScore}%`} />
              <MetricCard label="Studio plan" value={access.ok ? access.data.currentTier.label : "Unavailable"} />
            </div>
          </section>
        ) : <ErrorState result={dashboard} title="Creator overview unavailable" context="Studio" />}

        <section className="grid gap-3" id="content">
          <div className="flex items-end justify-between gap-3"><div><p className="eyebrow">Library</p><h2 className="text-xl font-semibold">Your content</h2></div><a className="text-sm font-semibold" href="/app/create">New post</a></div>
          {media.ok ? <ProfileMediaWorkspace initialPage={media.data} /> : <ErrorState result={media} title="Content library unavailable" context="Studio content" />}
        </section>

        <section className="grid gap-3" id="analytics">
          <div><p className="eyebrow">Performance</p><h2 className="text-xl font-semibold">Last 30 days</h2></div>
          {hasStudio ? (
            <AnalyticsSummary
              description="Privacy-safe performance and confirmed commerce, compared with the preceding 30 days. Viewer identities and private messages are never exposed."
              queries={[creatorAnalytics, solAnalytics, usdcAnalytics]}
              title="Creator analytics"
            />
          ) : (
            <Card className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div><p className="font-semibold">Advanced analytics are a Studio capability</p><p className="mt-1 text-sm text-(--muted)">Your profile and publishing remain available on every eligible creator account.</p></div>
              <a className="shrink-0 rounded-lg border border-(--line) px-4 py-2 text-sm font-semibold" href="/app/subscriptions">Compare plans</a>
            </Card>
          )}
        </section>

        <section className="grid gap-3 lg:grid-cols-2" id="monetisation">
          <Card className="p-5">
            <div className="flex items-start justify-between gap-3"><div><p className="eyebrow">Monetisation</p><h2 className="mt-1 text-lg font-semibold">Products and pricing</h2></div><StatusPill tone={dashboard.ok && dashboard.data.readiness.canMonetize ? "good" : "warn"}>{dashboard.ok && dashboard.data.readiness.canMonetize ? "Ready" : "Setup"}</StatusPill></div>
            <p className="mt-3 text-sm leading-6 text-(--muted)">Configure recipient wallet, creator products, pricing, and Profile Membership from one creator workspace.</p>
            <a className="mt-4 inline-flex min-h-11 items-center rounded-lg bg-(--foreground) px-4 py-2 text-sm font-semibold text-(--background)" href="/app/profile/earnings">Manage monetisation</a>
          </Card>
          <Card className="p-5" id="readiness">
            <p className="eyebrow">Publishing readiness</p>
            <h2 className="mt-1 text-lg font-semibold">Safety and account checks</h2>
            {onboarding.ok ? <div className="mt-4 grid gap-3 text-sm"><Fact label="Progress" value={`${onboarding.data.readinessScore}%`} /><Fact label="Creator account" value={dashboard.ok && dashboard.data.readiness.state === "active" ? "Ready" : "Needs attention"} /><Fact label="Earnings" value={onboarding.data.canStartEarning ? "Ready" : "Needs attention"} /></div> : <ErrorState result={onboarding} title="Readiness unavailable" context="Studio readiness" />}
          </Card>
        </section>
      </section>
    </AppShell>
  );
}
