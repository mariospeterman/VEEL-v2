"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import {
  enqueueAdminAnalyticsJob,
  inviteAdminStaff,
  updateAdminFeatureFlag,
  updateAdminPaymentCommercialPolicy,
  updateAdminStaffMembership,
  type AdminPaymentCommercialPolicyPatchRequest,
  type AdminFeatureFlagPatchRequest,
  type AdminStaffInvitationRequest,
  type AdminStaffMembershipActionRequest,
  type AnalyticsProjectionJobRequest,
  type ApiResult
} from "@/api-client";

const staffRoles = [
  "owner", "admin", "trust_safety", "finance", "ops", "support", "creator_success",
  "event_ops", "ai_ops", "compliance", "readonly_auditor"
] as const;

export async function enqueueAnalyticsProjectionJobAction(formData: FormData): Promise<void> {
  const body: AnalyticsProjectionJobRequest = {
    jobType: enumField(formData, "jobType", ["backfill", "reconciliation"] as const),
    window: {
      startDate: stringField(formData, "startDate"),
      endDate: stringField(formData, "endDate")
    },
    reason: stringField(formData, "reason")
  };
  actionResult(await enqueueAdminAnalyticsJob(body, randomUUID()), "/admin/analytics");
}

export async function updatePaymentCommercialPolicyAction(formData: FormData): Promise<void> {
  const productType = enumField(formData, "productType", [
    "support", "content_unlock", "paid_message", "live_pass", "event_access_pass"
  ] as const);
  const currency = enumField(formData, "currency", ["SOL", "USDC"] as const);
  const body: AdminPaymentCommercialPolicyPatchRequest = {
    minimumAmountMinor: integerField(formData, "minimumAmountMinor", 1, Number.MAX_SAFE_INTEGER),
    platformFeeBps: integerField(formData, "platformFeeBps", 0, 9_999),
    referralShareOfPlatformFeeBps: integerField(formData, "referralShareOfPlatformFeeBps", 0, 10_000),
    quoteTtlSeconds: integerField(formData, "quoteTtlSeconds", 60, 1_800),
    state: enumField(formData, "state", ["active", "inactive"] as const),
    reason: stringField(formData, "reason")
  };
  actionResult(
    await updateAdminPaymentCommercialPolicy(productType, currency, body, randomUUID()),
    "/admin/payments"
  );
}

export async function updateFeatureFlagAction(formData: FormData): Promise<void> {
  const body: AdminFeatureFlagPatchRequest = {
    value: jsonObjectField(formData, "value"),
    state: enumField(formData, "state", ["active", "paused", "archived"] as const),
    reason: stringField(formData, "reason")
  };
  actionResult(
    await updateAdminFeatureFlag(stringField(formData, "featureFlagKey"), body, randomUUID()),
    "/admin/settings"
  );
}

export async function inviteStaffAction(formData: FormData): Promise<void> {
  const body: AdminStaffInvitationRequest = {
    targetUserId: stringField(formData, "targetUserId"),
    role: enumField(formData, "role", staffRoles),
    expiresInHours: integerField(formData, "expiresInHours", 1, 168),
    reason: stringField(formData, "reason"),
    confirmed: true
  };
  actionResult(await inviteAdminStaff(body, randomUUID()));
}

export async function updateStaffMembershipAction(formData: FormData): Promise<void> {
  const action = enumField(formData, "action", ["change_role", "suspend", "revoke"] as const);
  const body: AdminStaffMembershipActionRequest = {
    action,
    ...(action === "change_role" ? { role: enumField(formData, "role", staffRoles) } : {}),
    reason: stringField(formData, "reason"),
    confirmed: true
  };
  actionResult(await updateAdminStaffMembership(
    stringField(formData, "membershipId"),
    body,
    randomUUID()
  ));
}

function actionResult<T>(result: ApiResult<T>, path = "/admin/staff"): void {
  if (!result.ok) {
    throw new Error(`Admin action failed with HTTP ${result.status}: ${result.message}`);
  }
  revalidatePath(path);
}

function stringField(formData: FormData, key: string): string {
  const value = formData.get(key);
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${key} is required`);
  }
  return value.trim();
}

function enumField<const T extends readonly string[]>(formData: FormData, key: string, allowed: T): T[number] {
  const value = stringField(formData, key);
  if (!allowed.includes(value)) throw new Error(`${key} is invalid`);
  return value;
}

function integerField(formData: FormData, key: string, minimum: number, maximum: number): number {
  const parsed = Number(stringField(formData, key));
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${key} must be an integer between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function jsonObjectField(formData: FormData, key: string): Record<string, unknown> {
  const parsed = JSON.parse(stringField(formData, key)) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${key} must be a JSON object`);
  }
  return parsed as Record<string, unknown>;
}
