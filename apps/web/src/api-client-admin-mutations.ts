import { patchJson, postEmpty, postJson } from "./api-client-transport";
import type {
  AdminContentItem,
  AdminLiveRoomSuspensionRequest,
  AdminModerationActionRequest,
  AdminDataRequest,
  AdminDataRequestActionRequest,
  AdminFeatureFlag,
  AdminFeatureFlagPatchRequest,
  AdminPaymentCommercialPolicy,
  AdminPaymentCommercialPolicyPatchRequest,
  AdminOrganization,
  AdminOrganizationKybActionRequest,
  AdminOrganizationProvisionRequest,
  AdminOrganizationMember,
  AdminOrganizationMemberActionRequest,
  AdminRefundDispute,
  AdminRefundDisputeActionRequest,
  AdminSupportCase,
  AdminSupportCaseActionRequest,
  AdminSupportPolicy,
  AdminSupportPolicyActionRequest,
  AdminStaffInvitationRequest,
  AdminStaffMembershipActionRequest,
  AdminStaffMember,
  StaffInvitation,
  AnalyticsProjectionJobReceipt,
  AnalyticsProjectionJobRequest,
  ApiResult
} from "./api-client-types";

export async function inviteAdminStaff(
  body: AdminStaffInvitationRequest,
  idempotencyKey: string
): Promise<ApiResult<StaffInvitation>> {
  return postJson<StaffInvitation>("/v1/admin/staff/invitations", body, idempotencyKey);
}

export async function updateAdminStaffMembership(
  membershipId: string,
  body: AdminStaffMembershipActionRequest,
  idempotencyKey: string
): Promise<ApiResult<AdminStaffMember>> {
  return patchJson<AdminStaffMember>(
    `/v1/admin/staff/memberships/${encodeURIComponent(membershipId)}`,
    body,
    idempotencyKey
  );
}

export async function enqueueAdminAnalyticsJob(
  body: AnalyticsProjectionJobRequest,
  idempotencyKey: string
): Promise<ApiResult<AnalyticsProjectionJobReceipt>> {
  return postJson<AnalyticsProjectionJobReceipt>("/v1/admin/analytics/jobs", body, idempotencyKey);
}

export async function provisionAdminOrganization(
  body: AdminOrganizationProvisionRequest,
  idempotencyKey: string
): Promise<ApiResult<AdminOrganization>> {
  return postJson<AdminOrganization>("/v1/admin/organizations", body, idempotencyKey);
}

export async function updateAdminLiveRoomSuspension(
  roomId: string,
  body: AdminLiveRoomSuspensionRequest,
  idempotencyKey: string
): Promise<ApiResult<null>> {
  return postEmpty(
    `/v1/admin/live/rooms/${encodeURIComponent(roomId)}/suspension`,
    body,
    idempotencyKey
  );
}

export async function updateAdminContentModeration(
  contentId: string,
  body: AdminModerationActionRequest,
  idempotencyKey: string
): Promise<ApiResult<AdminContentItem>> {
  return patchJson<AdminContentItem>(
    `/v1/admin/content/${encodeURIComponent(contentId)}/moderation`,
    body,
    idempotencyKey
  );
}

export async function updateAdminOrganizationKyb(
  organizationId: string,
  body: AdminOrganizationKybActionRequest,
  idempotencyKey: string
): Promise<ApiResult<AdminOrganization>> {
  return patchJson<AdminOrganization>(
    `/v1/admin/organizations/${encodeURIComponent(organizationId)}/kyb`,
    body,
    idempotencyKey
  );
}

export async function updateAdminOrganizationMember(
  organizationId: string,
  membershipId: string,
  body: AdminOrganizationMemberActionRequest,
  idempotencyKey: string
): Promise<ApiResult<AdminOrganizationMember>> {
  return patchJson<AdminOrganizationMember>(
    `/v1/admin/organizations/${encodeURIComponent(organizationId)}/members/${encodeURIComponent(membershipId)}`,
    body,
    idempotencyKey
  );
}

export async function updateAdminSupportPolicy(
  supportPolicyId: string,
  body: AdminSupportPolicyActionRequest,
  idempotencyKey: string
): Promise<ApiResult<AdminSupportPolicy>> {
  return patchJson<AdminSupportPolicy>(
    `/v1/admin/support/policies/${encodeURIComponent(supportPolicyId)}`,
    body,
    idempotencyKey
  );
}

export async function updateAdminSupportCase(
  supportCaseId: string,
  body: AdminSupportCaseActionRequest,
  idempotencyKey: string
): Promise<ApiResult<AdminSupportCase>> {
  return patchJson<AdminSupportCase>(
    `/v1/admin/support/cases/${encodeURIComponent(supportCaseId)}`,
    body,
    idempotencyKey
  );
}

export async function updateAdminRefundDispute(
  refundDisputeId: string,
  body: AdminRefundDisputeActionRequest,
  idempotencyKey: string
): Promise<ApiResult<AdminRefundDispute>> {
  return patchJson<AdminRefundDispute>(
    `/v1/admin/refunds/disputes/${encodeURIComponent(refundDisputeId)}`,
    body,
    idempotencyKey
  );
}

export async function updateAdminDataRequest(
  dataRequestId: string,
  body: AdminDataRequestActionRequest,
  idempotencyKey: string
): Promise<ApiResult<AdminDataRequest>> {
  return patchJson<AdminDataRequest>(
    `/v1/admin/data-requests/${encodeURIComponent(dataRequestId)}`,
    body,
    idempotencyKey
  );
}

export async function updateAdminFeatureFlag(
  featureFlagKey: string,
  body: AdminFeatureFlagPatchRequest,
  idempotencyKey: string
): Promise<ApiResult<AdminFeatureFlag>> {
  return patchJson<AdminFeatureFlag>(
    `/v1/admin/feature-flags/${encodeURIComponent(featureFlagKey)}`,
    body,
    idempotencyKey
  );
}

export async function updateAdminPaymentCommercialPolicy(
  productType: AdminPaymentCommercialPolicy["productType"],
  currency: AdminPaymentCommercialPolicy["currency"],
  body: AdminPaymentCommercialPolicyPatchRequest,
  idempotencyKey: string
): Promise<ApiResult<AdminPaymentCommercialPolicy>> {
  return patchJson<AdminPaymentCommercialPolicy>(
    `/v1/admin/payments/commercial-policies/${encodeURIComponent(productType)}/${encodeURIComponent(currency)}`,
    body,
    idempotencyKey
  );
}

export async function retryAdminProviderEventReplay(
  replayRequestId: string,
  reason: string,
  idempotencyKey: string
): Promise<ApiResult<null>> {
  return postEmpty(
    `/v1/admin/worker-queues/provider_event_replays/jobs/${encodeURIComponent(replayRequestId)}/retry`,
    { reason },
    idempotencyKey
  );
}
