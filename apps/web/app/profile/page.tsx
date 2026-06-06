import { appShellNavItems } from "@veel/ui";
import {
  getMyCreatorDashboard,
  getMyCreatorOnboarding,
  type ApiResult,
  type CreatorDashboard,
  type CreatorOnboarding
} from "@/api-client";

export default async function ProfilePage() {
  const [dashboardResult, onboardingResult] = await Promise.all([
    getMyCreatorDashboard(),
    getMyCreatorOnboarding()
  ]);

  return (
    <main className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <AppNav />

      {dashboardResult.ok ? (
        <DashboardView dashboard={dashboardResult.data} onboarding={onboardingResult} />
      ) : onboardingResult.ok ? (
        <OnboardingOnlyView onboarding={onboardingResult.data} unavailable={dashboardResult} />
      ) : (
        <UnavailableState
          message={dashboardResult.message}
          status={dashboardResult.status}
          title="Creator dashboard unavailable"
        />
      )}
    </main>
  );
}

function AppNav() {
  return (
    <nav className="mx-auto flex w-full max-w-6xl items-center justify-between border-b border-[var(--line)] px-5 py-4">
      <a className="text-lg font-semibold tracking-normal" href="/">
        VEEL
      </a>
      <div className="flex gap-1">
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

function DashboardView({
  dashboard,
  onboarding
}: {
  dashboard: CreatorDashboard;
  onboarding: ApiResult<CreatorOnboarding>;
}) {
  return (
    <section className="mx-auto grid w-full max-w-6xl gap-6 px-5 py-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <section className="grid content-start gap-5">
        <div>
          <p className="text-sm font-medium text-[var(--accent)]">Creator dashboard</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-normal">{dashboard.creator.displayName}</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">@{dashboard.creator.handle}</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Metric label="Creator earnings" value={formatAmount(dashboard.earnings.creatorEarningsMinor)} />
          <Metric label="Platform fees" value={formatAmount(dashboard.earnings.platformFeesMinor)} />
          <Metric label="Referral commissions" value={formatAmount(dashboard.earnings.referralCommissionsMinor)} />
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

        <section className="rounded border border-[var(--line)] bg-[var(--panel)] p-4">
          <p className="text-sm font-medium">Monetisation readiness</p>
          <div className="mt-4 grid gap-3 text-sm">
            <Fact label="Earnings" value={dashboard.readiness.earningState} />
            <Fact label="KYC" value={dashboard.readiness.kycState} />
            <Fact label="Tax profile" value={dashboard.readiness.taxProfileState} />
            <Fact label="Wallet" value={dashboard.readiness.recipientWalletState} />
          </div>
        </section>

        <section className="rounded border border-[var(--line)] bg-[var(--panel)] p-4">
          <p className="text-sm font-medium">Blocked reasons</p>
          <div className="mt-3 grid gap-2">
            {dashboard.readiness.blockedReasons.map((reason) => (
              <span
                className="rounded bg-[var(--accent-soft)] px-2 py-1 text-xs text-[var(--accent-strong)]"
                key={reason}
              >
                {reason}
              </span>
            ))}
          </div>
        </section>
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
    <section className="mx-auto grid w-full max-w-6xl gap-6 px-5 py-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <section className="grid content-start gap-5">
        <div>
          <p className="text-sm font-medium text-[var(--accent)]">Become Creator</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-normal">Creator setup</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">
            Complete the backend-owned readiness checks before monetisation views and creator
            products become available.
          </p>
        </div>
        <CreatorSetup onboarding={onboarding} />
      </section>

      <aside className="grid content-start gap-3">
        <UnavailablePanel result={unavailable} title="Creator dashboard unavailable" />
      </aside>
    </section>
  );
}

function CreatorSetup({ onboarding }: { onboarding: CreatorOnboarding }) {
  return (
    <section className="rounded border border-[var(--line)] bg-[var(--panel)] p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium">Become Creator</p>
          <p className="mt-1 text-xs text-[var(--muted)]">
            State: {onboarding.state}
          </p>
        </div>
        <span className="rounded bg-[var(--background)] px-2 py-1 text-xs text-[var(--muted)]">
          {onboarding.canStartEarning ? "ready" : "setup"}
        </span>
      </div>

      <div className="mt-4 grid gap-2">
        {onboarding.steps.map((step) => (
          <a
            className="flex min-h-12 items-center justify-between gap-3 rounded border border-[var(--line)] bg-[var(--background)] px-3 py-2 text-sm"
            href={step.actionHref ?? "#"}
            key={step.key}
          >
            <span>
              <span className="block font-medium">{step.label}</span>
              <span className="text-xs text-[var(--muted)]">{step.required ? "required" : "optional"}</span>
            </span>
            <span className="rounded bg-[var(--panel)] px-2 py-1 text-xs text-[var(--muted)]">
              {step.state}
            </span>
          </a>
        ))}
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-[var(--line)] bg-[var(--panel)] p-4">
      <p className="text-xs uppercase text-[var(--muted)]">{label}</p>
      <p className="mt-2 text-xl font-semibold tracking-normal">{value}</p>
    </div>
  );
}

function ProductRow({ product }: { product: CreatorDashboard["products"][number] }) {
  return (
    <article className="rounded border border-[var(--line)] bg-[var(--panel)] p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="font-medium">{product.productType}</p>
          <p className="mt-1 text-sm text-[var(--muted)]">{product.confirmedPaymentCount} confirmed payments</p>
        </div>
        <span className="rounded bg-[var(--background)] px-2 py-1 text-xs text-[var(--muted)]">
          {product.enabled ? "enabled" : "disabled"}
        </span>
      </div>
      <p className="mt-3 text-sm font-medium">{formatAmount(product.amountMinor)}</p>
    </article>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase text-[var(--muted)]">{label}</p>
      <p className="mt-1 font-medium">{value}</p>
    </div>
  );
}

function formatAmount(amountMinor: number) {
  return `${amountMinor.toLocaleString()} SOL`;
}

function UnavailableState({
  message,
  status,
  title
}: {
  message: string;
  status: number;
  title: string;
}) {
  return (
    <section className="mx-auto grid min-h-[calc(100vh-73px)] w-full max-w-6xl content-center px-5 py-6">
      <div className="rounded border border-[var(--line)] bg-[var(--panel)] p-6">
        <p className="text-sm font-medium text-[var(--accent)]">HTTP {status}</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-normal">{title}</h1>
        <p className="mt-3 text-sm leading-6 text-[var(--muted)]">{message}</p>
      </div>
    </section>
  );
}

function UnavailablePanel({
  result,
  title
}: {
  result: ApiResult<unknown>;
  title: string;
}) {
  if (result.ok) {
    return null;
  }

  return (
    <section className="rounded border border-[var(--line)] bg-[var(--panel)] p-4">
      <p className="text-sm font-medium text-[var(--accent)]">HTTP {result.status}</p>
      <h2 className="mt-2 text-base font-semibold tracking-normal">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{result.message}</p>
    </section>
  );
}
