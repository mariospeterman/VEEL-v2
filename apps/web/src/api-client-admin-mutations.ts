import { patchJson } from "./api-client-transport";
import type {
  AdminContentItem,
  AdminModerationActionRequest,
  AdminDataRequest,
  AdminDataRequestActionRequest,
  AdminFeatureFlag,
  AdminFeatureFlagPatchRequest,
  AdminOrganization,
  AdminOrganizationKybActionRequest,
  AdminOrganizationMember,
  AdminOrganizationMemberActionRequest,
  AdminRefundDispute,
  AdminRefundDisputeActionRequest,
  AdminSupportCase,
  AdminSupportCaseActionRequest,
  AdminSupportPolicy,
  AdminSupportPolicyActionRequest,
  ApiResult
} from "./api-client-types";

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
