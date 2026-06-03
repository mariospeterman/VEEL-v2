import type { components } from "@veel/contracts";

export type UserResource = components["schemas"]["User"];
export type UpdateProfileRequest = components["schemas"]["UpdateProfileRequest"];

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
  close?(): Promise<void>;
}
