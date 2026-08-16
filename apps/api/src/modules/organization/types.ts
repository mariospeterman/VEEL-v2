import type { components } from "@veel/contracts";

export type OrganizationDashboard = components["schemas"]["OrganizationDashboard"];
export type OrganizationDashboardPage = components["schemas"]["OrganizationDashboardPage"];

export interface OrganizationMemberResource {
  id: string;
  organizationId: string;
  userId: string;
  handle: string;
  displayName: string | null;
  role: "owner" | "admin" | "member" | "viewer";
  state: "invited" | "active" | "suspended" | "removed";
  invitedByUserId: string | null;
  joinedAt: string | null;
  createdAt: string;
  isCurrentUser: boolean;
}

export interface OrganizationRepository {
  listMyDashboards(input: {
    supabaseUserId: string;
    limit: number;
    cursor?: string;
  }): Promise<OrganizationDashboardPage>;
  listMembers(input: {
    supabaseUserId: string;
    organizationId: string;
  }): Promise<OrganizationMemberResource[] | null>;
  inviteMember(input: {
    supabaseUserId: string;
    organizationId: string;
    handle: string;
    role: "admin" | "member" | "viewer";
    idempotencyKey: string;
    requestHash: string;
  }): Promise<OrganizationMemberResource | null>;
  respondToMembership(input: {
    supabaseUserId: string;
    membershipId: string;
    decision: "accept" | "decline";
    idempotencyKey: string;
    requestHash: string;
  }): Promise<OrganizationMemberResource | null>;
  updateMember(input: {
    supabaseUserId: string;
    organizationId: string;
    membershipId: string;
    role: "admin" | "member" | "viewer";
    state: "active" | "suspended" | "removed";
    idempotencyKey: string;
    requestHash: string;
  }): Promise<OrganizationMemberResource | null>;
  close?(): Promise<void>;
}
