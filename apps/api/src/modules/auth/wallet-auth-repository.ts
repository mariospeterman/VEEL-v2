import { createHash, randomBytes, randomUUID } from "node:crypto";
import type postgres from "postgres";
import { resolvePostgresClient, type PostgresSql } from "../../shared/postgres.js";
import type { WalletChain, WalletProvider, WalletResource } from "../wallet/types.js";
import { toWalletResource } from "../wallet/wallet-repository-mappers.js";
import type { WalletRow } from "../wallet/wallet-repository-rows.js";

export class WalletAuthRepositoryConfigurationError extends Error {
  constructor() {
    super("WALLET_AUTH_REPOSITORY_NOT_CONFIGURED");
    this.name = "WalletAuthRepositoryConfigurationError";
  }
}

export class WalletAuthChallengeInvalidError extends Error {
  constructor() {
    super("WALLET_AUTH_CHALLENGE_INVALID");
    this.name = "WalletAuthChallengeInvalidError";
  }
}

export class WalletRecoveryLinkConflictError extends Error {
  constructor() {
    super("WALLET_RECOVERY_LINK_CONFLICT");
    this.name = "WalletRecoveryLinkConflictError";
  }
}

export interface WalletAuthChallenge {
  id: string;
  chain: WalletChain;
  provider: WalletProvider;
  address: string;
  message: string;
  expiresAt: Date;
  consumedAt: Date | null;
}

export interface WalletAuthSession {
  accessToken: string;
  expiresAt: Date;
  wallet: WalletResource;
}

export interface VerifiedWalletAuthSession {
  supabaseUserId: string;
}

export interface WalletAuthRepository {
  createChallenge(input: CreateWalletAuthChallengeInput): Promise<WalletAuthChallenge>;
  findChallenge(input: FindWalletAuthChallengeInput): Promise<WalletAuthChallenge | null>;
  createSessionFromChallenge(input: CreateWalletAuthSessionInput): Promise<WalletAuthSession>;
  linkSupabaseRecovery(input: LinkSupabaseRecoveryInput): Promise<void>;
  revokeSessionToken(token: string): Promise<void>;
  verifySessionToken(token: string): Promise<VerifiedWalletAuthSession | null>;
  close?(): Promise<void>;
}

export interface CreateWalletAuthChallengeInput {
  chain: WalletChain;
  provider: WalletProvider;
  address: string;
  message: string;
  nonceHash: string;
  expiresAt: Date;
}

export interface FindWalletAuthChallengeInput {
  challengeId: string;
}

export interface CreateWalletAuthSessionInput {
  challengeId: string;
  expiresAt: Date;
}

export interface LinkSupabaseRecoveryInput {
  walletSessionToken: string;
  supabaseUserId: string;
}

interface WalletAuthChallengeRow {
  id: string;
  chain: WalletChain;
  provider: WalletProvider;
  address: string;
  message: string;
  expires_at: Date;
  consumed_at: Date | null;
}

type WalletAuthWalletRow = WalletRow & {
  user_id: string;
  supabase_user_id: string;
};

