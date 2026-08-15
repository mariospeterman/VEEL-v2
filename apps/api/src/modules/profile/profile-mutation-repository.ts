import type postgres from "postgres";
import { ProfileHandleConflictError, ProfileRepositoryConfigurationError } from "./profile-errors.js";
import { toUserResource } from "./profile-repository-mappers.js";
import type { ProfileRow } from "./profile-repository-rows.js";
import type { ProfileRepository } from "./types.js";

export function createProfileMutationRepositoryMethods(
  sql: postgres.Sql
): Pick<ProfileRepository, "upsertMyProfile" | "isHandleAvailable"> {
  return {
    async upsertMyProfile(userId, input) {
      const hasDisplayName = Object.hasOwn(input, "displayName");
      const hasAvatarUrl = Object.hasOwn(input, "avatarUrl");
      const hasBio = Object.hasOwn(input, "bio");
      const hasLinks = Object.hasOwn(input, "links");
      const hasLocationLabel = Object.hasOwn(input, "locationLabel");
      try {
        const rows = await sql<ProfileRow[]>`
          with target_user as (
            select id
            from users
            where id = ${userId}
            limit 1
          ),
          upserted_profile as (
            insert into profiles (
              user_id,
              handle,
              display_name,
              avatar_url,
              bio,
              profile_links,
              location_label,
              updated_at
            )
            select
              id,
              ${input.handle.toLowerCase()},
              ${input.displayName ?? input.handle},
              ${input.avatarUrl ?? null},
              ${input.bio ?? null},
              ${sql.json(input.links ?? [])},
              ${input.locationLabel ?? null},
              now()
            from target_user
            on conflict (user_id) do update set
              handle = excluded.handle,
              display_name = case when ${hasDisplayName} then ${input.displayName ?? input.handle} else profiles.display_name end,
              avatar_url = case when ${hasAvatarUrl} then ${input.avatarUrl ?? null} else profiles.avatar_url end,
              bio = case when ${hasBio} then ${input.bio ?? null} else profiles.bio end,
              profile_links = case when ${hasLinks} then ${sql.json(input.links ?? [])} else profiles.profile_links end,
              location_label = case when ${hasLocationLabel} then ${input.locationLabel ?? null} else profiles.location_label end,
              updated_at = now()
            returning user_id, handle, display_name, avatar_url, profile_links
          )
          select
            up.user_id as id,
            up.handle,
            up.display_name,
            up.avatar_url,
            up.profile_links
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
    },
    async isHandleAvailable(handle) {
      const rows = await sql<{ available: boolean }[]>`
        select not exists (
          select 1 from profiles where lower(handle) = lower(${handle})
        ) as available
      `;
      return rows[0]?.available ?? false;
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
