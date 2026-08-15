"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import {
  updateAdminOrganizationKyb,
  updateAdminContentModeration,
  updateAdminOrganizationMember,
  updateAdminDataRequest,
  updateAdminFeatureFlag,
  updateAdminRefundDispute,
  updateAdminSupportCase,
  updateAdminSupportPolicy,
  type AdminDataRequestActionRequest,
  type AdminModerationActionRequest,
  type AdminFeatureFlagPatchRequest,
  type AdminOrganizationKybActionRequest,
  type AdminOrganizationMemberActionRequest,
  type AdminRefundDisputeActionRequest,
  type AdminSupportCaseActionRequest,
  type AdminSupportPolicyActionRequest,
  type ApiResult
} from "@/api-client";

export async function updateContentModerationAction(formData: FormData): Promise<void> {
  const body: AdminModerationActionRequest = {
    action: enumField(formData, "action", ["approve", "request_changes", "restrict", "block", "delete", "reinstate"]),
    reason: stringField(formData, "reason")
  };
  const result = await updateAdminContentModeration(
    stringField(formData, "contentId"),
    body,
    randomUUID()
  );
  actionResult(result);
}

export async function updateOrganizationKybAction(formData: FormData): Promise<void> {
  const organizationId = stringField(formData, "organizationId");
  const body: AdminOrganizationKybActionRequest = {
    kybState: enumField(formData, "kybState", ["not_started", "pending", "verified", "rejected"]),
    reason: stringField(formData, "reason")
  };

  const result = await updateAdminOrganizationKyb(organizationId, body, randomUUID());
  actionResult(result);
}

export async function updateOrganizationMemberAction(formData: FormData): Promise<void> {
  const organizationId = stringField(formData, "organizationId");
  const membershipId = stringField(formData, "membershipId");
  const body: AdminOrganizationMemberActionRequest = {
    role: enumField(formData, "role", ["owner", "admin", "member", "viewer"]),
    state: enumField(formData, "state", ["invited", "active", "suspended", "removed"]),
    reason: stringField(formData, "reason")
  };

  const result = await updateAdminOrganizationMember(organizationId, membershipId, body, randomUUID());
  actionResult(result);
}

export async function updateSupportPolicyAction(formData: FormData): Promise<void> {
  const body: AdminSupportPolicyActionRequest = {
    supportState: enumField(formData, "supportState", ["standard", "priority", "enterprise_review"]),
    slaTier: enumField(formData, "slaTier", ["standard", "priority", "enterprise_review"]),
    state: enumField(formData, "state", ["active", "paused", "review_required"]),
    reason: stringField(formData, "reason")
  };

  const result = await updateAdminSupportPolicy(stringField(formData, "supportPolicyId"), body, randomUUID());
  actionResult(result);
}

export async function updateSupportCaseAction(formData: FormData): Promise<void> {
  const body: AdminSupportCaseActionRequest = {
    state: enumField(formData, "state", ["open", "pending_user", "pending_internal", "resolved", "closed"]),
    reason: stringField(formData, "reason")
  };

  const result = await updateAdminSupportCase(stringField(formData, "supportCaseId"), body, randomUUID());
  actionResult(result);
}

export async function updateRefundDisputeAction(formData: FormData): Promise<void> {
  const body: AdminRefundDisputeActionRequest = {
    state: enumField(formData, "state", [
      "opened",
      "reviewing",
      "creator_action_required",
      "rejected",
      "withdrawn",
      "resolved",
      "closed"
    ]),
    resolution: stringField(formData, "resolution"),
    reason: stringField(formData, "reason")
  };

  const result = await updateAdminRefundDispute(stringField(formData, "refundDisputeId"), body, randomUUID());
  actionResult(result);
}

export async function updateDataRequestAction(formData: FormData): Promise<void> {
  const body: AdminDataRequestActionRequest = {
    state: enumField(formData, "state", ["verifying", "processing", "completed", "rejected"]),
    reason: stringField(formData, "reason")
  };

  const result = await updateAdminDataRequest(stringField(formData, "dataRequestId"), body, randomUUID());
  actionResult(result);
}

export async function updateFeatureFlagAction(formData: FormData): Promise<void> {
  const body: AdminFeatureFlagPatchRequest = {
    value: jsonObjectField(formData, "value"),
    state: enumField(formData, "state", ["active", "paused", "archived"]),
    reason: stringField(formData, "reason")
  };

  const result = await updateAdminFeatureFlag(stringField(formData, "featureFlagKey"), body, randomUUID());
  actionResult(result);
}

function actionResult<T>(result: ApiResult<T>): void {
  if (!result.ok) {
    throw new Error(`Admin action failed with HTTP ${result.status}: ${result.message}`);
  }

  revalidatePath("/admin");
}

function stringField(formData: FormData, key: string) {
  const value = formData.get(key);
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${key} is required`);
  }

  return value.trim();
}

function enumField<const T extends readonly string[]>(formData: FormData, key: string, allowed: T): T[number] {
  const value = stringField(formData, key);
  if (!allowed.includes(value)) {
    throw new Error(`${key} is invalid`);
  }

  return value;
}

function jsonObjectField(formData: FormData, key: string): Record<string, unknown> {
  const value = stringField(formData, key);
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${key} must be a JSON object`);
  }

  return parsed as Record<string, unknown>;
}
