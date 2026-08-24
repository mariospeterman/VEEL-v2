import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { AnalyticsOperations, PaymentPolicyOperations } from "../admin-operations";
import {
  getAdminAgeChecks,
  getAdminAiSessions,
  getAdminAiToolCalls,
  getAdminAnalyticsHealth,
  getAdminAuditEvents,
  getAdminCarfReports,
  getAdminComplianceLedger,
  getAdminContent,
  getAdminCurrentStaff,
  getAdminDac7Reports,
  getAdminDataRequests,
  getAdminEventAccessPasses,
  getAdminEvents,
  getAdminFeatureFlags,
  getAdminIdentityChecks,
  getAdminInvoices,
  getAdminLiveRooms,
  getAdminMutualsSafety,
  getAdminNotificationHealth,
  getAdminOpsSummary,
  getAdminOrganizationMembers,
  getAdminOrganizations,
  getAdminPartnerCampaigns,
  getAdminPaymentCommercialPolicies,
  getAdminPaymentIntents,
  getAdminProviderEvents,
  getAdminReceipts,
  getAdminReferralPrograms,
  getAdminRefundDisputes,
  getAdminReports,
  getAdminStaffDirectory,
  getAdminSupportCases,
  getAdminSupportPolicies,
  getAdminTierWaivers,
  getAdminUnlocks,
  getAdminUsers,
  getAdminVatDeterminations,
  type AdminPermission,
  type ApiResult
} from "@/api-client";

type SectionDefinition = {
  title: string;
  description: string;
  anyOf: AdminPermission[];
  load: (permissions: AdminPermission[]) => Promise<ResourceGroup[]>;
  operations?: (permissions: AdminPermission[]) => Promise<ReactNode>;
};

type ResourceGroup = { title: string; result: ApiResult<unknown> };

