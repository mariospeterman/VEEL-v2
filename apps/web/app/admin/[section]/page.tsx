import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { AnalyticsOperations, FeatureFlagOperations, PaymentPolicyOperations } from "../admin-operations";
import {
  adminSearchParam,
  adminSectionPageHref,
  isUuid,
  preservedAdminSearchEntries,
  type AdminSearchParams
} from "@/admin/admin-pagination";
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
  load: (permissions: AdminPermission[], searchParams: AdminSearchParams) => Promise<ResourceGroup[]>;
  operations?: (
    permissions: AdminPermission[],
    searchParams: AdminSearchParams
  ) => Promise<ReactNode>;
};

type ResourceGroup = {
  title: string;
  result: ApiResult<unknown>;
  cursorKey?: string;
  nextCursor?: string | null;
  selection?: {
    name: string;
    selected: string | null;
    options: Array<{ label: string; value: string }>;
  };
};

const sections: Record<string, SectionDefinition> = {
  users: section("Users", "Account, access and verification summaries.", ["admin.users.read"], paged([
    ["admin.users.read", "Users", "usersCursor", getAdminUsers]
  ])),
  content: section("Content", "Canonical publication and media moderation state.", ["admin.content.read"], paged([
    ["admin.content.read", "Content queue", "contentCursor", getAdminContent]
  ])),
  safety: section("Safety", "Reports, Mutuals safety and age assurance queues.", ["admin.reports.read", "admin.users.read"], paged([
    ["admin.reports.read", "Reports", "reportsCursor", getAdminReports],
    ["admin.reports.read", "Mutuals", null, getAdminMutualsSafety],
    ["admin.users.read", "Age checks", "ageCursor", getAdminAgeChecks],
    ["admin.users.read", "Identity checks", "identityCursor", getAdminIdentityChecks]
  ])),
  payments: section("Payments", "Observed settlement, access and refund records. No custody.", ["admin.payments.read", "admin.refunds.read"], paged([
    ["admin.payments.read", "Payment intents", "paymentIntentsCursor", getAdminPaymentIntents],
    ["admin.payments.read", "Unlocks", "unlocksCursor", getAdminUnlocks],
    ["admin.refunds.read", "Refunds", "refundsCursor", getAdminRefundDisputes]
  ]), async (permissions, searchParams) => {
    const policies = await getAdminPaymentCommercialPolicies(
      adminSearchParam(searchParams, "paymentPoliciesCursor")
    );
    return (
      <PaymentPolicyOperations
        canWrite={permissions.includes("admin.payment_policy.write")}
        nextPageHref={operationNextPageHref("payments", "paymentPoliciesCursor", searchParams, policies)}
        policies={policies}
      />
    );
  }),
  subscriptions: section("Subscriptions", "Recurring-provider readiness and lifecycle health.", ["admin.subscriptions.read"], paged([
    ["admin.overview.read", "Subscription readiness", null, getAdminOpsSummary]
  ])),
  live: section("Live", "Live room state, replay and provider safety controls.", ["admin.live.read"], paged([
    ["admin.live.read", "Live rooms", "liveCursor", getAdminLiveRooms]
  ])),
  events: section("Events", "Event Access and pass operations.", ["admin.events.read"], paged([
    ["admin.events.read", "Events", "eventsCursor", getAdminEvents],
    ["admin.events.read", "Access passes", "passesCursor", getAdminEventAccessPasses]
  ])),
  providers: section("Providers", "Redacted provider events, delivery and worker health.", ["admin.providers.read", "admin.queues.read"], paged([
    ["admin.providers.read", "Provider events", "providerEventsCursor", getAdminProviderEvents],
    ["admin.queues.read", "Delivery health", null, getAdminNotificationHealth]
  ])),
  organizations: section("Organizations", "Enterprise KYB and permission-bound coworker records.", ["admin.organizations.read"], loadOrganizations),
  analytics: section("Analytics", "Projection freshness and bounded recompute readiness.", ["admin.analytics.read"], async () => [], async (permissions) => <AnalyticsOperations canRecompute={permissions.includes("admin.analytics.recompute")} health={await getAdminAnalyticsHealth()} />),
  privacy: section("Privacy", "User data requests and controlled processing state.", ["admin.privacy.read"], paged([
    ["admin.privacy.read", "Data requests", "dataRequestsCursor", getAdminDataRequests]
  ])),
  compliance: section("Compliance", "Reporting ledger, DAC7, CARF, VAT and accounting projections.", ["admin.compliance.read"], paged([
    ["admin.compliance.read", "Ledger", "ledgerCursor", getAdminComplianceLedger],
    ["admin.compliance.read", "DAC7", "dac7Cursor", getAdminDac7Reports],
    ["admin.compliance.read", "CARF", "carfCursor", getAdminCarfReports],
    ["admin.compliance.read", "VAT", "vatCursor", getAdminVatDeterminations],
    ["admin.compliance.read", "Receipts", "receiptsCursor", getAdminReceipts],
    ["admin.compliance.read", "Invoices", "invoicesCursor", getAdminInvoices]
  ])),
  ai: section("AI operations", "Scoped assistant sessions and redacted tool-call audit.", ["admin.ai.read"], paged([
    ["admin.ai.read", "Sessions", "aiSessionsCursor", getAdminAiSessions],
    ["admin.ai.read", "Tool calls", "aiCallsCursor", getAdminAiToolCalls]
  ])),
  audit: section("Audit", "Immutable operational action history.", ["admin.audit.read"], paged([
    ["admin.audit.read", "Audit events", "auditCursor", getAdminAuditEvents]
  ])),
  staff: section("Staff", "Coworker roles, invitations and effective access lifecycle.", ["admin.staff.read"], paged([
    ["admin.staff.read", "Staff directory", null, getAdminStaffDirectory]
  ])),
  settings: section("Settings", "Audited platform flags and controlled operational policy.", ["admin.feature_flags.read"], async () => [], async (permissions, searchParams) => {
    const flags = await getAdminFeatureFlags(adminSearchParam(searchParams, "featureFlagsCursor"));
    return (
      <FeatureFlagOperations
        canWrite={permissions.includes("admin.feature_flags.write")}
        flags={flags}
        nextPageHref={operationNextPageHref("settings", "featureFlagsCursor", searchParams, flags)}
      />
    );
  }),
  support: section("Support", "Sanitized support cases and policy state.", ["admin.support.read"], paged([
    ["admin.support.read", "Cases", "supportCasesCursor", getAdminSupportCases],
    ["admin.support.read", "Policies", "supportPoliciesCursor", getAdminSupportPolicies]
  ])),
  growth: section("Growth governance", "Referral, partner and tier-waiver policy records.", ["admin.payments.read"], paged([
    ["admin.payments.read", "Referral programs", "referralProgramsCursor", getAdminReferralPrograms],
    ["admin.payments.read", "Partner campaigns", "partnerCampaignsCursor", getAdminPartnerCampaigns],
    ["admin.payments.read", "Tier waivers", "tierWaiversCursor", getAdminTierWaivers]
  ]))
};

