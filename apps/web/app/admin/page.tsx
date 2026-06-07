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
  getAdminEventAccessPasses,
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
  getAdminUnlocks,
  getAdminUsers,
  getAdminVatDeterminations,
  getAdminIdentityChecks
} from "@/api-client";
import { requireConfiguredSession } from "@/supabase/route-guard";
import {
  AgeKycProviderPanel,
  AiOperationsPanel,
  AuditEventRow,
  ComplianceRow,
  DataRequestRow,
  EventAccessPanel,
  FeatureFlagRow,
  LiveMediaProviderPanel,
  ModerationPanel,
  MutualsSafetyPanel,
  NotificationHealthPanel,
  PageState,
  Panel,
  PaymentRow,
  ProviderEventsPanel,
  ReferralGovernancePanel,
  RefundDisputeRow,
  ReportPanel,
  SummaryMetrics,
  SupportPanel,
  UnlockRow,
  VatReceiptPanel,
  OrganizationPanel
} from "./admin-panels";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  await requireConfiguredSession("/admin");

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
    accessPasses,
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
    getAdminEventAccessPasses(),
    getAdminMutualsSafety(),
    getAdminFeatureFlags()
  ]);

  return (
    <main className="min-h-screen bg-(--background) text-(--foreground)">
      <nav className="mx-auto flex w-full max-w-7xl items-center justify-between border-b border-(--line) px-5 py-4">
        <a className="text-lg font-semibold tracking-normal" href="/">
          VEEL
        </a>
        <div className="rounded border border-(--line) px-3 py-1 text-xs font-medium text-(--muted)">
          Admin
        </div>
      </nav>

      <section className="mx-auto grid w-full max-w-7xl gap-5 px-5 py-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-(--accent)">Admin ops</p>
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
              <EventAccessPanel events={events} accessPasses={accessPasses} />
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
              <ProviderEventsPanel providerEvents={providerEvents} />
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