const sections: Record<string, SectionDefinition> = {
  users: section("Users", "Account, access and verification summaries.", ["admin.users.read"], (permissions) => loadPermitted(permissions, [["admin.users.read", "Users", getAdminUsers]])),
  content: section("Content", "Canonical publication and media moderation state.", ["admin.content.read"], (permissions) => loadPermitted(permissions, [["admin.content.read", "Content queue", getAdminContent]])),
  safety: section("Safety", "Reports, Mutuals safety and age assurance queues.", ["admin.reports.read", "admin.users.read"], (permissions) => loadPermitted(permissions, [
    ["admin.reports.read", "Reports", getAdminReports],
    ["admin.reports.read", "Mutuals", getAdminMutualsSafety],
    ["admin.users.read", "Age checks", getAdminAgeChecks],
    ["admin.users.read", "Identity checks", getAdminIdentityChecks]
  ])),
  payments: section("Payments", "Observed settlement, access and refund records. No custody.", ["admin.payments.read", "admin.refunds.read"], (permissions) => loadPermitted(permissions, [
    ["admin.payments.read", "Payment intents", getAdminPaymentIntents],
    ["admin.payments.read", "Unlocks", getAdminUnlocks],
    ["admin.refunds.read", "Refunds", getAdminRefundDisputes]
  ]), async (permissions) => <PaymentPolicyOperations canWrite={permissions.includes("admin.payment_policy.write")} policies={await getAdminPaymentCommercialPolicies()} />),
  subscriptions: section("Subscriptions", "Recurring-provider readiness and lifecycle health.", ["admin.subscriptions.read"], (permissions) => loadPermitted(permissions, [["admin.overview.read", "Subscription readiness", getAdminOpsSummary]])),
  live: section("Live", "Live room state, replay and provider safety controls.", ["admin.live.read"], (permissions) => loadPermitted(permissions, [["admin.live.read", "Live rooms", getAdminLiveRooms]])),
  events: section("Events", "Event Access and pass operations.", ["admin.events.read"], (permissions) => loadPermitted(permissions, [["admin.events.read", "Events", getAdminEvents], ["admin.events.read", "Access passes", getAdminEventAccessPasses]])),
  providers: section("Providers", "Redacted provider events, delivery and worker health.", ["admin.providers.read", "admin.queues.read"], (permissions) => loadPermitted(permissions, [["admin.providers.read", "Provider events", getAdminProviderEvents], ["admin.queues.read", "Delivery health", getAdminNotificationHealth]])),
  organizations: section("Organizations", "Enterprise KYB and permission-bound coworker records.", ["admin.organizations.read"], loadOrganizations),
  analytics: section("Analytics", "Projection freshness and bounded recompute readiness.", ["admin.analytics.read"], async () => [], async (permissions) => <AnalyticsOperations canRecompute={permissions.includes("admin.analytics.recompute")} health={await getAdminAnalyticsHealth()} />),
  privacy: section("Privacy", "User data requests and controlled processing state.", ["admin.privacy.read"], (permissions) => loadPermitted(permissions, [["admin.privacy.read", "Data requests", getAdminDataRequests]])),
  compliance: section("Compliance", "Reporting ledger, DAC7, CARF, VAT and accounting projections.", ["admin.compliance.read"], (permissions) => loadPermitted(permissions, [["admin.compliance.read", "Ledger", getAdminComplianceLedger], ["admin.compliance.read", "DAC7", getAdminDac7Reports], ["admin.compliance.read", "CARF", getAdminCarfReports], ["admin.compliance.read", "VAT", getAdminVatDeterminations], ["admin.compliance.read", "Receipts", getAdminReceipts], ["admin.compliance.read", "Invoices", getAdminInvoices]])),
  ai: section("AI operations", "Scoped assistant sessions and redacted tool-call audit.", ["admin.ai.read"], (permissions) => loadPermitted(permissions, [["admin.ai.read", "Sessions", getAdminAiSessions], ["admin.ai.read", "Tool calls", getAdminAiToolCalls]])),
  audit: section("Audit", "Immutable operational action history.", ["admin.audit.read"], (permissions) => loadPermitted(permissions, [["admin.audit.read", "Audit events", getAdminAuditEvents]])),
  staff: section("Staff", "Coworker roles, invitations and effective access lifecycle.", ["admin.staff.read"], (permissions) => loadPermitted(permissions, [["admin.staff.read", "Staff directory", getAdminStaffDirectory]])),
  settings: section("Settings", "Audited platform flags and controlled operational policy.", ["admin.feature_flags.read"], (permissions) => loadPermitted(permissions, [["admin.feature_flags.read", "Feature flags", getAdminFeatureFlags]])),
  support: section("Support", "Sanitized support cases and policy state.", ["admin.support.read"], (permissions) => loadPermitted(permissions, [["admin.support.read", "Cases", getAdminSupportCases], ["admin.support.read", "Policies", getAdminSupportPolicies]])),
  growth: section("Growth governance", "Referral, partner and tier-waiver policy records.", ["admin.payments.read"], (permissions) => loadPermitted(permissions, [["admin.payments.read", "Referral programs", getAdminReferralPrograms], ["admin.payments.read", "Partner campaigns", getAdminPartnerCampaigns], ["admin.payments.read", "Tier waivers", getAdminTierWaivers]]))
};

export default async function AdminSectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section: key } = await params;
  const definition = sections[key];
  if (!definition) notFound();
  const access = await getAdminCurrentStaff();
  const allowed = access.ok && definition.anyOf.some((permission) => access.data.permissions.includes(permission));
  if (!allowed) {
    return <State title="Permission required">This section is not included in your current staff role.</State>;
  }
  const resources = await definition.load(access.data.permissions);
  const operations = definition.operations ? await definition.operations(access.data.permissions) : null;

  return (
    <div className="grid gap-6">
      <header>
        <p className="text-sm font-semibold text-(--accent-text)">WeVid Admin</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-[-0.03em]">{definition.title}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-(--muted)">{definition.description}</p>
      </header>
      {operations}
      {resources.length > 0 || !operations ? <div className="grid gap-4">
        {resources.length > 0
          ? resources.map((resource) => <ResourcePanel key={resource.title} resource={resource} />)
          : <State title="No authorized resources">Your role includes this section but no compatible data projection.</State>}
      </div> : null}
    </div>
  );
}

