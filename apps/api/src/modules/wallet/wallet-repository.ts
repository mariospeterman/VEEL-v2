import { randomUUID } from "node:crypto";
import postgres from "postgres";
import type {
  StoredWalletLinkChallenge,
  WalletLinkChallenge,
  WalletRepository,
  WalletResource
} from "./types.js";

export class WalletRepositoryConfigurationError extends Error {
  constructor() {
    super("DATABASE_URL_NOT_CONFIGURED");
    this.name = "WalletRepositoryConfigurationError";
  }
}

export class WalletLinkConflictError extends Error {
  constructor() {
    super("WALLET_LINK_CONFLICT");
    this.name = "WalletLinkConflictError";
  }
}

export class WalletLinkChallengeNotFoundError extends Error {
  constructor() {
    super("WALLET_LINK_CHALLENGE_NOT_FOUND");
    this.name = "WalletLinkChallengeNotFoundError";
  }
}

interface WalletRow {
  id: string;
  user_id?: string;
  chain: WalletResource["chain"];
  address: string;
  provider: WalletResource["provider"];
  is_primary: boolean;
}

interface WalletChallengeRow {
  id: string;
  user_id: string;
  chain: StoredWalletLinkChallenge["chain"];
  provider: StoredWalletLinkChallenge["provider"];
  address: string;
  message: string;
  expires_at: Date;
  consumed_at: Date | null;
}

export function createPostgresWalletRepository(databaseUrl?: string): WalletRepository {
  if (!databaseUrl) {
    return {
      async listWalletsBySupabaseUserId() {
        throw new WalletRepositoryConfigurationError();
      },
      async hasWalletBySupabaseUserId() {
        throw new WalletRepositoryConfigurationError();
      },
      async createLinkChallenge() {
        throw new WalletRepositoryConfigurationError();
      },
      async consumeVerifiedExternalWalletLink() {
        throw new WalletRepositoryConfigurationError();
      },
      async findLinkChallenge() {
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
    async createLinkChallenge(input) {
      const rows = await sql<WalletChallengeRow[]>`
        with target_user as (
          select id
          from users
          where supabase_user_id = ${input.supabaseUserId}
          limit 1
        )
        insert into wallet_link_challenges (
          id,
          user_id,
          chain,
          provider,
          address,
          message,
          nonce_hash,
          expires_at
        )
        select
          ${randomUUID()},
          id,
          ${input.chain},
          ${input.provider},
          ${input.address},
          ${input.message},
          ${input.nonceHash},
          ${input.expiresAt}
        from target_user
        returning id, user_id, chain, provider, address, message, expires_at, consumed_at
      `;

      const row = rows[0];

      if (!row) {
        throw new WalletLinkChallengeNotFoundError();
      }

      return toWalletLinkChallenge(row);
    },
    async findLinkChallenge(input) {
      const rows = await sql<WalletChallengeRow[]>`
        select
          wlc.id,
          wlc.user_id,
          wlc.chain,
          wlc.provider,
          wlc.address,
          wlc.message,
          wlc.expires_at,
          wlc.consumed_at
        from wallet_link_challenges wlc
        join users u on u.id = wlc.user_id
        where wlc.id = ${input.challengeId}
          and u.supabase_user_id = ${input.supabaseUserId}
        limit 1
      `;

      const row = rows[0];

      return row ? toStoredWalletLinkChallenge(row) : null;
    },
    async consumeVerifiedExternalWalletLink(input) {
      try {
        const rows = await sql.begin(async (tx) => {
          const challengeRows = await tx<WalletChallengeRow[]>`
            update wallet_link_challenges
            set consumed_at = now()
            where id = ${input.challengeId}
              and consumed_at is null
            returning id, user_id, chain, provider, address, message, expires_at, consumed_at
          `;

          const challenge = challengeRows[0];

          if (!challenge) {
            throw new WalletLinkChallengeNotFoundError();
          }

          const existingWalletRows = await tx<WalletRow[]>`
            select
              id,
              user_id,
              chain,
              address,
              provider,
              is_primary
            from wallets
            where chain = ${challenge.chain}
              and address = ${challenge.address}
            limit 1
          `;

          const existingWallet = existingWalletRows[0];

          if (existingWallet) {
            if (existingWallet.user_id !== challenge.user_id) {
              throw new WalletLinkConflictError();
            }

            return [existingWallet];
          }

          const hasWalletRows = await tx<{ exists: boolean }[]>`
            select exists (
              select 1
              from wallets
              where user_id = ${challenge.user_id}
            ) as exists
          `;
          const shouldSetPrimary = !(hasWalletRows[0]?.exists ?? false);

          const walletRows = await tx<WalletRow[]>`
            insert into wallets (
              id,
              user_id,
              provider,
              address,
              chain,
              is_primary
            )
            values (
              ${randomUUID()},
              ${challenge.user_id},
              ${challenge.provider},
              ${challenge.address},
              ${challenge.chain},
              ${shouldSetPrimary}
            )
            returning id, chain, address, provider, is_primary
          `;

          await tx`
            insert into audit_events (
              id,
              actor_user_id,
              subject_type,
              subject_id,
              action,
              metadata
            )
            values (
              ${randomUUID()},
              ${challenge.user_id},
              'wallet',
              ${walletRows[0]?.id ?? null},
              'wallet.linked',
              ${tx.json({
                chain: challenge.chain,
                provider: challenge.provider
              })}
            )
          `;

          return walletRows;
        });

        const wallet = rows[0];

        if (!wallet) {
          throw new WalletLinkChallengeNotFoundError();
        }

        return toWalletResource(wallet);
      } catch (error) {
        if (error instanceof WalletLinkChallengeNotFoundError) {
          throw error;
        }

        if (isUniqueViolation(error)) {
          throw new WalletLinkConflictError();
        }

        throw error;
      }
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

function toWalletLinkChallenge(row: WalletChallengeRow): WalletLinkChallenge {
  return {
    id: row.id,
    chain: row.chain,
    address: row.address,
    provider: row.provider,
    message: row.message,
    expiresAt: row.expires_at.toISOString()
  };
}

function toStoredWalletLinkChallenge(row: WalletChallengeRow): StoredWalletLinkChallenge {
  return {
    id: row.id,
    userId: row.user_id,
    chain: row.chain,
    provider: row.provider,
    address: row.address,
    message: row.message,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at
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
