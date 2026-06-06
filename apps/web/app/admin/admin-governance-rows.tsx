import type {
  AdminDataRequest,
  AdminFeatureFlag,
  AdminOrganization,
  AdminOrganizationMember,
  AdminPartnerCampaign,
  AdminReferralProgram,
  AdminRefundDispute,
  AdminSupportCase,
  AdminSupportPolicy,
  AdminTierWaiver
} from "@/api-client";
import {
  updateFeatureFlagAction,
  updateDataRequestAction,
  updateOrganizationKybAction,
  updateOrganizationMemberAction,
  updateRefundDisputeAction,
  updateSupportCaseAction,
  updateSupportPolicyAction
} from "./actions";
import {
  AdminJsonInput,
  AdminReasonInput,
  AdminSelect,
  AdminSubmit,
  AdminTextInput,
  Fact,
  timestampLabel
} from "./admin-ui";

export function OrganizationRow({ organization }: { organization: AdminOrganization }) {
  return (
    <article className="rounded border border-[var(--line)] bg-[var(--background)] p-3 text-sm">
      <div className="grid gap-3 md:grid-cols-[1fr_120px_160px]">
        <div className="min-w-0">
          <p className="font-medium">{organization.name}</p>
          <p className="mt-1 truncate text-[var(--muted)]">KYB {organization.kybState ?? "not_started"}</p>
        </div>
        <Fact label="State" value={organization.state} />
        <Fact label="Finance" value="no custody" />
      </div>
      <form action={updateOrganizationKybAction} className="mt-3 grid gap-2 border-t border-[var(--line)] pt-3 sm:grid-cols-[150px_1fr_auto]">
        <input name="organizationId" type="hidden" value={organization.id} />
        <AdminSelect defaultValue={organization.kybState ?? "not_started"} label="KYB" name="kybState">
          <option value="not_started">not started</option>
          <option value="pending">pending</option>
          <option value="verified">verified</option>
          <option value="rejected">rejected</option>
        </AdminSelect>
        <AdminReasonInput placeholder="Reason for KYB change" />
        <AdminSubmit label="Update KYB" />
      </form>
    </article>
  );
}

export function OrganizationMemberRow({ member }: { member: AdminOrganizationMember }) {
  return (
    <article className="rounded border border-[var(--line)] bg-[var(--background)] p-3 text-sm">
      <div className="grid gap-3 md:grid-cols-[1fr_120px_160px]">
        <div className="min-w-0">
          <p className="font-medium">{member.role}</p>
          <p className="mt-1 truncate text-[var(--muted)]">{member.userId}</p>
        </div>
        <Fact label="State" value={member.state} />
        <Fact label="Social rank" value="not for sale" />
      </div>
      <form action={updateOrganizationMemberAction} className="mt-3 grid gap-2 border-t border-[var(--line)] pt-3 sm:grid-cols-[130px_130px_1fr_auto]">
        <input name="organizationId" type="hidden" value={member.organizationId} />
        <input name="membershipId" type="hidden" value={member.id} />
        <AdminSelect defaultValue={member.role} label="Role" name="role">
          <option value="owner">owner</option>
          <option value="admin">admin</option>
          <option value="member">member</option>
          <option value="viewer">viewer</option>
        </AdminSelect>
        <AdminSelect defaultValue={member.state} label="State" name="state">
          <option value="invited">invited</option>
          <option value="active">active</option>
          <option value="suspended">suspended</option>
          <option value="removed">removed</option>
        </AdminSelect>
        <AdminReasonInput placeholder="Reason for member change" />
        <AdminSubmit label="Update member" />
      </form>
    </article>
  );
}

export function SupportPolicyRow({ policy }: { policy: AdminSupportPolicy }) {
  return (
    <article className="rounded border border-[var(--line)] bg-[var(--background)] p-3 text-sm">
      <div className="grid gap-3 md:grid-cols-[1fr_130px_180px]">
        <div className="min-w-0">
          <p className="font-medium">{policy.slaTier}</p>
          <p className="mt-1 truncate text-[var(--muted)]">{policy.organizationId}</p>
        </div>
        <Fact label="State" value={policy.state} />
        <Fact label="Boundary" value="software SLA only" />
      </div>
      <form action={updateSupportPolicyAction} className="mt-3 grid gap-2 border-t border-[var(--line)] pt-3 sm:grid-cols-[150px_150px_150px_1fr_auto]">
        <input name="supportPolicyId" type="hidden" value={policy.id} />
        <AdminSelect defaultValue={policy.supportState} label="Support" name="supportState">
          <option value="standard">standard</option>
          <option value="priority">priority</option>
          <option value="enterprise_review">enterprise review</option>
        </AdminSelect>
        <AdminSelect defaultValue={policy.slaTier} label="SLA" name="slaTier">
          <option value="standard">standard</option>
          <option value="priority">priority</option>
          <option value="enterprise_review">enterprise review</option>
        </AdminSelect>
        <AdminSelect defaultValue={policy.state} label="State" name="state">
          <option value="active">active</option>
          <option value="paused">paused</option>
          <option value="review_required">review required</option>
        </AdminSelect>
        <AdminReasonInput placeholder="Reason for support policy change" />
        <AdminSubmit label="Update policy" />
      </form>
    </article>
  );
}

