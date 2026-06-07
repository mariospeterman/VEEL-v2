import type {
  AdminReferralProgram,
  AdminPartnerCampaign,
  AdminTierWaiver,
  AdminOrganization,
  AdminOrganizationMember,
  AdminFeatureFlag
} from "./types.js";

export interface ReferralProgramRow {
  id: string;
  name: string;
  state: AdminReferralProgram["state"];
  priority: AdminReferralProgram["priority"];
  commission_source: AdminReferralProgram["commissionSource"];
  created_at: Date;
}

export interface PartnerCampaignRow {
  id: string;
  name: string;
  partner_name: string;
  state: AdminPartnerCampaign["state"];
  contract_id: string | null;
  created_at: Date;
}

export interface TierWaiverRow {
  id: string;
  subject_type: AdminTierWaiver["subjectType"];
  subject_id: string;
  tier_key: AdminTierWaiver["tierKey"];
  state: AdminTierWaiver["state"];
  starts_at: Date;
  ends_at: Date | null;
}

export interface OrganizationRow {
  id: string;
  name: string;
  state: AdminOrganization["state"];
  plan: AdminOrganization["plan"];
  kyb_state: AdminOrganization["kybState"];
  created_at: Date;
}

export interface OrganizationMemberRow {
  id: string;
  organization_id: string;
  user_id: string;
  role: AdminOrganizationMember["role"];
  state: AdminOrganizationMember["state"];
  invited_by_user_id: string | null;
  joined_at: Date | null;
  created_at: Date;
  updated_at: Date | null;
}

export interface FeatureFlagRow {
  key: string;
  value: AdminFeatureFlag["value"];
  category: AdminFeatureFlag["category"];
  policy_boundary: AdminFeatureFlag["policyBoundary"];
  state: AdminFeatureFlag["state"];
  updated_at: Date;
}

export interface LockedOrganizationMemberRow extends OrganizationMemberRow {
  active_owner_count: string | number;
}

export function toReferralProgram(row: ReferralProgramRow): AdminReferralProgram {
  return {
    id: row.id,
    name: row.name,
    state: row.state,
    priority: row.priority,
    ...(row.commission_source ? { commissionSource: row.commission_source } : {}),
    createdAt: row.created_at.toISOString()
  };
}

export function toPartnerCampaign(row: PartnerCampaignRow): AdminPartnerCampaign {
  return {
    id: row.id,
    name: row.name,
    partnerName: row.partner_name,
    state: row.state,
    contractId: row.contract_id,
    createdAt: row.created_at.toISOString()
  };
}

export function toTierWaiver(row: TierWaiverRow): AdminTierWaiver {
  return {
    id: row.id,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    tierKey: row.tier_key,
    state: row.state,
    startsAt: row.starts_at.toISOString(),
    endsAt: row.ends_at?.toISOString() ?? null
  };
}

export function toOrganization(row: OrganizationRow): AdminOrganization {
  return {
    id: row.id,
    name: row.name,
    state: row.state,
    plan: row.plan,
    ...(row.kyb_state ? { kybState: row.kyb_state } : {}),
    createdAt: row.created_at.toISOString()
  };
}

export function toOrganizationMember(row: OrganizationMemberRow): AdminOrganizationMember {
  return {
    id: row.id,
    organizationId: row.organization_id,
    userId: row.user_id,
    role: row.role,
    state: row.state,
    invitedByUserId: row.invited_by_user_id,
    joinedAt: row.joined_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at?.toISOString() ?? null
  };
}

export function toFeatureFlag(row: FeatureFlagRow): AdminFeatureFlag {
  return {
    key: row.key,
    value: row.value,
    category: row.category,
    policyBoundary: row.policy_boundary,
    state: row.state,
    updatedAt: row.updated_at.toISOString()
  };
}
