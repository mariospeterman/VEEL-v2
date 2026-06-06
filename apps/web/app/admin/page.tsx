import type { ReactNode } from "react";
import {
  getAdminCarfReports,
  getAdminComplianceLedger,
  getAdminDac7Reports,
  getAdminDataRequests,
  getAdminFeatureFlags,
  getAdminNotificationHealth,
  getAdminOpsSummary,
  getAdminOrganizationMembers,
  getAdminOrganizations,
  getAdminPaymentIntents,
  getAdminProviderEvents,
  getAdminReceipts,
  getAdminRefundDisputes,
  getAdminSupportCases,
  getAdminSupportPolicies,
  getAdminUnlocks,
  getAdminVatDeterminations,
  type AdminComplianceLedgerEntry,
  type AdminComplianceReport,
  type AdminDataRequest,
  type AdminFeatureFlag,
  type AdminNotificationHealth,
  type AdminOpsSummary,
  type AdminOrganization,
  type AdminOrganizationMember,
  type AdminPage,
  type AdminPaymentIntent,
  type AdminProviderEvent,
  type AdminReceipt,
  type AdminRefundDispute,
  type AdminSupportCase,
  type AdminSupportPolicy,
  type AdminUnlock,
  type AdminVatDetermination,
  type ApiResult
} from "@/api-client";

export default async function AdminPage() {
  const [
    summary,
    payments,
    unlocks,
    providerEvents,
    notificationHealth,
    complianceLedger,
    dac7Reports,
    carfReports,
    vatDeterminations,
    receipts,
    organizations,
    organizationMembers,
    supportCases,
    supportPolicies,
    refundDisputes,
    dataRequests,
    featureFlags
  ] = await Promise.all([
    getAdminOpsSummary(),
    getAdminPaymentIntents(),
    getAdminUnlocks(),
    getAdminProviderEvents(),
    getAdminNotificationHealth(),
    getAdminComplianceLedger(),
    getAdminDac7Reports(),
    getAdminCarfReports(),
    getAdminVatDeterminations(),
    getAdminReceipts(),
    getAdminOrganizations(),
    getAdminOrganizationMembers("00000000-0000-4000-8000-000000000140"),
    getAdminSupportCases(),
    getAdminSupportPolicies(),
    getAdminRefundDisputes(),
    getAdminDataRequests(),
    getAdminFeatureFlags()
  ]);

  return (
    <main className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <nav className="mx-auto flex w-full max-w-7xl items-center justify-between border-b border-[var(--line)] px-5 py-4">
        <a className="text-lg font-semibold tracking-normal" href="/">
          VEEL
        </a>
        <div className="rounded border border-[var(--line)] px-3 py-1 text-xs font-medium text-[var(--muted)]">
          Admin
        </div>
      </nav>

      <section className="mx-auto grid w-full max-w-7xl gap-5 px-5 py-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-[var(--accent)]">Admin ops</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-normal">Payments and unlocks</h1>
          </div>
          <SummaryMetrics summary={summary} />
        </div>

        <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="grid content-start gap-4">
            <Panel title="Payments">
              <PageState result={payments} emptyLabel="No payment intents">
                {(page) => (
                  <div className="grid gap-2">
                    {page.items.map((payment) => (
                      <PaymentRow payment={payment} key={payment.id} />
                    ))}
                  </div>
                )}
              </PageState>
            </Panel>

            <Panel title="Unlocks">
              <PageState result={unlocks} emptyLabel="No unlock records">
                {(page) => (
                  <div className="grid gap-2">
                    {page.items.map((unlock) => (
                      <UnlockRow key={unlock.id} unlock={unlock} />
                    ))}
                  </div>
                )}
              </PageState>
            </Panel>

            <Panel title="Compliance ledger">
              <PageState result={complianceLedger} emptyLabel="No compliance ledger entries">
                {(page) => (
                  <div className="grid gap-2">
                    {page.items.map((entry) => (
                      <ComplianceRow entry={entry} key={entry.id} />
                    ))}
                  </div>
                )}
              </PageState>
            </Panel>

            <Panel title="DAC7 and CARF reports">
              <ReportPanel dac7Reports={dac7Reports} carfReports={carfReports} />
            </Panel>

            <Panel title="Organizations and KYB">
              <OrganizationPanel organizations={organizations} organizationMembers={organizationMembers} />
            </Panel>

            <Panel title="Support policy">
              <SupportPanel supportCases={supportCases} supportPolicies={supportPolicies} />
            </Panel>

            <Panel title="Refunds and disputes">
              <PageState result={refundDisputes} emptyLabel="No refund or dispute requests">
                {(page) => (
                  <div className="grid gap-2">
                    {page.items.map((dispute) => (
                      <RefundDisputeRow dispute={dispute} key={dispute.id} />
                    ))}
                  </div>
                )}
              </PageState>
            </Panel>

            <Panel title="Data requests">
              <PageState result={dataRequests} emptyLabel="No data requests">
                {(page) => (
                  <div className="grid gap-2">
                    {page.items.map((request) => (
                      <DataRequestRow key={request.id} request={request} />
                    ))}
                  </div>
                )}
              </PageState>
            </Panel>
          </div>

          <div className="grid content-start gap-4">
            <Panel title="Notification health">
              <NotificationHealthPanel notificationHealth={notificationHealth} />
            </Panel>

            <Panel title="Provider events">
              <PageState result={providerEvents} emptyLabel="No provider events">
                {(page) => (
                  <div className="grid gap-2">
                    {page.items.map((event) => (
                      <ProviderEventRow event={event} key={event.id} />
                    ))}
                  </div>
                )}
              </PageState>
            </Panel>

            <Panel title="VAT and receipts">
              <VatReceiptPanel vatDeterminations={vatDeterminations} receipts={receipts} />
            </Panel>

            <Panel title="Feature flags">
              <PageState result={featureFlags} emptyLabel="No feature flags">
                {(page) => (
                  <div className="grid gap-2">
                    {page.items.map((flag) => (
                      <FeatureFlagRow flag={flag} key={flag.key} />
                    ))}
                  </div>
                )}
              </PageState>
            </Panel>
          </div>
        </section>
      </section>
    </main>
  );
}