export default async function AdminSectionPage({ params, searchParams }: {
  params: Promise<{ section: string }>;
  searchParams: Promise<AdminSearchParams>;
}) {
  const { section: key } = await params;
  const query = await searchParams;
  const definition = sections[key];
  if (!definition) notFound();
  const access = await getAdminCurrentStaff();
  const allowed = access.ok && definition.anyOf.some((permission) => access.data.permissions.includes(permission));
  if (!allowed) {
    return <State title="Permission required">This section is not included in your current staff role.</State>;
  }
  const resources = await definition.load(access.data.permissions, query);
  const operations = definition.operations
    ? await definition.operations(access.data.permissions, query)
    : null;

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
          ? resources.map((resource) => (
              <ResourcePanel
                key={resource.title}
                resource={resource}
                searchParams={query}
                section={key}
              />
            ))
          : <State title="No authorized resources">Your role includes this section but no compatible data projection.</State>}
      </div> : null}
    </div>
  );
}

function section(
  title: string,
  description: string,
  anyOf: AdminPermission[],
  load: (permissions: AdminPermission[], searchParams: AdminSearchParams) => Promise<ResourceGroup[]>,
  operations?: (
    permissions: AdminPermission[],
    searchParams: AdminSearchParams
  ) => Promise<ReactNode>
): SectionDefinition {
  return { title, description, anyOf, load, ...(operations ? { operations } : {}) };
}

function operationNextPageHref(
  section: string,
  cursorKey: string,
  searchParams: AdminSearchParams,
  result: ApiResult<{ nextCursor: string | null }>
): string | null {
  if (!result.ok || !result.data.nextCursor) return null;
  return adminSectionPageHref({
    section,
    searchParams,
    cursorKey,
    cursor: result.data.nextCursor
  });
}

type ResourceSpec = readonly [
  AdminPermission,
  string,
  string | null,
  (cursor?: string) => Promise<ApiResult<unknown>>
];

function paged(specs: ResourceSpec[]): SectionDefinition["load"] {
  return (permissions, searchParams) => loadPermitted(permissions, specs, searchParams);
}

async function loadPermitted(
  permissions: AdminPermission[],
  specs: ResourceSpec[],
  searchParams: AdminSearchParams
): Promise<ResourceGroup[]> {
  return Promise.all(
    specs
      .filter(([permission]) => permissions.includes(permission))
      .map(async ([, title, cursorKey, load]) => {
        const cursor = cursorKey ? adminSearchParam(searchParams, cursorKey) : undefined;
        return group(title, await load(cursor), cursorKey ?? undefined);
      })
  );
}

