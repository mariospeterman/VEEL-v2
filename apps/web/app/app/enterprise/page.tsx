import {
  getManagedCreatorRelationships,
  getManagedCreatorReporting,
  getOrganizationDashboards,
  getOrganizationMembers,
  queryAnalytics,
  getWallets,
  type AnalyticsQueryResponse,
  type ApiResult,
  type OrganizationDashboardPage
} from "@/api-client";
import { requireAppAccess } from "@/supabase/route-guard";
import { AppShell } from "../../app-shell";
import { Card, EmptyState, ErrorState, Fact, PageHeader, StatusPill } from "../../ui";
import { EnterpriseRelationshipPanel } from "./enterprise-relationship-panel";
import { AnalyticsSummary, analyticsWindow } from "../analytics-summary";

export const dynamic = "force-dynamic";

export default async function EnterprisePage() {
  await requireAppAccess("/app/enterprise");

  const [dashboards, relationships, wallets] = await Promise.all([
    getOrganizationDashboards(),
    getManagedCreatorRelationships(),
    getWallets()
  ]);
  const dashboardItems = dashboards.ok ? dashboards.data.items : [];
  const relationshipItems = relationships.ok ? relationships.data.items : [];
  const [memberEntries, reportingEntries, analyticsEntries] = await Promise.all([
    Promise.all(dashboardItems.map(async (dashboard) => {
      const organizationId = dashboard.organization.organizationId;
      const result = dashboard.organization.membershipState === "active"
        ? await getOrganizationMembers(organizationId)
        : null;
      return [organizationId, result?.ok ? result.data.items : []] as const;
    })),
    Promise.all(relationshipItems.map(async (relationship) => {
      const result = await getManagedCreatorReporting(relationship.id);
      return [relationship.id, result.ok ? result.data : null] as const;
    })),
    Promise.all(dashboardItems.map(async (dashboard) => {
      const organizationId = dashboard.organization.organizationId;
      const queryCurrency = (currency: "SOL" | "USDC") => queryAnalytics({
        scope: { type: "organization" as const, organizationId },
        metricKeys: [
          "organization.commerce.confirmed_allocations" as const,
          "organization.commerce.creator_net_minor" as const,
          "organization.commerce.management_minor" as const
        ],
        window: analyticsWindow(30),
        comparisonWindow: analyticsWindow(30, 30),
        granularity: "total" as const,
        timezone: "UTC" as const,
        dimensions: { currency }
      });
      return [organizationId, await Promise.all([queryCurrency("SOL"), queryCurrency("USDC")])] as const;
    }))
  ]);
  const organizationAnalytics = Object.fromEntries(analyticsEntries) as Record<string, Array<ApiResult<AnalyticsQueryResponse>>>;

  return (
    <AppShell>
      <section className="grid gap-5">
        <PageHeader eyebrow="Organization workspace" title="Enterprise">
            Manage only your organization, accepted coworkers, and creators who explicitly agreed to
            the active management terms. WeVid never takes custody of user funds.
        </PageHeader>

        <DashboardList analytics={organizationAnalytics} dashboards={dashboards} />
        {relationships.ok ? (
          <EnterpriseRelationshipPanel
            dashboards={dashboardItems}
            members={Object.fromEntries(memberEntries)}
            relationships={relationshipItems}
            reporting={Object.fromEntries(reportingEntries)}
            wallets={wallets.ok ? wallets.data.items : []}
          />
        ) : (
          <ErrorState result={relationships} title="Managed creators unavailable" context="Enterprise relationships" />
        )}
      </section>
    </AppShell>
  );
}

function DashboardList({ analytics, dashboards }: {
  analytics: Record<string, Array<ApiResult<AnalyticsQueryResponse>>>;
  dashboards: ApiResult<OrganizationDashboardPage>;
}) {
  if (!dashboards.ok) {
    return <ErrorState result={dashboards} title="Enterprise unavailable" context="Enterprise" />;
  }

  if (dashboards.data.items.length === 0) {
    return (
      <EmptyState title="No Enterprise organization">
          This workspace appears after an organization invitation is accepted and its Enterprise
          capability is active.
      </EmptyState>
    );
  }

  return (
    <section className="grid gap-4">
      {dashboards.data.items.map((dashboard) => (
        <section className="grid gap-3" key={dashboard.organization.id}>
        <Card className="p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-(--accent-text)">{dashboard.organization.plan}</p>
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
        <AnalyticsSummary
          description="The same versioned metric objects used across WeVid, restricted to this active Enterprise organization and separated by native currency."
          queries={analytics[dashboard.organization.organizationId] ?? []}
          title={`${dashboard.organization.name} analytics`}
        />
        </section>
      ))}
    </section>
  );
}

function enabledLabel(enabled: boolean) {
  return enabled ? "enabled" : "disabled";
}
