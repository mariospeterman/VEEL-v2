import postgres from "postgres";
import type { AgeRepository, AgeStatus, AgeState } from "./types.js";

export class AgeRepositoryConfigurationError extends Error {
  constructor() {
    super("DATABASE_URL_NOT_CONFIGURED");
    this.name = "AgeRepositoryConfigurationError";
  }
}

interface AgeStatusRow {
  state: AgeState | null;
  provider: string | null;
}

const requiredAgeStatus: AgeStatus = {
  state: "required",
  provider: null
};

export function createPostgresAgeRepository(databaseUrl?: string): AgeRepository {
  if (!databaseUrl) {
    return {
      async findLatestAgeStatusBySupabaseUserId() {
        throw new AgeRepositoryConfigurationError();
      }
    };
  }

  const sql = postgres(databaseUrl, {
    max: 5,
    idle_timeout: 20,
    prepare: false
  });

  return {
    async findLatestAgeStatusBySupabaseUserId(supabaseUserId: string): Promise<AgeStatus> {
      const rows = await sql<AgeStatusRow[]>`
        select
          av.state,
          av.provider
        from users u
        left join lateral (
          select state, provider
          from age_verifications
          where user_id = u.id
          order by created_at desc
          limit 1
        ) av on true
        where u.supabase_user_id = ${supabaseUserId}
        limit 1
      `;

      const row = rows[0];

      if (!row?.state) {
        return requiredAgeStatus;
      }

      return {
        state: row.state,
        provider: row.provider
      };
    },
    async close() {
      await sql.end({ timeout: 5 });
    }
  };
}
