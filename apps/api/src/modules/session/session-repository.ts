import { resolvePostgresClient, type PostgresSql } from "../../shared/postgres.js";
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

export function createPostgresSessionRepository(database?: string | PostgresSql): SessionRepository {
  if (!database) {
    return {
      async findProfileByUserId() {
        throw new SessionRepositoryConfigurationError();
      },
      async findProfileBySupabaseUserId() {
        throw new SessionRepositoryConfigurationError();
      }
    };
  }

  const { sql, ownsClient } = resolvePostgresClient(database);

  return {
    async findProfileByUserId(userId: string): Promise<SessionProfile | null> {
      const rows = await sql<SessionProfileRow[]>`
        select
          u.id,
          u.state,
          p.handle,
          p.display_name,
          p.avatar_url
        from users u
        left join profiles p on p.user_id = u.id
        where u.id = ${userId}
        limit 1
      `;

      return rows[0] ? toSessionProfile(rows[0]) : null;
    },
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

      return toSessionProfile(row);
    },
    async close() {
      if (ownsClient) {
        await sql.end({ timeout: 5 });
      }
    }
  };
}

function toSessionProfile(row: SessionProfileRow): SessionProfile {
  return {
    id: row.id,
    state: row.state,
    handle: row.handle,
    displayName: row.display_name,
    avatarUrl: row.avatar_url
  };
}
