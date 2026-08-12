import {
  getMyCreatorDashboard,
  getMyCreatorOnboarding,
  type ApiResult,
  type CreatorDashboard,
  type CreatorOnboarding
} from "@/api-client";
import { requireAppAccess } from "@/supabase/route-guard";
import { formatAssetAmount } from "@/format-asset-amount";
import { AppShell } from "../../app-shell";
import { Card, ErrorState, Fact, MetricCard, PageHeader, StatusPill } from "../../ui";
import { ProfileLogoutButton } from "./profile-logout-button";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  await requireAppAccess("/app/profile");

  const [dashboardResult, onboardingResult] = await Promise.all([
    getMyCreatorDashboard(),
    getMyCreatorOnboarding()
  ]);

  return (
    <AppShell>
      {dashboardResult.ok ? (
        <DashboardView dashboard={dashboardResult.data} onboarding={onboardingResult} />
      ) : onboardingResult.ok ? (
        <OnboardingOnlyView onboarding={onboardingResult.data} unavailable={dashboardResult} />
      ) : (
        <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <ErrorState result={dashboardResult} title="Creator dashboard unavailable" context="Creator dashboard" />
          <ProfileCapabilityLinks />
        </section>
      )}
    </AppShell>
  );
}

function DashboardView({
  dashboard,
  onboarding
}: {
  dashboard: CreatorDashboard;
  onboarding: ApiResult<CreatorOnboarding>;
}) {
  return (
    <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <section className="grid content-start gap-5">
        <PageHeader
          action={<StatusPill tone={dashboard.readiness.canMonetize ? "good" : "warn"}>{dashboard.readiness.canMonetize ? "Ready" : "Setup needed"}</StatusPill>}
          eyebrow="Profile"
          title={dashboard.creator.displayName}
        >
          @{dashboard.creator.handle}
        </PageHeader>

        <div className="grid gap-3 sm:grid-cols-3">
          <MetricCard
            label="Creator earnings"
            value={formatAssetAmount(
              dashboard.earnings.creatorEarningsMinor,
              dashboard.earnings.currency
            )}
          />
          <MetricCard
            label="Platform fees"
            value={formatAssetAmount(
              dashboard.earnings.platformFeesMinor,
              dashboard.earnings.currency
            )}
          />
          <MetricCard
            label="Referral commissions"
            value={formatAssetAmount(
              dashboard.earnings.referralCommissionsMinor,
              dashboard.earnings.currency
            )}
          />
          <MetricCard label="Readiness score" value={`${dashboard.readiness.readinessScore}%`} />
        </div>

        <section className="grid gap-3">
          <h2 className="text-base font-semibold tracking-normal">Products</h2>
          {dashboard.products.map((product) => (
            <ProductRow product={product} key={product.productType} />
          ))}
        </section>
      </section>

      <aside className="grid content-start gap-3">
        {onboarding.ok ? <CreatorSetup onboarding={onboarding.data} /> : null}
        <ProfileCapabilityLinks />

        <Card className="p-4">
          <p className="text-sm font-medium">Monetisation readiness</p>
          <div className="mt-4 grid gap-3 text-sm">
            <Fact label="Earnings" value={dashboard.readiness.earningState} />
            <Fact label="KYC" value={dashboard.readiness.kycState} />
            <Fact label="Tax profile" value={dashboard.readiness.taxProfileState} />
            <Fact label="Wallet" value={dashboard.readiness.recipientWalletState} />
            <Fact label="Can monetize" value={dashboard.readiness.canMonetize ? "yes" : "no"} />
            <Fact label="Boundary" value="no balances or social priority" />
          </div>
        </Card>

        <Card className="p-4">
          <p className="text-sm font-medium">Blocked reasons</p>
          <div className="mt-3 grid gap-2">
            {dashboard.readiness.blockedReasons.map((reason) => (
              <span
                className="rounded bg-(--accent-soft) px-2 py-1 text-xs text-(--accent-strong)"
                key={reason}
              >
                {reason}
              </span>
            ))}
          </div>
        </Card>

        <ProfileSessionActions />
      </aside>
    </section>
  );
}

