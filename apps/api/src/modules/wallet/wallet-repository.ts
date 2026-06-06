import { randomUUID } from "node:crypto";
import postgres from "postgres";
import type {
  OnrampSessionResource,
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

export class WalletNotFoundError extends Error {
  constructor() {
    super("WALLET_NOT_FOUND");
    this.name = "WalletNotFoundError";
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

interface OnrampSessionRow {
  id: string;
  provider: string;
  launch_url: string;
  wallet_id: string;
  wallet_address: string;
  state: OnrampSessionResource["state"];
  created_at: Date;
  expires_at: Date | null;
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
      },
      async findWalletForSupabaseUser() {
        throw new WalletRepositoryConfigurationError();
      },
      async setPrimaryWallet() {
        throw new WalletRepositoryConfigurationError();
      },
      async findOnrampSessionByIdempotencyKey() {
        throw new WalletRepositoryConfigurationError();
      },
      async recordOnrampSession() {
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
    async findWalletForSupabaseUser(input) {
      const rows = await sql<WalletRow[]>`
        select
          w.id,
          w.chain,
          w.address,
          w.provider,
          w.is_primary
        from users u
        join wallets w on w.user_id = u.id
        where u.supabase_user_id = ${input.supabaseUserId}
          and w.id = ${input.walletId}
        limit 1
      `;

      const wallet = rows[0];

      return wallet ? toWalletResource(wallet) : null;
    },
    async setPrimaryWallet(input) {
      const rows = await sql.begin(async (tx) => {
        const walletRows = await tx<WalletRow[]>`
          select
            w.id,
            w.user_id,
            w.chain,
            w.address,
            w.provider,
            w.is_primary
          from users u
          join wallets w on w.user_id = u.id
          where u.supabase_user_id = ${input.supabaseUserId}
            and w.id = ${input.walletId}
          limit 1
        `;

        const wallet = walletRows[0];

        if (!wallet?.user_id) {
          throw new WalletNotFoundError();
        }

        await tx`
          update wallets
          set is_primary = false,
              updated_at = now()
          where user_id = ${wallet.user_id}
            and id <> ${wallet.id}
            and is_primary = true
        `;

        const primaryRows = await tx<WalletRow[]>`
          update wallets
          set is_primary = true,
              updated_at = now()
          where id = ${wallet.id}
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
            ${wallet.user_id},
            'wallet',
            ${wallet.id},
            'wallet.primary_set',
            ${tx.json({
              chain: wallet.chain,
              provider: wallet.provider
            })}
          )
        `;

        return primaryRows;
      });

      const wallet = rows[0];

      if (!wallet) {
        throw new WalletNotFoundError();
      }

      return toWalletResource(wallet);
    },
    async findOnrampSessionByIdempotencyKey(input) {
      const rows = await sql<OnrampSessionRow[]>`
        select
          wos.id,
          wos.provider,
          wos.launch_url,
          wos.wallet_id,
          wos.wallet_address,
          wos.state,
          wos.created_at,
          wos.expires_at
        from users u
        join wallet_onramp_sessions wos on wos.user_id = u.id
        where u.supabase_user_id = ${input.supabaseUserId}
          and wos.idempotency_key = ${input.idempotencyKey}
        limit 1
      `;

      const session = rows[0];

      return session ? toOnrampSessionResource(session) : null;
    },
    async recordOnrampSession(input) {
      try {
        const rows = await sql<OnrampSessionRow[]>`
          with target_user as (
            select id
            from users
            where supabase_user_id = ${input.supabaseUserId}
            limit 1
          ),
          target_wallet as (
            select w.id, w.user_id
            from wallets w
            join target_user tu on tu.id = w.user_id
            where w.id = ${input.walletId}
            limit 1
          )
          insert into wallet_onramp_sessions (
            id,
            user_id,
            wallet_id,
            idempotency_key,
            provider,
            provider_session_reference_hash,
            wallet_address,
            chain,
            purchase_currency,
            launch_url,
            return_url,
            expires_at
          )
          select
            ${randomUUID()},
            user_id,
            id,
            ${input.idempotencyKey},
            ${input.provider},
            ${input.providerSessionReferenceHash},
            ${input.walletAddress},
            ${input.chain},
            ${input.purchaseCurrency},
            ${input.launchUrl},
            ${input.returnUrl},
            ${input.expiresAt}
          from target_wallet
          returning id, provider, launch_url, wallet_id, wallet_address, state, created_at, expires_at
        `;

        const session = rows[0];

        if (!session) {
          throw new WalletNotFoundError();
        }

        return toOnrampSessionResource(session);
      } catch (error) {
        if (isUniqueViolation(error)) {
          const existingRows = await sql<OnrampSessionRow[]>`
            select
              wos.id,
              wos.provider,
              wos.launch_url,
              wos.wallet_id,
              wos.wallet_address,
              wos.state,
              wos.created_at,
              wos.expires_at
            from users u
            join wallet_onramp_sessions wos on wos.user_id = u.id
            where u.supabase_user_id = ${input.supabaseUserId}
              and wos.idempotency_key = ${input.idempotencyKey}
            limit 1
          `;
          const existing = existingRows[0];

          if (existing) {
            return toOnrampSessionResource(existing);
          }
        }

        throw error;
      }
    },
    async close() {
      await sql.end({ timeout: 5 });
    }
  };
}

function toOnrampSessionResource(row: OnrampSessionRow): OnrampSessionResource {
  return {
    id: row.id,
    provider: row.provider,
    launchUrl: row.launch_url,
    walletId: row.wallet_id,
    walletAddress: row.wallet_address,
    state: row.state,
    createdAt: row.created_at.toISOString(),
    expiresAt: row.expires_at ? row.expires_at.toISOString() : null
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
