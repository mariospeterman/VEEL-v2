import { appShellNavItems } from "@veel/ui";
import {
  getOrganizationDashboards,
  type ApiResult,
  type OrganizationDashboardPage
} from "@/api-client";

export default async function StudioPage() {
  const dashboards = await getOrganizationDashboards();

  return (
    <main className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <nav className="mx-auto flex w-full max-w-6xl items-center justify-between border-b border-[var(--line)] px-5 py-4">
        <a className="text-lg font-semibold tracking-normal" href="/">
          VEEL
        </a>
        <div className="flex gap-1 overflow-x-auto">
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

      <section className="mx-auto grid w-full max-w-6xl gap-5 px-5 py-6">
        <header className="grid gap-2">
          <p className="text-sm font-medium text-[var(--accent)]">Studio</p>
          <h1 className="text-2xl font-semibold tracking-normal">Organization dashboards</h1>
          <p className="max-w-3xl text-sm leading-6 text-[var(--muted)]">
            Member-scoped governance, RBAC, reporting, and support readiness. Organization tools never create balances,
            withdrawals, payout queues, or preferential social treatment.
          </p>
        </header>

        <DashboardList dashboards={dashboards} />
      </section>
    </main>
  );
}

function DashboardList({ dashboards }: { dashboards: ApiResult<OrganizationDashboardPage> }) {
  if (!dashboards.ok) {
    return <UnavailableState result={dashboards} />;
  }

  if (dashboards.data.items.length === 0) {
    return (
      <section className="rounded border border-[var(--line)] bg-[var(--panel)] p-4">
        <h2 className="text-base font-semibold tracking-normal">No organizations</h2>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Studio and Enterprise dashboards appear after an active organization membership is assigned server-side.
        </p>
      </section>
    );
  }

  return (
    <section className="grid gap-4">
      {dashboards.data.items.map((dashboard) => (
        <article className="rounded border border-[var(--line)] bg-[var(--panel)] p-4" key={dashboard.organization.id}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-[var(--accent)]">{dashboard.organization.plan}</p>
              <h2 className="mt-1 text-xl font-semibold tracking-normal">{dashboard.organization.name}</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">
                {dashboard.organization.role} / {dashboard.organization.membershipState}
              </p>
            </div>
            <span className="rounded bg-[var(--background)] px-2 py-1 text-xs text-[var(--muted)]">
              {dashboard.financeBoundary}
            </span>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <Fact label="Organization state" value={dashboard.organization.state} />
            <Fact label="KYB" value={dashboard.governance.kybState ?? "not_started"} />
            <Fact label="Active members" value={`${dashboard.governance.activeMemberCount}/${dashboard.governance.memberCount}`} />
            <Fact label="Support" value={dashboard.governance.supportState} />
            <Fact label="Tier waiver" value={dashboard.governance.tierWaiverState} />
            <Fact label="Compliance exports" value={enabledLabel(dashboard.capabilities.complianceExportsEnabled)} />
            <Fact label="RBAC" value={enabledLabel(dashboard.capabilities.rbacEnabled)} />
            <Fact label="Team publishing" value={enabledLabel(dashboard.capabilities.teamPublishingEnabled)} />
            <Fact label="Consolidated reporting" value={enabledLabel(dashboard.capabilities.consolidatedReportingEnabled)} />
          </div>

          {dashboard.notices.length > 0 ? (
            <div className="mt-4 grid gap-2">
              {dashboard.notices.map((notice) => (
                <div className="rounded border border-[var(--line)] bg-[var(--background)] p-3 text-sm" key={`${notice.kind}-${notice.title}`}>
                  <p className="font-medium">{notice.title}</p>
                  <p className="mt-1 text-[var(--muted)]">{notice.state}</p>
                </div>
              ))}
            </div>
          ) : null}
        </article>
      ))}
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs uppercase text-[var(--muted)]">{label}</p>
      <p className="mt-1 truncate font-medium">{value}</p>
    </div>
  );
}

function UnavailableState<T>({ result }: { result: Extract<ApiResult<T>, { ok: false }> }) {
  return (
    <section className="rounded border border-[var(--line)] bg-[var(--panel)] p-4">
      <h2 className="text-base font-semibold tracking-normal">Studio API unavailable</h2>
      <p className="mt-2 text-sm text-[var(--muted)]">HTTP {result.status}</p>
      <p className="mt-1 text-sm text-[var(--muted)]">{result.message}</p>
    </section>
  );
}

function enabledLabel(enabled: boolean) {
  return enabled ? "enabled" : "disabled";
}