function OnboardingOnlyView({
  onboarding,
  unavailable
}: {
  onboarding: CreatorOnboarding;
  unavailable: ApiResult<CreatorDashboard>;
}) {
  return (
    <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <section className="grid content-start gap-5">
        <PageHeader eyebrow="Profile" title="Creator setup">
            Complete the backend-owned readiness checks before monetisation views and creator
            products become available.
        </PageHeader>
        <CreatorSetup onboarding={onboarding} />
        <ProfileCapabilityLinks />
      </section>

      <aside className="grid content-start gap-3">
        <ErrorState result={unavailable} title="Creator dashboard unavailable" context="Creator dashboard" />
        <ProfileSessionActions />
      </aside>
    </section>
  );
}

function ProfileSessionActions() {
  return (
    <Card className="p-4">
      <p className="text-sm font-medium">Session</p>
      <p className="mt-2 text-sm leading-6 text-(--muted)">
        Leave the app and return to the public landing page. Wallet, Supabase, and provider browser session state are cleared.
      </p>
      <div className="mt-4">
        <ProfileLogoutButton />
      </div>
    </Card>
  );
}

function ProfileCapabilityLinks() {
  return (
    <Card className="p-4">
      <p className="text-sm font-medium">Profile capabilities</p>
      <p className="mt-2 text-sm leading-6 text-(--muted)">
        Studio, Enterprise, and MCP access are profile/tier capabilities. Backend membership,
        role, and consent checks decide what opens.
      </p>
      <div className="mt-4 grid gap-2">
        <a
          className="flex min-h-12 items-center justify-between gap-3 rounded border border-(--line) bg-(--background) px-3 py-2 text-sm"
          href="/app/studio"
        >
          <span>
            <span className="block font-medium">Studio / Enterprise</span>
            <span className="text-xs text-(--muted)">Organization dashboards for eligible tiers</span>
          </span>
          <StatusPill>tier gated</StatusPill>
        </a>
        <a
          className="flex min-h-12 items-center justify-between gap-3 rounded border border-(--line) bg-(--background) px-3 py-2 text-sm"
          href="/app/settings#mcp"
        >
          <span>
            <span className="block font-medium">MCP connections</span>
            <span className="text-xs text-(--muted)">External client access and revocation</span>
          </span>
          <StatusPill>consent scoped</StatusPill>
        </a>
        <a
          className="flex min-h-12 items-center justify-between gap-3 rounded border border-(--line) bg-(--background) px-3 py-2 text-sm"
          href="/app/assistant"
        >
          <span>
            <span className="block font-medium">Capability projection</span>
            <span className="text-xs text-(--muted)">Read-only AI/MCP scopes when enabled</span>
          </span>
          <StatusPill>backend gated</StatusPill>
        </a>
      </div>
    </Card>
  );
}

function CreatorSetup({ onboarding }: { onboarding: CreatorOnboarding }) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium">Enable earnings</p>
          <p className="mt-1 text-xs text-(--muted)">
            State: {onboarding.state} / {onboarding.readinessScore}%
          </p>
        </div>
        <StatusPill tone={onboarding.canStartEarning ? "good" : "warn"}>{onboarding.canStartEarning ? "ready" : "setup"}</StatusPill>
      </div>

      <a
        className="mt-4 flex min-h-11 items-center justify-center rounded bg-(--foreground) px-3 py-2 text-sm font-semibold text-(--background)"
        href="/app/profile/earnings"
      >
        {onboarding.canStartEarning ? "Review earnings" : "Continue setup"}
      </a>

      <div className="mt-4 grid gap-2">
        {onboarding.steps.map((step) => (
          <a
            className="flex min-h-12 items-center justify-between gap-3 rounded border border-(--line) bg-(--background) px-3 py-2 text-sm"
            href={step.actionHref ?? "#"}
            key={step.key}
          >
            <span>
              <span className="block font-medium">{step.label}</span>
              <span className="text-xs text-(--muted)">{step.required ? "required" : "optional"}</span>
            </span>
            <StatusPill>{step.state}</StatusPill>
          </a>
        ))}
      </div>
    </Card>
  );
}

function ProductRow({ product }: { product: CreatorDashboard["products"][number] }) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="font-medium">{product.productType}</p>
          <p className="mt-1 text-sm text-(--muted)">{product.confirmedPaymentCount} confirmed payments</p>
        </div>
        <StatusPill tone={product.enabled ? "good" : "warn"}>{product.enabled ? "enabled" : "disabled"}</StatusPill>
      </div>
      <p className="mt-3 text-sm font-medium">
        {formatAssetAmount(product.amountMinor, product.currency)}
      </p>
    </Card>
  );
}
