import type { ReactNode } from "react";
import {
  getAdminAgeChecks,
  getAdminAiSessions,
  getAdminAiToolCalls,
  getAdminAuditEvents,
  getAdminCarfReports,
  getAdminComplianceLedger,
  getAdminContent,
  getAdminDac7Reports,
  getAdminDataRequests,
  getAdminEvents,
  getAdminFeatureFlags,
  getAdminInvoices,
  getAdminLiveRooms,
  getAdminMediaAssets,
  getAdminMutualsSafety,
  getAdminNotificationHealth,
  getAdminOpsSummary,
  getAdminOrganizationMembers,
  getAdminOrganizations,
  getAdminPartnerCampaigns,
  getAdminPaymentIntents,
  getAdminProviderEvents,
  getAdminReceipts,
  getAdminReferralPrograms,
  getAdminReports,
  getAdminRefundDisputes,
  getAdminSupportCases,
  getAdminSupportPolicies,
  getAdminTierWaivers,
  getAdminTickets,
  getAdminUnlocks,
  getAdminUsers,
  getAdminVatDeterminations,
  getAdminIdentityChecks,
  type AdminAgeCheck,
  type AdminAiSession,
  type AdminAiToolCall,
  type AuditEvent,
  type AdminComplianceLedgerEntry,
  type AdminComplianceReport,
  type AdminContentItem,
  type AdminDataRequest,
  type AdminFeatureFlag,
  type AdminInvoice,
  type AdminIdentityCheck,
  type AdminLiveRoom,
  type AdminMediaAsset,
  type AdminMutualsSafety,
  type AdminNotificationHealth,
  type AdminOpsSummary,
  type AdminOrganization,
  type AdminOrganizationMember,
  type AdminPartnerCampaign,
  type AdminPage,
  type AdminPaymentIntent,
  type AdminProviderEvent,
  type AdminReceipt,
  type AdminReferralProgram,
  type AdminReport,
  type AdminRefundDispute,
  type AdminSupportCase,
  type AdminSupportPolicy,
  type AdminTierWaiver,
  type AdminUnlock,
  type AdminUser,
  type AdminVatDetermination,
  type ApiResult,
  type Event,
  type EventAccessPass
} from "@/api-client";

