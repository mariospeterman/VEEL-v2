import type {
  AdminOrganization,
  AdminOrganizationMember,
  AdminPartnerCampaign,
  AdminPage,
  AdminReferralProgram,
  AdminSupportCase,
  AdminSupportPolicy,
  AdminTierWaiver,
  ApiResult
} from "@/api-client";
import {
  EmptyState,
  UnavailableState,
  AdminReasonInput,
  AdminSubmit,
  AdminTextInput
} from "./admin-ui";
import { provisionOrganizationAction } from "./actions";
import {
  OrganizationMemberRow,
  OrganizationRow,
  PartnerCampaignRow,
  ReferralProgramRow,
  SupportCaseRow,
  SupportPolicyRow,
  TierWaiverRow
} from "./admin-rows";

export function OrganizationPanel({
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

  return (
    <div className="grid gap-2">
      <form action={provisionOrganizationAction} className="grid gap-2 rounded border border-(--line) bg-(--background) p-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
        <AdminTextInput name="name" placeholder="Organization name" />
        <AdminTextInput name="ownerHandle" placeholder="Existing WeVid handle" />
        <AdminReasonInput placeholder="Approved onboarding reason" />
        <AdminSubmit label="Invite owner" />
        <p className="text-xs text-(--muted) sm:col-span-4">
          Creates a pending-KYB organization and sends the existing account an owner invitation. Enterprise access is granted separately.
        </p>
      </form>
      {organizations.data.items.length === 0 && organizationMembers.data.items.length === 0 ? (
        <EmptyState label="No organizations or members" />
      ) : null}
      {organizations.data.items.map((organization) => (
        <OrganizationRow key={organization.id} organization={organization} />
      ))}
      {organizationMembers.data.items.map((member) => (
        <OrganizationMemberRow key={member.id} member={member} />
      ))}
    </div>
  );
}

export function SupportPanel({
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

export function ReferralGovernancePanel({
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
