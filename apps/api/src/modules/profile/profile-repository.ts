import postgres from "postgres";
import type { ProfileRepository, UserResource } from "./types.js";

export class ProfileRepositoryConfigurationError extends Error {
  constructor() {
    super("DATABASE_URL_NOT_CONFIGURED");
    this.name = "ProfileRepositoryConfigurationError";
  }
}

export class ProfileHandleConflictError extends Error {
  constructor() {
    super("PROFILE_HANDLE_CONFLICT");
    this.name = "ProfileHandleConflictError";
  }
}

interface ProfileRow {
  id: string;
  handle: string;
  display_name: string;
  avatar_url: string | null;
}

export function createPostgresProfileRepository(databaseUrl?: string): ProfileRepository {
  if (!databaseUrl) {
    return {
      async upsertMyProfile() {
        throw new ProfileRepositoryConfigurationError();
      }
    };
  }

  const sql = postgres(databaseUrl, {
    max: 5,
    idle_timeout: 20,
    prepare: false
  });

  return {
    async upsertMyProfile(supabaseUserId, input): Promise<UserResource> {
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
    },
    async close() {
      await sql.end({ timeout: 5 });
    }
  };
}

function toUserResource(row: ProfileRow): UserResource {
  return {
    id: row.id,
    handle: row.handle,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    badges: []
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