function section(
  title: string,
  description: string,
  anyOf: AdminPermission[],
  load: (permissions: AdminPermission[]) => Promise<ResourceGroup[]>,
  operations?: (permissions: AdminPermission[]) => Promise<ReactNode>
): SectionDefinition {
  return { title, description, anyOf, load, ...(operations ? { operations } : {}) };
}

type ResourceSpec = readonly [AdminPermission, string, () => Promise<ApiResult<unknown>>];

async function loadPermitted(permissions: AdminPermission[], specs: ResourceSpec[]): Promise<ResourceGroup[]> {
  return Promise.all(
    specs
      .filter(([permission]) => permissions.includes(permission))
      .map(async ([, title, load]) => group(title, await load()))
  );
}

function group(title: string, result: ApiResult<unknown>): ResourceGroup {
  return { title, result };
}

async function loadOrganizations(): Promise<ResourceGroup[]> {
  const organizations = await getAdminOrganizations();
  const groups = [group("Organizations", organizations)];
  const organizationId = organizations.ok ? organizations.data.items[0]?.id : null;
  if (organizationId) groups.push(group("Members", await getAdminOrganizationMembers(organizationId)));
  return groups;
}

function ResourcePanel({ resource }: { resource: ResourceGroup }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-(--line) bg-(--panel)">
      <div className="border-b border-(--line) px-5 py-4"><h2 className="font-semibold">{resource.title}</h2></div>
      {!resource.result.ok ? <div className="p-5 text-sm text-(--muted)">{resource.result.message}</div> : <DataView value={resource.result.data} />}
    </section>
  );
}

function DataView({ value }: { value: unknown }) {
  const items = extractItems(value);
  if (!items.length) return <div className="p-5 text-sm text-(--muted)">No records.</div>;
  return <div className="divide-y divide-(--line)">{items.slice(0, 25).map((item, index) => <RecordRow item={item} key={recordKey(item, index)} />)}</div>;
}

function RecordRow({ item }: { item: unknown }) {
  if (!isRecord(item)) return <div className="p-5 text-sm">{display(item)}</div>;
  const entries = Object.entries(item).filter(([, value]) => isDisplayable(value)).slice(0, 6);
  return (
    <div className="grid gap-3 px-5 py-4 sm:grid-cols-2 xl:grid-cols-3">
      {entries.map(([key, value]) => (
        <div className="min-w-0" key={key}>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-(--muted)">{humanize(key)}</p>
          <p className="mt-1 truncate text-sm font-medium">{display(value)}</p>
        </div>
      ))}
    </div>
  );
}

function extractItems(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) return value == null ? [] : [value];
  if (Array.isArray(value.items)) return value.items;
  if (Array.isArray(value.memberships) || Array.isArray(value.invitations)) {
    return [...(Array.isArray(value.memberships) ? value.memberships : []), ...(Array.isArray(value.invitations) ? value.invitations : [])];
  }
  return [value];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDisplayable(value: unknown) {
  return value == null || ["string", "number", "boolean"].includes(typeof value);
}

function display(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value).replaceAll("_", " ");
}

function humanize(value: string) {
  return value.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ");
}

function recordKey(item: unknown, index: number) {
  return isRecord(item) && typeof item.id === "string" ? item.id : String(index);
}

function State({ children, title }: { children: ReactNode; title: string }) {
  return <section className="rounded-2xl border border-(--line) bg-(--panel) p-6"><h1 className="text-xl font-semibold">{title}</h1><p className="mt-2 text-sm text-(--muted)">{children}</p></section>;
}
