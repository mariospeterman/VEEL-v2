import type { AdminPageData } from "./admin-data";
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
  OrganizationPanel,
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
  VatReceiptPanel
} from "./admin-panels";

export function AdminPageHeader({ summary }: Pick<AdminPageData, "summary">) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="text-sm font-medium text-(--accent)">Admin ops</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-normal">Payments and unlocks</h1>
      </div>
      <SummaryMetrics summary={summary} />
    </div>
  );
}

export function AdminPrimaryColumn({
  accessPasses,
  auditEvents,
  carfReports,
  complianceLedger,
  content,
  dac7Reports,
  dataRequests,
  events,
  mutualsSafety,
  organizationMembers,
  organizations,
  partnerCampaigns,
  payments,
  referralPrograms,
  refundDisputes,
  reports,
  supportCases,
  supportPolicies,
  tierWaivers,
  unlocks,
  users
}: AdminPageData) {
  return (
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
  );
}

export function AdminSecondaryColumn({
  ageChecks,
  aiSessions,
  aiToolCalls,
  featureFlags,
  identityChecks,
  invoices,
  liveRooms,
  mediaAssets,
  notificationHealth,
  providerEvents,
  receipts,
  vatDeterminations
}: AdminPageData) {
  return (
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
  );
}
