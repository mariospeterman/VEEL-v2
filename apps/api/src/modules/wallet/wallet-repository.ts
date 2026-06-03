import postgres from "postgres";
import type { WalletRepository, WalletResource } from "./types.js";

export class WalletRepositoryConfigurationError extends Error {
  constructor() {
    super("DATABASE_URL_NOT_CONFIGURED");
    this.name = "WalletRepositoryConfigurationError";
  }
}

interface WalletRow {
  id: string;
  chain: WalletResource["chain"];
  address: string;
  provider: WalletResource["provider"];
  is_primary: boolean;
}

export function createPostgresWalletRepository(databaseUrl?: string): WalletRepository {
  if (!databaseUrl) {
    return {
      async listWalletsBySupabaseUserId() {
        throw new WalletRepositoryConfigurationError();
      },
      async hasWalletBySupabaseUserId() {
        throw new WalletRepositoryConfigurationError();
      }
    };
  }

  const sql = postgres(databaseUrl, {
    max: 5,
    idle_timeout: 20,
    prepare: false
  });

  return {
    async listWalletsBySupabaseUserId(supabaseUserId) {
      const rows = await sql<WalletRow[]>`
        select
          w.id,
          w.chain,
          w.address,
          w.provider,
          w.is_primary
        from users u
        join wallets w on w.user_id = u.id
        where u.supabase_user_id = ${supabaseUserId}
        order by w.is_primary desc, w.created_at asc
      `;

      return rows.map(toWalletResource);
    },
    async hasWalletBySupabaseUserId(supabaseUserId) {
      const rows = await sql<{ exists: boolean }[]>`
        select exists (
          select 1
          from users u
          join wallets w on w.user_id = u.id
          where u.supabase_user_id = ${supabaseUserId}
        ) as exists
      `;

      return rows[0]?.exists ?? false;
    },
    async close() {
      await sql.end({ timeout: 5 });
    }
  };
}

function toWalletResource(row: WalletRow): WalletResource {
  return {
    id: row.id,
    chain: row.chain,
    address: row.address,
    provider: row.provider,
    isPrimary: row.is_primary
  };
}