function group(
  title: string,
  result: ApiResult<unknown>,
  cursorKey?: string,
  selection?: ResourceGroup["selection"]
): ResourceGroup {
  const nextCursor = result.ok && isRecord(result.data) &&
    (typeof result.data.nextCursor === "string" || result.data.nextCursor === null)
    ? result.data.nextCursor
    : undefined;
  return {
    title,
    result,
    ...(cursorKey
      ? { cursorKey, ...(nextCursor !== undefined ? { nextCursor } : {}) }
      : {}),
    ...(selection ? { selection } : {})
  };
}

async function loadOrganizations(
  _permissions: AdminPermission[],
  searchParams: AdminSearchParams
): Promise<ResourceGroup[]> {
  const organizationsCursor = adminSearchParam(searchParams, "organizationsCursor");
  const organizations = await getAdminOrganizations(organizationsCursor);
  const requestedOrganizationId = adminSearchParam(searchParams, "organizationId");
  const organizationId = requestedOrganizationId && isUuid(requestedOrganizationId)
    ? requestedOrganizationId
    : null;
  const options = organizations.ok
    ? organizations.data.items.map((organization) => ({
        label: `${organization.name} · ${organization.state.replaceAll("_", " ")}`,
        value: organization.id
      }))
    : [];
  const groups = [group("Organizations", organizations, "organizationsCursor", {
    name: "organizationId",
    selected: organizationId,
    options
  })];
  if (organizationId) {
    groups.push(group(
      "Organization members",
      await getAdminOrganizationMembers(
        organizationId,
        adminSearchParam(searchParams, "organizationMembersCursor")
      ),
      "organizationMembersCursor"
    ));
  }
  return groups;
}

function ResourcePanel({ resource, searchParams, section }: {
  resource: ResourceGroup;
  searchParams: AdminSearchParams;
  section: string;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-(--line) bg-(--panel)">
      <div className="border-b border-(--line) px-5 py-4"><h2 className="font-semibold">{resource.title}</h2></div>
      {resource.selection ? (
        <SelectionForm
          searchParams={searchParams}
          section={section}
          selection={resource.selection}
        />
      ) : null}
      {!resource.result.ok
        ? <div className="p-5 text-sm text-(--muted)">{resource.result.message}</div>
        : <DataView value={resource.result.data} />}
      {resource.cursorKey && resource.nextCursor ? (
        <div className="border-t border-(--line) px-5 py-4">
          <a
            className="inline-flex min-h-11 items-center rounded-full border border-(--line) px-4 text-sm font-semibold hover:border-(--accent)"
            href={adminSectionPageHref({
              section,
              searchParams,
              cursorKey: resource.cursorKey,
              cursor: resource.nextCursor
            })}
          >
            Next page
          </a>
        </div>
      ) : null}
    </section>
  );
}

function SelectionForm({ searchParams, section, selection }: {
  searchParams: AdminSearchParams;
  section: string;
  selection: NonNullable<ResourceGroup["selection"]>;
}) {
  const hasSelectedOption = selection.selected
    ? selection.options.some((option) => option.value === selection.selected)
    : false;
  return (
    <form action={`/admin/${encodeURIComponent(section)}`} className="flex flex-wrap items-end gap-3 border-b border-(--line) px-5 py-4" method="get">
      {preservedAdminSearchEntries(searchParams, [selection.name, "organizationMembersCursor"]).map(([key, value]) => (
        <input key={key} name={key} type="hidden" value={value} />
      ))}
      <label className="grid min-w-64 flex-1 gap-1.5 text-sm">
        <span className="font-medium">Organization to inspect</span>
        <select className="min-h-11 rounded border border-(--line) bg-(--background) px-3" defaultValue={selection.selected ?? ""} name={selection.name}>
          <option value="">Choose an organization</option>
          {selection.selected && !hasSelectedOption ? (
            <option value={selection.selected}>Selected organization · {selection.selected}</option>
          ) : null}
          {selection.options.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>
      <button className="primary-button" type="submit">View members</button>
    </form>
  );
}

function DataView({ value }: { value: unknown }) {
  const items = extractItems(value);
  if (!items.length) return <div className="p-5 text-sm text-(--muted)">No records.</div>;
  return <div className="divide-y divide-(--line)">{items.map((item, index) => <RecordRow item={item} key={recordKey(item, index)} />)}</div>;
}

function RecordRow({ item }: { item: unknown }) {
  if (!isRecord(item)) return <div className="p-5 text-sm">{display(item)}</div>;
  const entries = Object.entries(item).filter(([, value]) => isDisplayable(value));
  return (
    <div className="grid gap-3 px-5 py-4 sm:grid-cols-2 xl:grid-cols-3">
      {entries.map(([key, value]) => (
        <div className="min-w-0" key={key}>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-(--muted)">{humanize(key)}</p>
          <p className="mt-1 break-words text-sm font-medium">{display(value)}</p>
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
  return value == null || ["string", "number", "boolean"].includes(typeof value) ||
    (Array.isArray(value) && value.every((entry) => ["string", "number", "boolean"].includes(typeof entry)));
}

function display(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.map((entry) => display(entry)).join(", ") || "—";
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
