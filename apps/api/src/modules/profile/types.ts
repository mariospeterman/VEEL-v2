import type { components } from "@veel/contracts";

export type UserResource = components["schemas"]["User"];
export type UpdateProfileRequest = components["schemas"]["UpdateProfileRequest"];
export type CreatorProfileResource = components["schemas"]["CreatorProfile"];
export type CreatorMonetisationDashboardResource =
  components["schemas"]["CreatorMonetisationDashboard"];
export type CreatorOnboardingResource = components["schemas"]["CreatorOnboarding"];

export interface UpsertMyProfileInput {
  handle: string;
  displayName: string;
  bio?: string | undefined;
  locationLabel?: string | undefined;
}

export interface ProfileRepository {
  upsertMyProfile(
    supabaseUserId: string,
    input: UpsertMyProfileInput
  ): Promise<UserResource>;
  findCreatorProfileByHandle(handle: string): Promise<CreatorProfileResource | null>;
  getMyCreatorDashboard(
    supabaseUserId: string
  ): Promise<CreatorMonetisationDashboardResource | null>;
  getMyCreatorOnboarding(supabaseUserId: string): Promise<CreatorOnboardingResource | null>;
  close?(): Promise<void>;
}
