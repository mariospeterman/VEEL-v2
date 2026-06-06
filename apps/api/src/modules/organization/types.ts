import type { components } from "@veel/contracts";

export type OrganizationDashboard = components["schemas"]["OrganizationDashboard"];
export type OrganizationDashboardPage = components["schemas"]["OrganizationDashboardPage"];

export interface OrganizationRepository {
  listMyDashboards(input: {
    supabaseUserId: string;
    limit: number;
    cursor?: string;
  }): Promise<OrganizationDashboardPage>;
  close?(): Promise<void>;
}