function OrganizationPanel({
  organizationMembers,
  organizations
}: {
  organizationMembers: ApiResult<AdminPage<AdminOrganizationMember>>;
  organizations: ApiResult<AdminPage<AdminOrganization>>;
}) {
  if (!organizations.ok) {
    return <UnavailableState result={organizations} />;
  }

  if (!organizationMembers.ok) {
    return <UnavailableState result={organizationMembers} />;
  }

  if (organizations.data.items.length === 0 && organizationMembers.data.items.length === 0) {
    return <EmptyState label="No organizations or members" />;
  }

  return (
    <div className="grid gap-2">
      {organizations.data.items.map((organization) => (
        <OrganizationRow key={organization.id} organization={organization} />
      ))}
      {organizationMembers.data.items.map((member) => (
        <OrganizationMemberRow key={member.id} member={member} />
      ))}
    </div>
  );
}

function SupportPanel({
  supportCases,
  supportPolicies
}: {
  supportCases: ApiResult<AdminPage<AdminSupportCase>>;
  supportPolicies: ApiResult<AdminPage<AdminSupportPolicy>>;
}) {
  if (!supportCases.ok) {
    return <UnavailableState result={supportCases} />;
  }

  if (!supportPolicies.ok) {
    return <UnavailableState result={supportPolicies} />;
  }

  if (supportCases.data.items.length === 0 && supportPolicies.data.items.length === 0) {
    return <EmptyState label="No support cases or policies" />;
  }

  return (
    <div className="grid gap-2">
      {supportPolicies.data.items.map((policy) => (
        <SupportPolicyRow key={policy.id} policy={policy} />
      ))}
      {supportCases.data.items.map((supportCase) => (
        <SupportCaseRow key={supportCase.id} supportCase={supportCase} />
      ))}
    </div>
  );
}

