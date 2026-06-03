import postgres from "postgres";
import type { SessionProfile, SessionRepository } from "./types.js";

export class SessionRepositoryConfigurationError extends Error {
  constructor() {
    super("DATABASE_URL_NOT_CONFIGURED");
    this.name = "SessionRepositoryConfigurationError";
  }
}

interface SessionProfileRow {
  id: string;
  state: string;
  handle: string | null;
  display_name: string | null;
  avatar_url: string | null;
}

export function createPostgresSessionRepository(databaseUrl?: string): SessionRepository {
  if (!databaseUrl) {
    return {
      async findProfileBySupabaseUserId() {
        throw new SessionRepositoryConfigurationError();
      }
    };
  }

  const sql = postgres(databaseUrl, {
    max: 5,
    idle_timeout: 20,
    prepare: false
  });

  return {
    async findProfileBySupabaseUserId(supabaseUserId: string): Promise<SessionProfile | null> {
      const rows = await sql<SessionProfileRow[]>`
        select
          u.id,
          u.state,
          p.handle,
          p.display_name,
          p.avatar_url
        from users u
        left join profiles p on p.user_id = u.id
        where u.supabase_user_id = ${supabaseUserId}
        limit 1
      `;

      const row = rows[0];

      if (!row) {
        return null;
      }

      return {
        id: row.id,
        state: row.state,
        handle: row.handle,
        displayName: row.display_name,
        avatarUrl: row.avatar_url
      };
    },
    async close() {
      await sql.end({ timeout: 5 });
    }
  };
}