export function SupportCaseRow({ supportCase }: { supportCase: AdminSupportCase }) {
  return (
    <article className="rounded border border-[var(--line)] bg-[var(--background)] p-3 text-sm">
      <div className="grid gap-3 md:grid-cols-[1fr_130px_180px]">
        <div className="min-w-0">
          <p className="font-medium">{supportCase.category}</p>
          <p className="mt-1 truncate text-[var(--muted)]">{supportCase.subjectType}</p>
        </div>
        <Fact label="State" value={supportCase.state} />
        <Fact label="Priority" value={supportCase.priority} />
      </div>
      <form action={updateSupportCaseAction} className="mt-3 grid gap-2 border-t border-[var(--line)] pt-3 sm:grid-cols-[150px_1fr_auto]">
        <input name="supportCaseId" type="hidden" value={supportCase.id} />
        <AdminSelect defaultValue={supportCase.state} label="State" name="state">
          <option value="open">open</option>
          <option value="pending_user">pending user</option>
          <option value="pending_internal">pending internal</option>
          <option value="resolved">resolved</option>
          <option value="closed">closed</option>
        </AdminSelect>
        <AdminReasonInput placeholder="Reason for support case change" />
        <AdminSubmit label="Update case" />
      </form>
    </article>
  );
}

export function RefundDisputeRow({ dispute }: { dispute: AdminRefundDispute }) {
  return (
    <article className="rounded border border-[var(--line)] bg-[var(--background)] p-3 text-sm">
      <div className="grid gap-3 md:grid-cols-[1fr_130px_190px]">
        <div className="min-w-0">
          <p className="font-medium">{dispute.kind}</p>
          <p className="mt-1 truncate text-[var(--muted)]">{dispute.paymentIntentId}</p>
        </div>
        <Fact label="State" value={dispute.state} />
        <Fact label="Boundary" value="no custody" />
      </div>
      <form action={updateRefundDisputeAction} className="mt-3 grid gap-2 border-t border-[var(--line)] pt-3 sm:grid-cols-[190px_1fr_1fr_auto]">
        <input name="refundDisputeId" type="hidden" value={dispute.id} />
        <AdminSelect defaultValue={dispute.state} label="State" name="state">
          <option value="opened">opened</option>
          <option value="reviewing">reviewing</option>
          <option value="creator_action_required">creator action required</option>
          <option value="rejected">rejected</option>
          <option value="withdrawn">withdrawn</option>
          <option value="resolved">resolved</option>
          <option value="closed">closed</option>
        </AdminSelect>
        <AdminTextInput name="resolution" placeholder="Resolution note" />
        <AdminReasonInput placeholder="Reason for refund/dispute review change" />
        <AdminSubmit label="Update review" />
      </form>
    </article>
  );
}

export function DataRequestRow({ request }: { request: AdminDataRequest }) {
  return (
    <article className="rounded border border-[var(--line)] bg-[var(--background)] p-3 text-sm">
      <div className="grid gap-3 md:grid-cols-[1fr_130px_190px]">
        <div className="min-w-0">
          <p className="font-medium">{request.type}</p>
          <p className="mt-1 truncate text-[var(--muted)]">{request.requesterUserId}</p>
        </div>
        <Fact label="State" value={request.state} />
        <Fact label="Boundary" value="minimized" />
      </div>
      <form action={updateDataRequestAction} className="mt-3 grid gap-2 border-t border-[var(--line)] pt-3 sm:grid-cols-[150px_1fr_auto]">
        <input name="dataRequestId" type="hidden" value={request.id} />
        <AdminSelect defaultValue={request.state === "requested" ? "verifying" : request.state} label="State" name="state">
          <option value="verifying">verifying</option>
          <option value="processing">processing</option>
          <option value="completed">completed</option>
          <option value="rejected">rejected</option>
        </AdminSelect>
        <AdminReasonInput placeholder="Reason for data request lifecycle change" />
        <AdminSubmit label="Update request" />
      </form>
    </article>
  );
}

export function FeatureFlagRow({ flag }: { flag: AdminFeatureFlag }) {
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
      <form action={updateFeatureFlagAction} className="mt-3 grid gap-2 border-t border-[var(--line)] pt-3">
        <input name="featureFlagKey" type="hidden" value={flag.key} />
        <AdminJsonInput defaultValue={JSON.stringify(flag.value, null, 2)} />
        <div className="grid gap-2 sm:grid-cols-[150px_1fr_auto]">
          <AdminSelect defaultValue={flag.state} label="State" name="state">
            <option value="active">active</option>
            <option value="paused">paused</option>
            <option value="archived">archived</option>
          </AdminSelect>
          <AdminReasonInput placeholder="Reason for feature policy change" />
          <AdminSubmit label="Update flag" />
        </div>
      </form>
    </article>
  );
}

export function ReferralProgramRow({ program }: { program: AdminReferralProgram }) {
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

export function PartnerCampaignRow({ campaign }: { campaign: AdminPartnerCampaign }) {
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

export function TierWaiverRow({ waiver }: { waiver: AdminTierWaiver }) {
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
