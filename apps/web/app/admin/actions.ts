"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import {
  updateAdminOrganizationKyb,
  updateAdminOrganizationMember,
  updateAdminFeatureFlag,
  updateAdminSupportPolicy,
  type AdminFeatureFlagPatchRequest,
  type AdminOrganizationKybActionRequest,
  type AdminOrganizationMemberActionRequest,
  type AdminSupportPolicyActionRequest,
  type ApiResult
} from "@/api-client";

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