function SummaryMetrics({ summary }: { summary: ApiResult<AdminOpsSummary> }) {
  if (!summary.ok) {
    return (
      <div className="rounded border border-[var(--line)] bg-[var(--panel)] px-3 py-2 text-sm">
        <p className="text-xs uppercase text-[var(--muted)]">Ops summary</p>
        <p className="mt-1 font-semibold tracking-normal">HTTP {summary.status}</p>
        <p className="mt-1 text-xs text-[var(--muted)]">{summary.message}</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
      <Metric label="Provider" value={summary.data.providerHealth} />
      <Metric label="Queue" value={summary.data.queueHealth} />
      <Metric label="Payments" value={summary.data.paymentCounts.total.toString()} />
      <Metric label="Unlocks" value={summary.data.unlockCounts.total.toString()} />
    </div>
  );
}

function NotificationHealthPanel({
  notificationHealth
}: {
  notificationHealth: ApiResult<AdminNotificationHealth>;
}) {
  if (!notificationHealth.ok) {
    return <UnavailableState result={notificationHealth} />;
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
      <Fact label="Unread" value={notificationHealth.data.unreadCount.toString()} />
      <Fact label="Read" value={notificationHealth.data.readCount.toString()} />
      <Fact label="Archived" value={notificationHealth.data.archivedCount.toString()} />
      <Fact label="Active devices" value={notificationHealth.data.activeDeviceCount.toString()} />
      <Fact label="Revoked devices" value={notificationHealth.data.revokedDeviceCount.toString()} />
      <Fact label="Push enabled" value={notificationHealth.data.pushEnabledPreferenceCount.toString()} />
      <Fact label="Delivery queued" value={notificationHealth.data.queuedDeliveryCount.toString()} />
      <Fact label="Delivery leased" value={notificationHealth.data.leasedDeliveryCount.toString()} />
      <Fact label="Delivered" value={notificationHealth.data.deliveredDeliveryCount.toString()} />
      <Fact label="Delivery failed" value={notificationHealth.data.failedDeliveryCount.toString()} />
      <Fact label="Delivery skipped" value={notificationHealth.data.skippedDeliveryCount.toString()} />
      <Fact label="Delivery revoked" value={notificationHealth.data.revokedDeliveryCount.toString()} />
      <Fact label="Latest notification" value={timestampLabel(notificationHealth.data.latestNotificationAt)} />
      <Fact label="Latest device seen" value={timestampLabel(notificationHealth.data.latestDeviceSeenAt)} />
      <Fact label="Latest delivery" value={timestampLabel(notificationHealth.data.latestDeliveryAt)} />
    </div>
  );
}

function ReportPanel({
  carfReports,
  dac7Reports
}: {
  carfReports: ApiResult<AdminPage<AdminComplianceReport>>;
  dac7Reports: ApiResult<AdminPage<AdminComplianceReport>>;
}) {
  if (!dac7Reports.ok) {
    return <UnavailableState result={dac7Reports} />;
  }

  if (!carfReports.ok) {
    return <UnavailableState result={carfReports} />;
  }

  const reports = [...dac7Reports.data.items, ...carfReports.data.items];

  if (reports.length === 0) {
    return <EmptyState label="No DAC7 or CARF reports" />;
  }

  return (
    <div className="grid gap-2">
      {reports.map((report) => (
        <ReportRow key={report.id} report={report} />
      ))}
    </div>
  );
}

function VatReceiptPanel({
  receipts,
  vatDeterminations
}: {
  receipts: ApiResult<AdminPage<AdminReceipt>>;
  vatDeterminations: ApiResult<AdminPage<AdminVatDetermination>>;
}) {
  if (!vatDeterminations.ok) {
    return <UnavailableState result={vatDeterminations} />;
  }

  if (!receipts.ok) {
    return <UnavailableState result={receipts} />;
  }

  if (vatDeterminations.data.items.length === 0 && receipts.data.items.length === 0) {
    return <EmptyState label="No VAT determinations or receipts" />;
  }

  return (
    <div className="grid gap-2">
      {vatDeterminations.data.items.map((determination) => (
        <VatRow determination={determination} key={determination.id} />
      ))}
      {receipts.data.items.map((receipt) => (
        <ReceiptRow key={receipt.id} receipt={receipt} />
      ))}
    </div>
  );
}

function PageState<T>({
  children,
  emptyLabel,
  result
}: {
  children: (page: AdminPage<T>) => ReactNode;
  emptyLabel: string;
  result: ApiResult<AdminPage<T>>;
}) {
  if (!result.ok) {
    return <UnavailableState result={result} />;
  }

  if (result.data.items.length === 0) {
    return <EmptyState label={emptyLabel} />;
  }

  return children(result.data);
}

function Panel({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section className="rounded border border-[var(--line)] bg-[var(--panel)] p-4">
      <h2 className="text-base font-semibold tracking-normal">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-[120px] rounded border border-[var(--line)] bg-[var(--panel)] px-3 py-2">
      <p className="text-xs uppercase text-[var(--muted)]">{label}</p>
      <p className="mt-1 font-semibold tracking-normal">{value}</p>
    </div>
  );
}

function PaymentRow({ payment }: { payment: AdminPaymentIntent }) {
  return (
    <article className="grid gap-3 rounded border border-[var(--line)] bg-[var(--background)] p-3 text-sm md:grid-cols-[1fr_120px_160px]">
      <div className="min-w-0">
        <p className="font-medium">{payment.productType}</p>
        <p className="mt-1 truncate text-[var(--muted)]">{shorten(payment.referenceAddress)}</p>
      </div>
      <Fact label="State" value={payment.state} />
      <Fact label="Settlement attempts" value={(payment.settlementAttemptCount ?? 0).toString()} />
    </article>
  );
}

function UnlockRow({ unlock }: { unlock: AdminUnlock }) {
  return (
    <article className="grid gap-3 rounded border border-[var(--line)] bg-[var(--background)] p-3 text-sm md:grid-cols-[1fr_120px_160px]">
      <div className="min-w-0">
        <p className="font-medium">{unlock.productType}</p>
        <p className="mt-1 truncate text-[var(--muted)]">{unlock.targetId}</p>
      </div>
      <Fact label="State" value={unlock.state} />
      <Fact label="Target" value={unlock.targetType} />
    </article>
  );
}

function ProviderEventRow({ event }: { event: AdminProviderEvent }) {
  return (
    <article className="rounded border border-[var(--line)] bg-[var(--background)] p-3 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{event.provider}</p>
          <p className="mt-1 truncate text-[var(--muted)]">{event.eventType}</p>
        </div>
        <span className="rounded bg-[var(--accent-soft)] px-2 py-1 text-xs font-medium text-[var(--accent-strong)]">
          {event.state}
        </span>
      </div>
      <div className="mt-3 grid gap-2">
        <Fact label="Received" value={formatDate(event.receivedAt)} />
        <Fact label="Processed" value={formatDate(event.processedAt ?? null)} />
      </div>
    </article>
  );
}

function ComplianceRow({ entry }: { entry: AdminComplianceLedgerEntry }) {
  return (
    <article className="grid gap-3 rounded border border-[var(--line)] bg-[var(--background)] p-3 text-sm md:grid-cols-[1fr_120px_160px]">
      <div className="min-w-0">
        <p className="font-medium">{entry.productType}</p>
        <p className="mt-1 truncate text-[var(--muted)]">{entry.eventType}</p>
      </div>
      <Fact label="VAT" value={entry.vatStatus} />
      <Fact label="DAC7" value={entry.dac7Reportable ? "reportable" : "not reportable"} />
    </article>
  );
}

function ReportRow({ report }: { report: AdminComplianceReport }) {
  return (
    <article className="grid gap-3 rounded border border-[var(--line)] bg-[var(--background)] p-3 text-sm md:grid-cols-[1fr_120px_160px]">
      <div className="min-w-0">
        <p className="font-medium">{report.reportType.toUpperCase()}</p>
        <p className="mt-1 truncate text-[var(--muted)]">{report.reportingYear}</p>
      </div>
      <Fact label="State" value={report.state} />
      <Fact label="Lines" value={report.lineCount.toString()} />
    </article>
  );
}

function OrganizationRow({ organization }: { organization: AdminOrganization }) {
  return (
    <article className="grid gap-3 rounded border border-[var(--line)] bg-[var(--background)] p-3 text-sm md:grid-cols-[1fr_120px_160px]">
      <div className="min-w-0">
        <p className="font-medium">{organization.name}</p>
        <p className="mt-1 truncate text-[var(--muted)]">KYB {organization.kybState ?? "not_started"}</p>
      </div>
      <Fact label="State" value={organization.state} />
      <Fact label="Finance" value="no custody" />
    </article>
  );
}

function OrganizationMemberRow({ member }: { member: AdminOrganizationMember }) {
  return (
    <article className="grid gap-3 rounded border border-[var(--line)] bg-[var(--background)] p-3 text-sm md:grid-cols-[1fr_120px_160px]">
      <div className="min-w-0">
        <p className="font-medium">{member.role}</p>
        <p className="mt-1 truncate text-[var(--muted)]">{member.userId}</p>
      </div>
      <Fact label="State" value={member.state} />
      <Fact label="Social rank" value="not for sale" />
    </article>
  );
}

function SupportPolicyRow({ policy }: { policy: AdminSupportPolicy }) {
  return (
    <article className="grid gap-3 rounded border border-[var(--line)] bg-[var(--background)] p-3 text-sm md:grid-cols-[1fr_130px_180px]">
      <div className="min-w-0">
        <p className="font-medium">{policy.slaTier}</p>
        <p className="mt-1 truncate text-[var(--muted)]">{policy.organizationId}</p>
      </div>
      <Fact label="State" value={policy.state} />
      <Fact label="Boundary" value="software SLA only" />
    </article>
  );
}

function SupportCaseRow({ supportCase }: { supportCase: AdminSupportCase }) {
  return (
    <article className="grid gap-3 rounded border border-[var(--line)] bg-[var(--background)] p-3 text-sm md:grid-cols-[1fr_130px_180px]">
      <div className="min-w-0">
        <p className="font-medium">{supportCase.category}</p>
        <p className="mt-1 truncate text-[var(--muted)]">{supportCase.subjectType}</p>
      </div>
      <Fact label="State" value={supportCase.state} />
      <Fact label="Priority" value={supportCase.priority} />
    </article>
  );
}

function RefundDisputeRow({ dispute }: { dispute: AdminRefundDispute }) {
  return (
    <article className="grid gap-3 rounded border border-[var(--line)] bg-[var(--background)] p-3 text-sm md:grid-cols-[1fr_130px_190px]">
      <div className="min-w-0">
        <p className="font-medium">{dispute.kind}</p>
        <p className="mt-1 truncate text-[var(--muted)]">{dispute.paymentIntentId}</p>
      </div>
      <Fact label="State" value={dispute.state} />
      <Fact label="Boundary" value="no custody" />
    </article>
  );
}

function DataRequestRow({ request }: { request: AdminDataRequest }) {
  return (
    <article className="grid gap-3 rounded border border-[var(--line)] bg-[var(--background)] p-3 text-sm md:grid-cols-[1fr_130px_190px]">
      <div className="min-w-0">
        <p className="font-medium">{request.type}</p>
        <p className="mt-1 truncate text-[var(--muted)]">{request.requesterUserId}</p>
      </div>
      <Fact label="State" value={request.state} />
      <Fact label="Boundary" value="minimized" />
    </article>
  );
}

function FeatureFlagRow({ flag }: { flag: AdminFeatureFlag }) {
  return (
    <article className="rounded border border-[var(--line)] bg-[var(--background)] p-3 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{flag.key}</p>
          <p className="mt-1 truncate text-[var(--muted)]">{flag.category}</p>
        </div>
        <span className="rounded bg-[var(--accent-soft)] px-2 py-1 text-xs font-medium text-[var(--accent-strong)]">
          {flag.state}
        </span>
      </div>
      <div className="mt-3 grid gap-2">
        <Fact label="Boundary" value="software policy" />
      </div>
    </article>
  );
}

function VatRow({ determination }: { determination: AdminVatDetermination }) {
  return (
    <article className="rounded border border-[var(--line)] bg-[var(--background)] p-3 text-sm">
      <p className="font-medium">{determination.productType}</p>
      <div className="mt-3 grid gap-2">
        <Fact label="Seller" value={determination.sellerOfRecord} />
        <Fact label="VAT" value={determination.vatStatus} />
      </div>
    </article>
  );
}

function ReceiptRow({ receipt }: { receipt: AdminReceipt }) {
  return (
    <article className="rounded border border-[var(--line)] bg-[var(--background)] p-3 text-sm">
      <p className="font-medium">{receipt.receiptNumber}</p>
      <div className="mt-3 grid gap-2">
        <Fact label="Product" value={receipt.productType} />
        <Fact label="State" value={receipt.state} />
      </div>
    </article>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="rounded border border-[var(--line)] bg-[var(--background)] p-3 text-sm text-[var(--muted)]">
      {label}
    </div>
  );
}

function UnavailableState<T>({ result }: { result: Extract<ApiResult<T>, { ok: false }> }) {
  return (
    <div className="rounded border border-[var(--line)] bg-[var(--background)] p-3 text-sm">
      <p className="font-medium">Admin API unavailable</p>
      <p className="mt-1 text-[var(--muted)]">HTTP {result.status}</p>
      <p className="mt-1 text-[var(--muted)]">{result.message}</p>
    </div>
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

function timestampLabel(value: string | null) {
  return value ? new Date(value).toISOString() : "none";
}

function formatDate(value: string | null) {
  if (!value) {
    return "none";
  }

  return new Date(value).toISOString();
}

function shorten(value: string) {
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}
