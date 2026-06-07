import type postgres from "postgres";
import { ProfileHandleConflictError, ProfileRepositoryConfigurationError } from "./profile-errors.js";
import { toUserResource } from "./profile-repository-mappers.js";
import type { ProfileRow } from "./profile-repository-rows.js";
import type { ProfileRepository } from "./types.js";

export function createProfileMutationRepositoryMethods(
  sql: postgres.Sql
): Pick<ProfileRepository, "upsertMyProfile"> {
  return {
    async upsertMyProfile(supabaseUserId, input) {
      try {
        const rows = await sql<ProfileRow[]>`
          with target_user as (
            select id
            from users
            where supabase_user_id = ${supabaseUserId}
            limit 1
          ),
          upserted_profile as (
            insert into profiles (
              user_id,
              handle,
              display_name,
              bio,
              location_label,
              updated_at
            )
            select
              id,
              ${input.handle},
              ${input.displayName},
              ${input.bio ?? null},
              ${input.locationLabel ?? null},
              now()
            from target_user
            on conflict (user_id) do update set
              handle = excluded.handle,
              display_name = excluded.display_name,
              bio = excluded.bio,
              location_label = excluded.location_label,
              updated_at = now()
            returning user_id, handle, display_name, avatar_url
          )
          select
            up.user_id as id,
            up.handle,
            up.display_name,
            up.avatar_url
          from upserted_profile up
          limit 1
        `;

        const row = rows[0];

        if (!row) {
          throw new ProfileRepositoryConfigurationError();
        }

        return toUserResource(row);
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ProfileHandleConflictError();
        }

        throw error;
      }
    }
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}
