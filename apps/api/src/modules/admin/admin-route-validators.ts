import type {
  AdminDataRequestActionRequest,
  AdminFeatureFlagPatchRequest,
  AdminModerationActionRequest,
  AdminOrganizationKybActionRequest,
  AdminOrganizationMemberActionRequest,
  AdminReasonRequest,
  AdminRefundDisputeActionRequest,
  AdminReportActionRequest,
  AdminSupportCaseActionRequest,
  AdminSupportPolicyActionRequest
} from "./types.js";

export function validateOrganizationKybAction(
  body: Partial<AdminOrganizationKybActionRequest> | undefined
): string | null {
  if (!body || typeof body !== "object") {
    return "Request body is required";
  }

  if (
    body.kybState !== "not_started" &&
    body.kybState !== "pending" &&
    body.kybState !== "verified" &&
    body.kybState !== "rejected"
  ) {
    return "kybState is invalid";
  }

  if (!body.reason || body.reason.trim().length < 3 || body.reason.length > 500) {
    return "reason must be 3-500 characters";
  }

  return null;
}

export function validateAdminReason(body: Partial<AdminReasonRequest> | undefined): string | null {
  if (!body || typeof body !== "object") {
    return "Request body is required";
  }

  if (!body.reason || body.reason.trim().length < 3 || body.reason.length > 500) {
    return "reason must be 3-500 characters";
  }

  return null;
}

export function validateModerationAction(
  body: Partial<AdminModerationActionRequest> | undefined
): string | null {
  if (!body || typeof body !== "object") {
    return "Request body is required";
  }

  if (
    body.action !== "approve" &&
    body.action !== "restrict" &&
    body.action !== "block" &&
    body.action !== "delete" &&
    body.action !== "reinstate"
  ) {
    return "action is invalid";
  }

  if (!body.reason || body.reason.trim().length < 3 || body.reason.length > 500) {
    return "reason must be 3-500 characters";
  }

  return null;
}

export function validateReportAction(
  body: Partial<AdminReportActionRequest> | undefined
): string | null {
  if (!body || typeof body !== "object") {
    return "Request body is required";
  }

  if (
    body.state !== "reviewing" &&
    body.state !== "resolved" &&
    body.state !== "escalated" &&
    body.state !== "rejected"
  ) {
    return "state is invalid";
  }

  if (!body.reason || body.reason.trim().length < 3 || body.reason.length > 500) {
    return "reason must be 3-500 characters";
  }

  return null;
}

export function validateSupportCaseAction(
  body: Partial<AdminSupportCaseActionRequest> | undefined
): string | null {
  if (!body || typeof body !== "object") {
    return "Request body is required";
  }

  if (
    body.state !== "open" &&
    body.state !== "pending_user" &&
    body.state !== "pending_internal" &&
    body.state !== "resolved" &&
    body.state !== "closed"
  ) {
    return "state is invalid";
  }

  if (!body.reason || body.reason.trim().length < 3 || body.reason.length > 500) {
    return "reason must be 3-500 characters";
  }

  return null;
}

export function validateSupportPolicyAction(
  body: Partial<AdminSupportPolicyActionRequest> | undefined
): string | null {
  if (!body || typeof body !== "object") {
    return "Request body is required";
  }

  if (
    body.supportState !== "standard" &&
    body.supportState !== "priority" &&
    body.supportState !== "enterprise_review"
  ) {
    return "supportState is invalid";
  }

  if (body.slaTier !== "standard" && body.slaTier !== "priority" && body.slaTier !== "enterprise_review") {
    return "slaTier is invalid";
  }

  if (body.state !== "active" && body.state !== "paused" && body.state !== "review_required") {
    return "state is invalid";
  }

  if (!body.reason || body.reason.trim().length < 3 || body.reason.length > 500) {
    return "reason must be 3-500 characters";
  }

  return null;
}

export function validateRefundDisputeAction(
  body: Partial<AdminRefundDisputeActionRequest> | undefined
): string | null {
  if (!body || typeof body !== "object") {
    return "Request body is required";
  }

  if (
    body.state !== "opened" &&
    body.state !== "reviewing" &&
    body.state !== "creator_action_required" &&
    body.state !== "rejected" &&
    body.state !== "withdrawn" &&
    body.state !== "resolved" &&
    body.state !== "closed"
  ) {
    return "state is invalid";
  }

  if (!body.resolution || body.resolution.trim().length < 3 || body.resolution.length > 1000) {
    return "resolution must be 3-1000 characters";
  }

  if (!body.reason || body.reason.trim().length < 3 || body.reason.length > 500) {
    return "reason must be 3-500 characters";
  }

  return null;
}

export function validateDataRequestAction(
  body: Partial<AdminDataRequestActionRequest> | undefined
): string | null {
  if (!body || typeof body !== "object") {
    return "Request body is required";
  }

  if (
    body.state !== "verifying" &&
    body.state !== "processing" &&
    body.state !== "completed" &&
    body.state !== "rejected"
  ) {
    return "state is invalid";
  }

  if (!body.reason || body.reason.trim().length < 3 || body.reason.length > 500) {
    return "reason must be 3-500 characters";
  }

  return null;
}

export function validateFeatureFlagPatch(
  body: Partial<AdminFeatureFlagPatchRequest> | undefined
): string | null {
  if (!body || typeof body !== "object") {
    return "Request body is required";
  }

  if (!body.value || typeof body.value !== "object" || Array.isArray(body.value)) {
    return "value must be an object";
  }

  if (body.state !== "active" && body.state !== "paused" && body.state !== "archived") {
    return "state is invalid";
  }

  if (!body.reason || body.reason.trim().length < 3 || body.reason.length > 500) {
    return "reason must be 3-500 characters";
  }

  return null;
}

export function validateOrganizationMemberAction(
  body: Partial<AdminOrganizationMemberActionRequest> | undefined
): string | null {
  if (!body || typeof body !== "object") {
    return "Request body is required";
  }

  if (
    body.role !== "owner" &&
    body.role !== "admin" &&
    body.role !== "member" &&
    body.role !== "viewer"
  ) {
    return "role is invalid";
  }

  if (
    body.state !== "invited" &&
    body.state !== "active" &&
    body.state !== "suspended" &&
    body.state !== "removed"
  ) {
    return "state is invalid";
  }

  if (!body.reason || body.reason.trim().length < 3 || body.reason.length > 500) {
    return "reason must be 3-500 characters";
  }

  return null;
}