export function createPostgresWalletAuthRepository(
  database?: string | PostgresSql
): WalletAuthRepository {
  if (!database) {
    return createUnavailableWalletAuthRepository();
  }

  const { sql, ownsClient } = resolvePostgresClient(database);

  return {
    async createChallenge(input) {
      const rows = await sql<WalletAuthChallengeRow[]>`
        insert into wallet_auth_challenges (
          id,
          chain,
          provider,
          address,
          message,
          nonce_hash,
          expires_at
        )
        values (
          ${randomUUID()},
          ${input.chain},
          ${input.provider},
          ${input.address},
          ${input.message},
          ${input.nonceHash},
          ${input.expiresAt}
        )
        returning id, chain, provider, address, message, expires_at, consumed_at
      `;

      const row = rows[0];

      if (!row) {
        throw new WalletAuthRepositoryConfigurationError();
      }

      return toChallenge(row);
    },
    async findChallenge(input) {
      const rows = await sql<WalletAuthChallengeRow[]>`
        select id, chain, provider, address, message, expires_at, consumed_at
        from wallet_auth_challenges
        where id = ${input.challengeId}
        limit 1
      `;

      return rows[0] ? toChallenge(rows[0]) : null;
    },
    async createSessionFromChallenge(input) {
      const token = `veel_wallet_${randomBytes(32).toString("base64url")}`;
      const tokenHash = hashToken(token);

      const rows = await sql.begin(async (tx) => {
        const challengeRows = await tx<WalletAuthChallengeRow[]>`
          update wallet_auth_challenges
          set consumed_at = now()
          where id = ${input.challengeId}
            and consumed_at is null
          returning id, chain, provider, address, message, expires_at, consumed_at
        `;
        const challenge = challengeRows[0];

        if (!challenge || challenge.expires_at <= new Date()) {
          return [];
        }

        const existingWalletRows = await tx<WalletAuthWalletRow[]>`
          select
            w.id,
            w.user_id,
            w.chain,
            w.address,
            w.provider,
            w.is_primary,
            u.supabase_user_id
          from wallets w
          join users u on u.id = w.user_id
          where w.chain = ${challenge.chain}
            and w.address = ${challenge.address}
          limit 1
        `;
        const existingWallet = existingWalletRows[0];

        const wallet: WalletAuthWalletRow = existingWallet ?? (await createWalletUser(tx, challenge));

        await tx`
          insert into wallet_auth_sessions (
            id,
            user_id,
            wallet_id,
            token_hash,
            expires_at
          )
          values (
            ${randomUUID()},
            ${wallet.user_id},
            ${wallet.id},
            ${tokenHash},
            ${input.expiresAt}
          )
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
            'wallet.session_created',
            ${tx.json({
              chain: wallet.chain,
              provider: wallet.provider
            })}
          )
        `;

        return [wallet];
      });

      const wallet = rows[0];

      if (!wallet) {
        throw new WalletAuthChallengeInvalidError();
      }

      return {
        accessToken: token,
        expiresAt: input.expiresAt,
        wallet: toWalletResource(wallet)
      };
    },
    async verifySessionToken(token) {
      const rows = await sql<{ supabase_user_id: string }[]>`
        update wallet_auth_sessions was
        set last_used_at = now()
        from users u
        where was.user_id = u.id
          and was.token_hash = ${hashToken(token)}
          and was.revoked_at is null
          and was.expires_at > now()
        returning u.supabase_user_id
      `;

      const row = rows[0];
      return row ? { supabaseUserId: row.supabase_user_id } : null;
    },
    async linkSupabaseRecovery(input) {
      const walletSessionRows = await sql<{ user_id: string }[]>`
        select user_id
        from wallet_auth_sessions
        where token_hash = ${hashToken(input.walletSessionToken)}
          and revoked_at is null
          and expires_at > now()
        limit 1
      `;
      const walletSession = walletSessionRows[0];

      if (!walletSession) {
        throw new WalletAuthChallengeInvalidError();
      }

      await sql.begin(async (tx) => {
        const existingRows = await tx<{ id: string }[]>`
          select id
          from users
          where supabase_user_id = ${input.supabaseUserId}
          limit 1
        `;
        const existing = existingRows[0];

        if (existing && existing.id !== walletSession.user_id) {
          throw new WalletRecoveryLinkConflictError();
        }

        await tx`
          update users
          set supabase_user_id = ${input.supabaseUserId}
          where id = ${walletSession.user_id}
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
            ${walletSession.user_id},
            'user',
            ${walletSession.user_id},
            'auth.recovery_linked',
            ${tx.json({ provider: "supabase" })}
          )
        `;
      });
    },
    async revokeSessionToken(token) {
      await sql`
        update wallet_auth_sessions
        set revoked_at = coalesce(revoked_at, now())
        where token_hash = ${hashToken(token)}
      `;
    },
    async close() {
      if (ownsClient) {
        await sql.end({ timeout: 5 });
      }
    }
  };
}

async function createWalletUser(
  tx: postgres.TransactionSql<Record<string, postgres.PostgresType>>,
  challenge: WalletAuthChallengeRow
): Promise<WalletAuthWalletRow> {
  const userId = randomUUID();
  const identityId = randomUUID();
  const walletId = randomUUID();

  await tx`
    insert into users (id, supabase_user_id)
    values (${userId}, ${identityId})
  `;

  const walletRows = await tx<WalletAuthWalletRow[]>`
    insert into wallets (
      id,
      user_id,
      provider,
      address,
      chain,
      is_primary
    )
    values (
      ${walletId},
      ${userId},
      ${challenge.provider},
      ${challenge.address},
      ${challenge.chain},
      true
    )
    returning id, user_id, chain, address, provider, is_primary, ${identityId}::uuid as supabase_user_id
  `;

  const wallet = walletRows[0];

  if (!wallet) {
    throw new WalletAuthRepositoryConfigurationError();
  }

  return wallet;
}

function toChallenge(row: WalletAuthChallengeRow): WalletAuthChallenge {
  return {
    id: row.id,
    chain: row.chain,
    provider: row.provider,
    address: row.address,
    message: row.message,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at
  };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function createUnavailableWalletAuthRepository(): WalletAuthRepository {
  return {
    async createChallenge() {
      throw new WalletAuthRepositoryConfigurationError();
    },
    async findChallenge() {
      throw new WalletAuthRepositoryConfigurationError();
    },
    async createSessionFromChallenge() {
      throw new WalletAuthRepositoryConfigurationError();
    },
    async linkSupabaseRecovery() {
      throw new WalletAuthRepositoryConfigurationError();
    },
    async revokeSessionToken() {
      throw new WalletAuthRepositoryConfigurationError();
    },
    async verifySessionToken() {
      throw new WalletAuthRepositoryConfigurationError();
    }
  };
}
