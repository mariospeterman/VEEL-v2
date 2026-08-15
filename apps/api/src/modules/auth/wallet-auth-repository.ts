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

export class WalletRecoveryCredentialRequiredError extends Error {
  constructor() {
    super("WALLET_RECOVERY_CREDENTIAL_REQUIRED");
    this.name = "WalletRecoveryCredentialRequiredError";
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
  wallet?: WalletResource;
}

export interface VerifiedWalletAuthSession {
  userId: string;
  /** @deprecated Canonical user-id compatibility alias; never a provider subject. */
  supabaseUserId: string;
  sessionId: string;
  authenticatedAt: Date;
  authenticationMethod: "wallet" | "supabase_recovery";
}

export interface WalletAuthRepository {
  createChallenge(input: CreateWalletAuthChallengeInput): Promise<WalletAuthChallenge>;
  findChallenge(input: FindWalletAuthChallengeInput): Promise<WalletAuthChallenge | null>;
  createSessionFromChallenge(input: CreateWalletAuthSessionInput): Promise<WalletAuthSession>;
  createRecoveryLinkIntent(input: CreateRecoveryLinkIntentInput): Promise<RecoveryLinkIntent>;
  exchangeRecoveryIdentity(input: ExchangeRecoveryIdentityInput): Promise<WalletAuthSession>;
  unlinkRecoveryIdentity(input: UnlinkRecoveryIdentityInput): Promise<WalletAuthSession>;
  rotateSessionToken(input: RotateSessionTokenInput): Promise<WalletAuthSession>;
  revokeAllSessions(input: RevokeAllSessionsInput): Promise<number>;
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

export interface CreateRecoveryLinkIntentInput {
  sessionToken: string;
  expiresAt: Date;
}

export interface RecoveryLinkIntent {
  token: string;
  expiresAt: Date;
}

export interface ExchangeRecoveryIdentityInput {
  provider: "supabase";
  providerSubject: string;
  linkIntentToken?: string;
  sessionExpiresAt: Date;
}

export interface UnlinkRecoveryIdentityInput {
  sessionToken: string;
  provider: "supabase";
}

export interface RotateSessionTokenInput {
  sessionToken: string;
}

export interface RevokeAllSessionsInput {
  userId: string;
  actorUserId: string;
  reason: "user_logout_all" | "account_security" | "admin_security";
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
  supabase_user_id: string | null;
};

interface ApplicationSessionRow {
  id: string;
  user_id: string;
  authenticated_at: Date;
  authentication_method: "wallet" | "supabase_recovery";
}

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
      const token = newSessionToken();

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

        await tx`select pg_advisory_xact_lock(hashtextextended(${`${challenge.chain}:${challenge.address}`}, 0))`;

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

        await revokeAndInsertSession(tx, {
          userId: wallet.user_id,
          walletId: wallet.id,
          providerIdentityId: null,
          token,
          expiresAt: input.expiresAt,
          authenticationMethod: "wallet",
          authenticatedAt: new Date(),
          rotatedFromSessionId: null
        });

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
      const rows = await sql<ApplicationSessionRow[]>`
        select
          session.id,
          session.user_id,
          session.authenticated_at,
          session.authentication_method
        from app_sessions session
        where session.token_hash = ${hashToken(token)}
          and session.revoked_at is null
          and session.expires_at > now()
        limit 1
      `;

