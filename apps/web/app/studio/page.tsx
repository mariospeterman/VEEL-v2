import {
  getOrganizationDashboards,
  type ApiResult,
  type OrganizationDashboardPage
} from "@/api-client";
import { requireAppAccess } from "@/supabase/route-guard";
import { AppShell } from "../app-shell";
import { Card, EmptyState, ErrorState, Fact, PageHeader, StatusPill } from "../ui";

export const dynamic = "force-dynamic";

export default async function StudioPage() {
  await requireAppAccess("/app/studio");

  const dashboards = await getOrganizationDashboards();

  return (
    <AppShell>
      <section className="grid gap-5">
        <PageHeader eyebrow="Profile tier" title="Studio / Enterprise capabilities">
            Studio and Enterprise are profile-tier organization capabilities. Member-scoped governance,
            RBAC, reporting, and support readiness never create balances, withdrawals, payout queues,
            or preferential social treatment.
        </PageHeader>

        <DashboardList dashboards={dashboards} />
      </section>
    </AppShell>
  );
}

function DashboardList({ dashboards }: { dashboards: ApiResult<OrganizationDashboardPage> }) {
  if (!dashboards.ok) {
    return <ErrorState result={dashboards} title="Studio / Enterprise unavailable" context="Studio / Enterprise" />;
  }

  if (dashboards.data.items.length === 0) {
    return (
      <EmptyState title="No Studio or Enterprise membership">
          These capabilities appear inside the profile surface after an active organization membership
          or tier grant is assigned server-side.
      </EmptyState>
    );
  }

  return (
    <section className="grid gap-4">
      {dashboards.data.items.map((dashboard) => (
        <Card className="p-4" key={dashboard.organization.id}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-(--accent)">{dashboard.organization.plan}</p>
              <h2 className="mt-1 text-xl font-semibold tracking-normal">{dashboard.organization.name}</h2>
              <p className="mt-1 text-sm text-(--muted)">
                {dashboard.organization.role} / {dashboard.organization.membershipState}
              </p>
            </div>
            <StatusPill>{dashboard.financeBoundary}</StatusPill>
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
                <div className="rounded border border-(--line) bg-(--background) p-3 text-sm" key={`${notice.kind}-${notice.title}`}>
                  <p className="font-medium">{notice.title}</p>
                  <p className="mt-1 text-(--muted)">{notice.state}</p>
                </div>
              ))}
            </div>
          ) : null}

          <div className="mt-4 grid gap-2">
            <h3 className="text-sm font-semibold tracking-normal">Role permissions</h3>
            <div className="grid gap-2 md:grid-cols-2">
              {dashboard.rolePermissions.map((permission) => (
                <div
                  className="flex min-h-14 items-center justify-between gap-3 rounded border border-(--line) bg-(--background) px-3 py-2 text-sm"
                  key={permission.key}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{permission.label}</span>
                    <span className="text-xs text-(--muted)">{permission.reason}</span>
                  </span>
                  <StatusPill tone={permission.allowed ? "good" : "warn"}>{permission.allowed ? "allowed" : "blocked"}</StatusPill>
                </div>
              ))}
            </div>
          </div>
        </Card>
      ))}
    </section>
  );
}

function enabledLabel(enabled: boolean) {
  return enabled ? "enabled" : "disabled";
}
