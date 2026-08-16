import type {
  AdminDataRequestActionRequest,
  AdminFeatureFlagPatchRequest,
  AdminModerationActionRequest,
  AdminOrganizationKybActionRequest,
  AdminOrganizationProvisionRequest,
  AdminOrganizationMemberActionRequest,
  AdminReasonRequest,
  AdminRefundDisputeActionRequest,
  AdminReportActionRequest,
  AdminSupportCaseActionRequest,
  AdminSupportPolicyActionRequest
} from "./types.js";

export function validateOrganizationProvision(
  body: Partial<AdminOrganizationProvisionRequest> | undefined
): string | null {
  if (!body || typeof body !== "object") return "Request body is required";
  if (!body.name || body.name.trim().length < 2 || body.name.trim().length > 120) {
    return "name must be 2-120 characters";
  }
  if (!body.ownerHandle || !/^[a-zA-Z0-9_]{3,32}$/.test(body.ownerHandle.trim())) {
    return "ownerHandle must be an existing 3-32 character WeVid handle";
  }
  if (!body.reason || body.reason.trim().length < 3 || body.reason.length > 500) {
    return "reason must be 3-500 characters";
  }
  return null;
}

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
    body.action !== "request_changes" &&
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

  const remediationEvidence = body.remediationEvidence;
  if (remediationEvidence !== undefined) {
    if (!remediationEvidence || typeof remediationEvidence !== "object") {
      return "remediationEvidence is invalid";
    }

    if (
      remediationEvidence.evidenceType !== "creator_refund_attestation" &&
      remediationEvidence.evidenceType !== "replacement_access_recorded" &&
      remediationEvidence.evidenceType !== "access_revocation_recorded" &&
      remediationEvidence.evidenceType !== "technical_remediation_recorded" &&
      remediationEvidence.evidenceType !== "no_refund_denial_recorded"
    ) {
      return "remediationEvidence.evidenceType is invalid";
    }

    if (
      remediationEvidence.evidenceSource !== "creator_attestation" &&
      remediationEvidence.evidenceSource !== "provider_reference" &&
      remediationEvidence.evidenceSource !== "support_observation" &&
      remediationEvidence.evidenceSource !== "platform_access_change"
    ) {
      return "remediationEvidence.evidenceSource is invalid";
    }

    if (
      remediationEvidence.externalReference !== undefined &&
      (typeof remediationEvidence.externalReference !== "string" ||
        remediationEvidence.externalReference.length < 1 ||
        remediationEvidence.externalReference.length > 200)
    ) {
      return "remediationEvidence.externalReference must be 1-200 characters";
    }

    if (
      remediationEvidence.amountMinor !== undefined &&
      (!Number.isInteger(remediationEvidence.amountMinor) || remediationEvidence.amountMinor < 0)
    ) {
      return "remediationEvidence.amountMinor must be a non-negative integer";
    }

    if (
      remediationEvidence.currency !== undefined &&
      (typeof remediationEvidence.currency !== "string" ||
        remediationEvidence.currency.length < 2 ||
        remediationEvidence.currency.length > 12)
    ) {
      return "remediationEvidence.currency must be 2-12 characters";
    }

    if (
      remediationEvidence.refundValueBasis !== undefined &&
      remediationEvidence.refundValueBasis !== "original_crypto_amount" &&
      remediationEvidence.refundValueBasis !== "fiat_value_at_purchase" &&
      remediationEvidence.refundValueBasis !== "manual_resolution"
    ) {
      return "remediationEvidence.refundValueBasis is invalid";
    }

    if (
      remediationEvidence.refundWallet !== undefined &&
      (typeof remediationEvidence.refundWallet !== "string" ||
        remediationEvidence.refundWallet.length < 8 ||
        remediationEvidence.refundWallet.length > 120)
    ) {
      return "remediationEvidence.refundWallet must be 8-120 characters";
    }

    if (
      typeof remediationEvidence.notes !== "string" ||
      remediationEvidence.notes.trim().length < 3 ||
      remediationEvidence.notes.length > 1000
    ) {
      return "remediationEvidence.notes must be 3-1000 characters";
    }
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