      const row = rows[0];
      if (!row) return null;
      return {
        userId: row.user_id,
        supabaseUserId: row.user_id,
        sessionId: row.id,
        authenticatedAt: row.authenticated_at,
        authenticationMethod: row.authentication_method
      };
    },
    async createRecoveryLinkIntent(input) {
      const token = `wevid_recovery_link_${randomBytes(24).toString("base64url")}`;
      const rows = await sql<{ user_id: string; session_id: string }[]>`
        select user_id, id as session_id
        from app_sessions
        where token_hash = ${hashToken(input.sessionToken)}
          and revoked_at is null
          and expires_at > now()
        limit 1
      `;
      const session = rows[0];

      if (!session) {
        throw new WalletAuthChallengeInvalidError();
      }

      await sql`
        insert into recovery_link_intents (id, user_id, session_id, token_hash, expires_at)
        values (${randomUUID()}, ${session.user_id}, ${session.session_id}, ${hashToken(token)}, ${input.expiresAt})
      `;

      return { token, expiresAt: input.expiresAt };
    },
    async exchangeRecoveryIdentity(input) {
      const token = newSessionToken();
      await sql.begin(async (tx) => {
        let userId: string | null = null;
        let rotatedFromSessionId: string | null = null;

        if (input.linkIntentToken) {
          const intents = await tx<{ user_id: string; session_id: string }[]>`
            update recovery_link_intents intent
            set consumed_at = now()
            from app_sessions session
            where intent.token_hash = ${hashToken(input.linkIntentToken)}
              and intent.consumed_at is null
              and intent.expires_at > now()
              and session.id = intent.session_id
              and session.user_id = intent.user_id
              and session.revoked_at is null
              and session.expires_at > now()
            returning intent.user_id, intent.session_id
          `;
          const intent = intents[0];
          if (!intent) throw new WalletAuthChallengeInvalidError();
          userId = intent.user_id;
          rotatedFromSessionId = intent.session_id;
        }

        await tx`select pg_advisory_xact_lock(hashtextextended(${`${input.provider}:${input.providerSubject}`}, 0))`;

        const identities = await tx<{ id: string; user_id: string; status: string }[]>`
          select id, user_id, status
          from user_provider_identities
          where provider = ${input.provider}
            and provider_subject = ${input.providerSubject}
          limit 1
          for update
        `;
        const identity = identities[0];

        if (identity?.status === "blocked") {
          throw new WalletRecoveryLinkConflictError();
        }

        if (identity && userId && identity.user_id !== userId) {
          throw new WalletRecoveryLinkConflictError();
        }

        if (!userId) {
          if (!identity || identity.status !== "active") {
            throw new WalletAuthChallengeInvalidError();
          }
          userId = identity.user_id;
        }

        await tx`select id from users where id = ${userId} for update`;

        await tx`
          update user_provider_identities
          set status = 'revoked', last_used_at = now()
          where user_id = ${userId}
            and provider = ${input.provider}
            and status = 'active'
        `;

        const identityRows = await tx<{ id: string }[]>`
          insert into user_provider_identities (
            id, provider, provider_subject, user_id, status, linked_at, last_used_at
          )
          values (
            ${randomUUID()}, ${input.provider}, ${input.providerSubject}, ${userId}, 'active', now(), now()
          )
          on conflict (provider, provider_subject) do update set
            status = 'active',
            linked_at = coalesce(user_provider_identities.linked_at, now()),
            last_used_at = now()
          returning id
        `;
        const providerIdentityId = identityRows[0]?.id ?? identity?.id;

        await revokeAndInsertSession(tx, {
          userId,
          walletId: null,
          providerIdentityId: providerIdentityId ?? null,
          token,
          expiresAt: input.sessionExpiresAt,
          authenticationMethod: "supabase_recovery",
          authenticatedAt: new Date(),
          rotatedFromSessionId
        });

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
            ${userId},
            'user',
            ${userId},
            ${input.linkIntentToken ? "auth.recovery_linked" : "auth.recovery_exchanged"},
            ${tx.json({ provider: input.provider })}
          )
        `;
      });
      return { accessToken: token, expiresAt: input.sessionExpiresAt };
    },
    async unlinkRecoveryIdentity(input) {
      const token = newSessionToken();
      const expiresAt = await sql.begin(async (tx) => {
        const sessions = await tx<Array<ApplicationSessionRow & { expires_at: Date }>>`
          select session.id, session.user_id,
            session.authenticated_at, session.authentication_method, session.expires_at
          from app_sessions session
          where session.token_hash = ${hashToken(input.sessionToken)}
            and session.revoked_at is null
            and session.expires_at > now()
          limit 1
          for update
        `;
        const session = sessions[0];
        if (!session) throw new WalletAuthChallengeInvalidError();

        const wallets = await tx<{ id: string }[]>`
          select id
          from wallets
          where user_id = ${session.user_id}
          order by is_primary desc, created_at asc
          limit 1
          for update
        `;
        const wallet = wallets[0];
        if (!wallet) throw new WalletRecoveryCredentialRequiredError();

        const revokedIdentities = await tx<{ id: string }[]>`
          update user_provider_identities
          set status = 'revoked', last_used_at = now()
          where user_id = ${session.user_id}
            and provider = ${input.provider}
            and status = 'active'
          returning id
        `;
        await revokeAndInsertSession(tx, {
          userId: session.user_id,
          walletId: wallet.id,
          providerIdentityId: null,
          token,
          expiresAt: session.expires_at,
          authenticationMethod: "wallet",
          authenticatedAt: session.authenticated_at,
          rotatedFromSessionId: session.id
        });

        await tx`
          insert into audit_events (
            id, actor_user_id, subject_type, subject_id, action, metadata
          )
          values (
            ${randomUUID()}, ${session.user_id}, 'user', ${session.user_id},
            'auth.recovery_unlinked',
            ${tx.json({
              provider: input.provider,
              revokedIdentityIds: revokedIdentities.map((identity) => identity.id)
            })}
          )
        `;

        return session.expires_at;
      });
      return { accessToken: token, expiresAt };
    },
    async rotateSessionToken(input) {
      return sql.begin((tx) => rotateApplicationSessionInTransaction(tx, input));
    },
    async revokeAllSessions(input) {
      return sql.begin(async (tx) => {
        await tx`select id from users where id = ${input.userId} for update`;
        const revoked = await tx<{ id: string }[]>`
          update app_sessions
          set revoked_at = coalesce(revoked_at, now())
          where user_id = ${input.userId}
            and revoked_at is null
          returning id
        `;

        if (revoked.length > 0) {
          await tx`
            insert into audit_events (
              id, actor_user_id, subject_type, subject_id, action, metadata
            )
            values (
              ${randomUUID()}, ${input.actorUserId}, 'user', ${input.userId},
              'auth.sessions_revoked_all',
              ${tx.json({ reason: input.reason, revokedSessionCount: revoked.length })}
            )
          `;
        }

        return revoked.length;
      });
    },
    async revokeSessionToken(token) {
      await sql`
        update app_sessions
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
  const walletId = randomUUID();

  await tx`
    insert into users (id, supabase_user_id, state)
    values (${userId}, ${userId}, 'provisional')
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
    returning id, user_id, chain, address, provider, is_primary, ${userId}::uuid as supabase_user_id
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
    async createRecoveryLinkIntent() {
      throw new WalletAuthRepositoryConfigurationError();
    },
    async exchangeRecoveryIdentity() {
      throw new WalletAuthRepositoryConfigurationError();
    },
    async unlinkRecoveryIdentity() {
      throw new WalletAuthRepositoryConfigurationError();
    },
    async rotateSessionToken() {
      throw new WalletAuthRepositoryConfigurationError();
    },
    async revokeAllSessions() {
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

export function newSessionToken() {
  return `wevid_session_${randomBytes(32).toString("base64url")}`;
}

export async function rotateApplicationSessionInTransaction(
  tx: postgres.TransactionSql<Record<string, postgres.PostgresType>>,
  input: RotateSessionTokenInput & { userId?: string }
): Promise<WalletAuthSession> {
  const token = newSessionToken();
  const sessions = await tx<Array<ApplicationSessionRow & {
    wallet_id: string | null;
    provider_identity_id: string | null;
    expires_at: Date;
  }>>`
    select session.id, session.user_id,
      session.authenticated_at, session.authentication_method,
      session.wallet_id, session.provider_identity_id, session.expires_at
    from app_sessions session
    where session.token_hash = ${hashToken(input.sessionToken)}
      and session.revoked_at is null
      and session.expires_at > now()
      and (${input.userId ?? null}::uuid is null or session.user_id = ${input.userId ?? null}::uuid)
    limit 1
    for update
  `;
  const session = sessions[0];
  if (!session) throw new WalletAuthChallengeInvalidError();
  await revokeAndInsertSession(tx, {
    userId: session.user_id,
    walletId: session.wallet_id,
    providerIdentityId: session.provider_identity_id,
    token,
    expiresAt: session.expires_at,
    authenticationMethod: session.authentication_method,
    authenticatedAt: session.authenticated_at,
    rotatedFromSessionId: session.id
  });
  return { accessToken: token, expiresAt: session.expires_at };
}

async function revokeAndInsertSession(
  tx: postgres.TransactionSql<Record<string, postgres.PostgresType>>,
  input: {
    userId: string;
    walletId: string | null;
    providerIdentityId: string | null;
    token: string;
    expiresAt: Date;
    authenticationMethod: "wallet" | "supabase_recovery";
    authenticatedAt: Date;
    rotatedFromSessionId: string | null;
  }
) {
  await tx`select id from users where id = ${input.userId} for update`;
  if (input.rotatedFromSessionId) {
    const revokedSource = await tx<{ id: string }[]>`
      update app_sessions
      set revoked_at = coalesce(revoked_at, now())
      where id = ${input.rotatedFromSessionId}
        and user_id = ${input.userId}
        and revoked_at is null
      returning id
    `;
    if (revokedSource.length !== 1) throw new WalletAuthChallengeInvalidError();
  }
  await tx`
    insert into app_sessions (
      id, user_id, wallet_id, provider_identity_id, token_hash, expires_at,
      authentication_method, authenticated_at, rotated_from_session_id
    )
    values (
      ${randomUUID()}, ${input.userId}, ${input.walletId}, ${input.providerIdentityId},
      ${hashToken(input.token)}, ${input.expiresAt}, ${input.authenticationMethod}, ${input.authenticatedAt},
      ${input.rotatedFromSessionId}
    )
  `;
}
