import type {
  AdminSupportCase,
  AdminSupportPolicy,
  AdminRefundDispute,
  AdminDataRequest
} from "./types.js";

export interface SupportCaseRow {
  id: string;
  organization_id: string | null;
  requester_user_id: string | null;
  assigned_staff_user_id: string | null;
  subject_type: string;
  subject_id: string | null;
  category: AdminSupportCase["category"];
  state: AdminSupportCase["state"];
  priority: AdminSupportCase["priority"];
  created_at: Date;
  updated_at: Date | null;
  closed_at: Date | null;
}

export interface SupportPolicyRow {
  id: string;
  organization_id: string;
  support_state: AdminSupportPolicy["supportState"];
  sla_tier: AdminSupportPolicy["slaTier"];
  state: AdminSupportPolicy["state"];
  policy_reason: string | null;
  money_boundary: AdminSupportPolicy["moneyBoundary"];
  created_at: Date;
  updated_at: Date;
}

export interface RefundDisputeRow {
  id: string;
  payment_intent_id: string;
  entitlement_id: string | null;
  reporter_user_id: string;
  kind: AdminRefundDispute["kind"];
  requested_action: AdminRefundDispute["requestedAction"];
  state: AdminRefundDispute["state"];
  resolution: string | null;
  custody_boundary: AdminRefundDispute["custodyBoundary"];
  remediation_evidence_count: string;
  latest_remediation_evidence_at: Date | null;
  created_at: Date;
  updated_at: Date | null;
  resolved_at: Date | null;
}

export interface DataRequestRow {
  id: string;
  requester_user_id: string;
  type: AdminDataRequest["type"];
  state: AdminDataRequest["state"];
  privacy_boundary: AdminDataRequest["privacyBoundary"];
  created_at: Date;
  updated_at: Date | null;
  completed_at: Date | null;
}

export function toSupportCase(row: SupportCaseRow): AdminSupportCase {
  return {
    id: row.id,
    organizationId: row.organization_id,
    requesterUserId: row.requester_user_id,
    assignedStaffUserId: row.assigned_staff_user_id,
    category: row.category,
    state: row.state,
    priority: row.priority,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at?.toISOString() ?? null,
    closedAt: row.closed_at?.toISOString() ?? null
  };
}

export function toSupportPolicy(row: SupportPolicyRow): AdminSupportPolicy {
  return {
    id: row.id,
    organizationId: row.organization_id,
    supportState: row.support_state,
    slaTier: row.sla_tier,
    state: row.state,
    policyReason: row.policy_reason,
    moneyBoundary: row.money_boundary,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

export function toRefundDispute(row: RefundDisputeRow): AdminRefundDispute {
  return {
    id: row.id,
    paymentIntentId: row.payment_intent_id,
    entitlementId: row.entitlement_id,
    reporterUserId: row.reporter_user_id,
    kind: row.kind,
    requestedAction: row.requested_action,
    state: row.state,
    resolution: row.resolution,
    custodyBoundary: row.custody_boundary,
    remediationEvidenceCount: Number(row.remediation_evidence_count),
    latestRemediationEvidenceAt: row.latest_remediation_evidence_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at?.toISOString() ?? null,
    resolvedAt: row.resolved_at?.toISOString() ?? null
  };
}

export function toDataRequest(row: DataRequestRow): AdminDataRequest {
  return {
    id: row.id,
    requesterUserId: row.requester_user_id,
    type: row.type,
    state: row.state,
    privacyBoundary: row.privacy_boundary,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at?.toISOString() ?? null,
    completedAt: row.completed_at?.toISOString() ?? null
  };
}