export default async function AdminPage() {
  const [
    summary,
    payments,
    unlocks,
    providerEvents,
    liveRooms,
    mediaAssets,
    ageChecks,
    identityChecks,
    aiSessions,
    aiToolCalls,
    auditEvents,
    notificationHealth,
    users,
    content,
    reports,
    complianceLedger,
    dac7Reports,
    carfReports,
    vatDeterminations,
    receipts,
    invoices,
    referralPrograms,
    partnerCampaigns,
    tierWaivers,
    organizations,
    organizationMembers,
    supportCases,
    supportPolicies,
    refundDisputes,
    dataRequests,
    events,
    tickets,
    mutualsSafety,
    featureFlags
  ] = await Promise.all([
    getAdminOpsSummary(),
    getAdminPaymentIntents(),
    getAdminUnlocks(),
    getAdminProviderEvents(),
    getAdminLiveRooms(),
    getAdminMediaAssets(),
    getAdminAgeChecks(),
    getAdminIdentityChecks(),
    getAdminAiSessions(),
    getAdminAiToolCalls(),
    getAdminAuditEvents(),
    getAdminNotificationHealth(),
    getAdminUsers(),
    getAdminContent(),
    getAdminReports(),
    getAdminComplianceLedger(),
    getAdminDac7Reports(),
    getAdminCarfReports(),
    getAdminVatDeterminations(),
    getAdminReceipts(),
    getAdminInvoices(),
    getAdminReferralPrograms(),
    getAdminPartnerCampaigns(),
    getAdminTierWaivers(),
    getAdminOrganizations(),
    getAdminOrganizationMembers("00000000-0000-4000-8000-000000000140"),
    getAdminSupportCases(),
    getAdminSupportPolicies(),
    getAdminRefundDisputes(),
    getAdminDataRequests(),
    getAdminEvents(),
    getAdminTickets(),
    getAdminMutualsSafety(),
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

            <Panel title="Users content and reports">
              <ModerationPanel users={users} content={content} reports={reports} />
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

            <Panel title="Referral governance">
              <ReferralGovernancePanel
                partnerCampaigns={partnerCampaigns}
                referralPrograms={referralPrograms}
                tierWaivers={tierWaivers}
              />
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

            <Panel title="Event Access ops">
              <EventAccessPanel events={events} tickets={tickets} />
            </Panel>

            <Panel title="Mutuals safety">
              <MutualsSafetyPanel mutualsSafety={mutualsSafety} />
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

            <Panel title="Audit log">
              <PageState result={auditEvents} emptyLabel="No audit events">
                {(page) => (
                  <div className="grid gap-2">
                    {page.items.map((event) => (
                      <AuditEventRow event={event} key={event.id} />
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

            <Panel title="Live and media providers">
              <LiveMediaProviderPanel liveRooms={liveRooms} mediaAssets={mediaAssets} />
            </Panel>

            <Panel title="Age and KYC providers">
              <AgeKycProviderPanel ageChecks={ageChecks} identityChecks={identityChecks} />
            </Panel>

            <Panel title="AI operations">
              <AiOperationsPanel aiSessions={aiSessions} aiToolCalls={aiToolCalls} />
            </Panel>

            <Panel title="VAT receipts and invoices">
              <VatReceiptPanel invoices={invoices} receipts={receipts} vatDeterminations={vatDeterminations} />
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

function MutualsSafetyPanel({ mutualsSafety }: { mutualsSafety: ApiResult<AdminMutualsSafety> }) {
  if (!mutualsSafety.ok) {
    return <UnavailableState result={mutualsSafety} />;
  }

  return (
    <div className="grid gap-2">
      <article className="grid gap-3 rounded border border-[var(--line)] bg-[var(--background)] p-3 text-sm md:grid-cols-3">
        <Fact label="Open reports" value={mutualsSafety.data.openReports.toString()} />
        <Fact label="Active Mutuals" value={mutualsSafety.data.activeMutuals.toString()} />
        <Fact label="Stale Mutuals" value={mutualsSafety.data.staleMutuals.toString()} />
      </article>
      <div className="rounded border border-[var(--line)] bg-[var(--background)] p-3 text-sm text-[var(--muted)]">
        Money never buys people, visibility, Mutuals, or social priority.
      </div>
    </div>
  );
}

function LiveMediaProviderPanel({
  liveRooms,
  mediaAssets
}: {
  liveRooms: ApiResult<AdminPage<AdminLiveRoom>>;
  mediaAssets: ApiResult<AdminPage<AdminMediaAsset>>;
}) {
  if (!liveRooms.ok) {
    return <UnavailableState result={liveRooms} />;
  }

  if (!mediaAssets.ok) {
    return <UnavailableState result={mediaAssets} />;
  }

  if (liveRooms.data.items.length === 0 && mediaAssets.data.items.length === 0) {
    return <EmptyState label="No live rooms or media assets" />;
  }

  return (
    <div className="grid gap-2">
      {liveRooms.data.items.map((room) => (
        <LiveProviderRow key={room.id} room={room} />
      ))}
      {mediaAssets.data.items.map((asset) => (
        <MediaProviderRow asset={asset} key={asset.id} />
      ))}
    </div>
  );
}

function AgeKycProviderPanel({
  ageChecks,
  identityChecks
}: {
  ageChecks: ApiResult<AdminPage<AdminAgeCheck>>;
  identityChecks: ApiResult<AdminPage<AdminIdentityCheck>>;
}) {
  if (!ageChecks.ok) {
    return <UnavailableState result={ageChecks} />;
  }

  if (!identityChecks.ok) {
    return <UnavailableState result={identityChecks} />;
  }

  if (ageChecks.data.items.length === 0 && identityChecks.data.items.length === 0) {
    return <EmptyState label="No age or identity checks" />;
  }

  return (
    <div className="grid gap-2">
      {ageChecks.data.items.map((check) => (
        <AgeCheckRow check={check} key={check.id} />
      ))}
      {identityChecks.data.items.map((check) => (
        <IdentityCheckRow check={check} key={check.id} />
      ))}
    </div>
  );
}

function AiOperationsPanel({
  aiSessions,
  aiToolCalls
}: {
  aiSessions: ApiResult<AdminPage<AdminAiSession>>;
  aiToolCalls: ApiResult<AdminPage<AdminAiToolCall>>;
}) {
  if (!aiSessions.ok) {
    return <UnavailableState result={aiSessions} />;
  }

  if (!aiToolCalls.ok) {
    return <UnavailableState result={aiToolCalls} />;
  }

  if (aiSessions.data.items.length === 0 && aiToolCalls.data.items.length === 0) {
    return <EmptyState label="No AI operations" />;
  }

  return (
    <div className="grid gap-2">
      {aiSessions.data.items.map((session) => (
        <AiSessionRow key={session.id} session={session} />
      ))}
      {aiToolCalls.data.items.map((toolCall) => (
        <AiToolCallRow key={toolCall.id} toolCall={toolCall} />
      ))}
    </div>
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

function ModerationPanel({
  content,
  reports,
  users
}: {
  content: ApiResult<AdminPage<AdminContentItem>>;
  reports: ApiResult<AdminPage<AdminReport>>;
  users: ApiResult<AdminPage<AdminUser>>;
}) {
  if (!users.ok) {
    return <UnavailableState result={users} />;
  }

  if (!content.ok) {
    return <UnavailableState result={content} />;
  }

  if (!reports.ok) {
    return <UnavailableState result={reports} />;
  }

  if (users.data.items.length === 0 && content.data.items.length === 0 && reports.data.items.length === 0) {
    return <EmptyState label="No users, content, or reports" />;
  }

  return (
    <div className="grid gap-2">
      {reports.data.items.map((report) => (
        <ReportQueueRow key={report.id} report={report} />
      ))}
      {content.data.items.map((item) => (
        <ContentQueueRow content={item} key={item.id} />
      ))}
      {users.data.items.map((user) => (
        <UserQueueRow key={user.id} user={user} />
      ))}
    </div>
  );
}

function EventAccessPanel({
  events,
  tickets
}: {
  events: ApiResult<AdminPage<Event>>;
  tickets: ApiResult<AdminPage<EventAccessPass>>;
}) {
  if (!events.ok) {
    return <UnavailableState result={events} />;
  }

  if (!tickets.ok) {
    return <UnavailableState result={tickets} />;
  }

  if (events.data.items.length === 0 && tickets.data.items.length === 0) {
    return <EmptyState label="No events or passes" />;
  }

  return (
    <div className="grid gap-2">
      {events.data.items.map((event) => (
        <EventOpsRow event={event} key={event.id} />
      ))}
      {tickets.data.items.map((ticket) => (
        <TicketOpsRow key={ticket.id} ticket={ticket} />
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

  const reports = [...dac7Reports.data.items, ...(carfReports.ok ? carfReports.data.items : [])];

  if (reports.length === 0 && carfReports.ok) {
    return <EmptyState label="No DAC7 or CARF reports" />;
  }

  return (
    <div className="grid gap-2">
      {reports.map((report) => (
        <ReportRow key={report.id} report={report} />
      ))}
      {!carfReports.ok ? <UnavailableState result={carfReports} /> : null}
    </div>
  );
}

function ReferralGovernancePanel({
  partnerCampaigns,
  referralPrograms,
  tierWaivers
}: {
  partnerCampaigns: ApiResult<AdminPage<AdminPartnerCampaign>>;
  referralPrograms: ApiResult<AdminPage<AdminReferralProgram>>;
  tierWaivers: ApiResult<AdminPage<AdminTierWaiver>>;
}) {
  if (!referralPrograms.ok) {
    return <UnavailableState result={referralPrograms} />;
  }

  if (!partnerCampaigns.ok) {
    return <UnavailableState result={partnerCampaigns} />;
  }

  if (!tierWaivers.ok) {
    return <UnavailableState result={tierWaivers} />;
  }

  if (
    referralPrograms.data.items.length === 0 &&
    partnerCampaigns.data.items.length === 0 &&
    tierWaivers.data.items.length === 0
  ) {
    return <EmptyState label="No referral governance records" />;
  }

  return (
    <div className="grid gap-2">
      {referralPrograms.data.items.map((program) => (
        <ReferralProgramRow key={program.id} program={program} />
      ))}
      {partnerCampaigns.data.items.map((campaign) => (
        <PartnerCampaignRow campaign={campaign} key={campaign.id} />
      ))}
      {tierWaivers.data.items.map((waiver) => (
        <TierWaiverRow key={waiver.id} waiver={waiver} />
      ))}
    </div>
  );
}

function VatReceiptPanel({
  invoices,
  receipts,
  vatDeterminations
}: {
  invoices: ApiResult<AdminPage<AdminInvoice>>;
  receipts: ApiResult<AdminPage<AdminReceipt>>;
  vatDeterminations: ApiResult<AdminPage<AdminVatDetermination>>;
}) {
  if (!vatDeterminations.ok) {
    return <UnavailableState result={vatDeterminations} />;
  }

  if (!receipts.ok) {
    return <UnavailableState result={receipts} />;
  }

  if (!invoices.ok) {
    return <UnavailableState result={invoices} />;
  }

  if (
    vatDeterminations.data.items.length === 0 &&
    receipts.data.items.length === 0 &&
    invoices.data.items.length === 0
  ) {
    return <EmptyState label="No VAT determinations, receipts, or invoices" />;
  }

  return (
    <div className="grid gap-2">
      {vatDeterminations.data.items.map((determination) => (
        <VatRow determination={determination} key={determination.id} />
      ))}
      {receipts.data.items.map((receipt) => (
        <ReceiptRow key={receipt.id} receipt={receipt} />
      ))}
      {invoices.data.items.map((invoice) => (
        <InvoiceRow invoice={invoice} key={invoice.id} />
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

function UserQueueRow({ user }: { user: AdminUser }) {
  return (
    <article className="grid gap-3 rounded border border-[var(--line)] bg-[var(--background)] p-3 text-sm md:grid-cols-[1fr_130px_190px]">
      <div className="min-w-0">
        <p className="font-medium">@{user.handle}</p>
        <p className="mt-1 truncate text-[var(--muted)]">{user.id}</p>
      </div>
      <Fact label="Age" value={user.ageState} />
      <Fact label="Wallet" value={user.walletState.connected ? "connected" : "missing"} />
    </article>
  );
}

function ContentQueueRow({ content }: { content: AdminContentItem }) {
  return (
    <article className="grid gap-3 rounded border border-[var(--line)] bg-[var(--background)] p-3 text-sm md:grid-cols-[1fr_130px_190px]">
      <div className="min-w-0">
        <p className="font-medium">@{content.creator.handle}</p>
        <p className="mt-1 truncate text-[var(--muted)]">{content.id}</p>
      </div>
      <Fact label="Moderation" value={content.moderationState} />
      <Fact label="State" value={content.state} />
    </article>
  );
}

function ReportQueueRow({ report }: { report: AdminReport }) {
  return (
    <article className="grid gap-3 rounded border border-[var(--line)] bg-[var(--background)] p-3 text-sm md:grid-cols-[1fr_130px_190px]">
      <div className="min-w-0">
        <p className="font-medium">{report.subjectType}</p>
        <p className="mt-1 truncate text-[var(--muted)]">{report.reason}</p>
      </div>
      <Fact label="State" value={report.state} />
      <Fact label="Subject" value={report.subjectId ?? "none"} />
    </article>
  );
}

function EventOpsRow({ event }: { event: Event }) {
  const passCount = event.ticketTypes.reduce((total, ticketType) => total + ticketType.capacity - ticketType.remaining, 0);

  return (
    <article className="grid gap-3 rounded border border-[var(--line)] bg-[var(--background)] p-3 text-sm md:grid-cols-[1fr_130px_190px]">
      <div className="min-w-0">
        <p className="font-medium">{event.title}</p>
        <p className="mt-1 truncate text-[var(--muted)]">{event.id}</p>
      </div>
      <Fact label="State" value={event.state} />
      <Fact label="Issued" value={passCount.toString()} />
    </article>
  );
}

function TicketOpsRow({ ticket }: { ticket: EventAccessPass }) {
  return (
    <article className="grid gap-3 rounded border border-[var(--line)] bg-[var(--background)] p-3 text-sm md:grid-cols-[1fr_130px_190px]">
      <div className="min-w-0">
        <p className="font-medium">Event Access Pass</p>
        <p className="mt-1 truncate text-[var(--muted)]">{ticket.id}</p>
      </div>
      <Fact label="State" value={ticket.state} />
      <Fact label="Check-in" value={timestampLabel(ticket.checkedInAt ?? null)} />
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
        <Fact label="Replay" value={event.latestReplayState ?? "none"} />
        <Fact label="Replay processed" value={formatDate(event.latestReplayProcessedAt ?? null)} />
      </div>
    </article>
  );
}

function LiveProviderRow({ room }: { room: AdminLiveRoom }) {
  return (
    <article className="rounded border border-[var(--line)] bg-[var(--background)] p-3 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{room.title}</p>
          <p className="mt-1 truncate text-[var(--muted)]">{room.providerStreamId ?? room.provider}</p>
        </div>
        <span className="rounded bg-[var(--accent-soft)] px-2 py-1 text-xs font-medium text-[var(--accent-strong)]">
          {room.state}
        </span>
      </div>
      <div className="mt-3 grid gap-2">
        <Fact label="Provider" value={room.providerState} />
        <Fact label="Playback URL" value={room.hasPlaybackUrl ? "present" : "none"} />
        <Fact label="Stream key" value={room.hasHostStreamKey ? "redacted" : "none"} />
      </div>
    </article>
  );
}

function MediaProviderRow({ asset }: { asset: AdminMediaAsset }) {
  return (
    <article className="rounded border border-[var(--line)] bg-[var(--background)] p-3 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{asset.provider}</p>
          <p className="mt-1 truncate text-[var(--muted)]">{asset.providerAssetId}</p>
        </div>
        <span className="rounded bg-[var(--accent-soft)] px-2 py-1 text-xs font-medium text-[var(--accent-strong)]">
          {asset.providerState}
        </span>
      </div>
      <div className="mt-3 grid gap-2">
        <Fact label="Playable" value={asset.providerPlayable ? "yes" : "no"} />
        <Fact label="Playback URL" value={asset.hasPlaybackUrl ? "present" : "none"} />
        <Fact label="Checked" value={timestampLabel(asset.providerCheckedAt ?? null)} />
      </div>
    </article>
  );
}

function AgeCheckRow({ check }: { check: AdminAgeCheck }) {
  return (
    <article className="rounded border border-[var(--line)] bg-[var(--background)] p-3 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">Age assurance</p>
          <p className="mt-1 truncate text-[var(--muted)]">{check.provider}</p>
        </div>
        <span className="rounded bg-[var(--accent-soft)] px-2 py-1 text-xs font-medium text-[var(--accent-strong)]">
          {check.state}
        </span>
      </div>
      <div className="mt-3 grid gap-2">
        <Fact label="Jurisdiction" value={check.jurisdiction ?? "unknown"} />
        <Fact label="Provider ref" value={check.hasProviderReference ? "present" : "none"} />
        <Fact label="Boundary" value="no raw identity" />
      </div>
    </article>
  );
}

function IdentityCheckRow({ check }: { check: AdminIdentityCheck }) {
  return (
    <article className="rounded border border-[var(--line)] bg-[var(--background)] p-3 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{check.verificationType.toUpperCase()}</p>
          <p className="mt-1 truncate text-[var(--muted)]">{check.provider}</p>
        </div>
        <span className="rounded bg-[var(--accent-soft)] px-2 py-1 text-xs font-medium text-[var(--accent-strong)]">
          {check.state}
        </span>
      </div>
      <div className="mt-3 grid gap-2">
        <Fact label="Country" value={check.countryCode ?? "unknown"} />
        <Fact label="Legal name" value={check.hasLegalNameHash ? "hashed" : "none"} />
        <Fact label="Boundary" value="no raw documents" />
      </div>
    </article>
  );
}

function AiSessionRow({ session }: { session: AdminAiSession }) {
  return (
    <article className="rounded border border-[var(--line)] bg-[var(--background)] p-3 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{session.scope}</p>
          <p className="mt-1 truncate text-[var(--muted)]">{session.actorUserId}</p>
        </div>
        <span className="rounded bg-[var(--accent-soft)] px-2 py-1 text-xs font-medium text-[var(--accent-strong)]">
          {session.state}
        </span>
      </div>
      <div className="mt-3 grid gap-2">
        <Fact label="Tools" value={session.allowedToolCount.toString()} />
        <Fact label="Expires" value={timestampLabel(session.expiresAt)} />
      </div>
    </article>
  );
}

function AiToolCallRow({ toolCall }: { toolCall: AdminAiToolCall }) {
  return (
    <article className="rounded border border-[var(--line)] bg-[var(--background)] p-3 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{toolCall.toolName}</p>
          <p className="mt-1 truncate text-[var(--muted)]">{toolCall.inputSummary}</p>
        </div>
        <span className="rounded bg-[var(--accent-soft)] px-2 py-1 text-xs font-medium text-[var(--accent-strong)]">
          {toolCall.state}
        </span>
      </div>
      <div className="mt-3 grid gap-2">
        <Fact label="Confirm" value={toolCall.confirmationState} />
        <Fact label="Subject" value={toolCall.subjectType ?? "none"} />
        <Fact label="Boundary" value="summaries only" />
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

function AuditEventRow({ event }: { event: AuditEvent }) {
  return (
    <article className="grid gap-3 rounded border border-[var(--line)] bg-[var(--background)] p-3 text-sm md:grid-cols-[1fr_130px_180px]">
      <div className="min-w-0">
        <p className="font-medium">{event.action}</p>
        <p className="mt-1 truncate text-[var(--muted)]">{event.id}</p>
      </div>
      <Fact label="Subject" value={event.subjectType} />
      <Fact label="Created" value={timestampLabel(event.createdAt)} />
    </article>
  );
}

function ReferralProgramRow({ program }: { program: AdminReferralProgram }) {
  return (
    <article className="grid gap-3 rounded border border-[var(--line)] bg-[var(--background)] p-3 text-sm md:grid-cols-[1fr_130px_190px]">
      <div className="min-w-0">
        <p className="font-medium">{program.name}</p>
        <p className="mt-1 truncate text-[var(--muted)]">{program.priority}</p>
      </div>
      <Fact label="State" value={program.state} />
      <Fact label="Source" value={program.commissionSource ?? "platform commission"} />
    </article>
  );
}

function PartnerCampaignRow({ campaign }: { campaign: AdminPartnerCampaign }) {
  return (
    <article className="grid gap-3 rounded border border-[var(--line)] bg-[var(--background)] p-3 text-sm md:grid-cols-[1fr_130px_190px]">
      <div className="min-w-0">
        <p className="font-medium">{campaign.name}</p>
        <p className="mt-1 truncate text-[var(--muted)]">{campaign.partnerName}</p>
      </div>
      <Fact label="State" value={campaign.state} />
      <Fact label="Boundary" value="no social priority" />
    </article>
  );
}

function TierWaiverRow({ waiver }: { waiver: AdminTierWaiver }) {
  return (
    <article className="grid gap-3 rounded border border-[var(--line)] bg-[var(--background)] p-3 text-sm md:grid-cols-[1fr_130px_190px]">
      <div className="min-w-0">
        <p className="font-medium">{waiver.tierKey}</p>
        <p className="mt-1 truncate text-[var(--muted)]">{waiver.subjectType}</p>
      </div>
      <Fact label="State" value={waiver.state} />
      <Fact label="Ends" value={timestampLabel(waiver.endsAt ?? null)} />
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

function InvoiceRow({ invoice }: { invoice: AdminInvoice }) {
  return (
    <article className="rounded border border-[var(--line)] bg-[var(--background)] p-3 text-sm">
      <p className="font-medium">{invoice.invoiceNumber}</p>
      <div className="mt-3 grid gap-2">
        <Fact label="Seller of record" value={invoice.sellerOfRecord} />
        <Fact label="State" value={invoice.state} />
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
