import { randomUUID } from "node:crypto";
import {
  resolvePostgresClient,
  withPostgresTransaction,
  type PostgresSql
} from "../../shared/postgres.js";
import type {
  McpConnection,
  McpRepository,
  McpScope,
  OAuthAccessTokenRecord,
  OAuthAuthorizationCode,
  OAuthAuthorizationRequest,
  OAuthClient
} from "./types.js";

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };

export class McpRepositoryConfigurationError extends Error {
  constructor() {
    super("MCP repository is not configured");
  }
}

interface McpConnectionRow {
  id: string;
  supabase_user_id?: string;
  client_name: string;
  client_type: McpConnection["clientType"];
  auth_mode: McpConnection["authMode"];
  role_type: McpConnection["roleType"];
  state: McpConnection["state"];
  token_hint: string | null;
  scopes: McpScope[];
  expires_at: Date | string;
  last_used_at: Date | string | null;
  revoked_at: Date | string | null;
  created_at: Date | string;
}

interface OAuthClientRow {
  id: string;
  client_id: string;
  client_name: string;
  client_type: OAuthClient["clientType"];
  client_mode: OAuthClient["clientMode"];
  allowed_redirect_uris: string[];
  allowed_scopes: McpScope[];
  status: OAuthClient["status"];
}

interface OAuthAuthorizationRequestRow {
  id: string;
  oauth_client_id: string;
  public_client_id: string;
  client_name: string;
  client_type: OAuthClient["clientType"];
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: "S256";
  state: string | null;
  resource: string;
  audience: string;
  role_type: OAuthAuthorizationRequest["roleType"];
  requested_scopes: McpScope[];
  approved_scopes: McpScope[] | null;
  status: OAuthAuthorizationRequest["status"];
  expires_at: Date | string;
  created_at: Date | string;
}

interface OAuthAuthorizationCodeRow {
  id: string;
  oauth_client_id: string;
  public_client_id: string;
  connection_id: string;
  supabase_user_id: string;
  role_type: OAuthAuthorizationCode["roleType"];
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: "S256";
  resource: string;
  audience: string;
  scopes: McpScope[];
  expires_at: Date | string;
  used_at: Date | string | null;
}

interface OAuthAccessTokenRow extends McpConnectionRow {
  oauth_token_id: string;
  oauth_client_id: string;
  resource: string;
  audience: string;
  token_expires_at: Date | string;
  token_revoked_at: Date | string | null;
}

export function createPostgresMcpRepository(database?: string | PostgresSql): McpRepository {
  if (!database) {
    return createUnavailableMcpRepository();
  }

  const { sql, ownsClient } = resolvePostgresClient(database);

  return {
    async createConnection(input) {
      const rows = await sql<McpConnectionRow[]>`
        with target_user as (
          select id
          from users
          where supabase_user_id = ${input.supabaseUserId}
          limit 1
        )
        insert into mcp_connections (
          id,
          actor_user_id,
          client_name,
          client_type,
          auth_mode,
          role_type,
          token_hash,
          token_hint,
          scopes,
          idempotency_key,
          expires_at
        )
        select
          ${randomUUID()},
          id,
          ${input.clientName},
          ${input.clientType},
          'scoped_token',
          ${input.roleType},
          ${input.tokenHash},
          ${input.tokenHint},
          ${input.scopes},
          ${input.idempotencyKey},
          ${input.expiresAt}
        from target_user
        returning
          id,
          client_name,
          client_type,
          auth_mode,
          role_type,
          state,
          token_hint,
          scopes,
          expires_at,
          last_used_at,
          revoked_at,
          created_at
      `;

      const row = rows[0];
      if (!row) {
        throw new McpRepositoryConfigurationError();
      }

      return toConnection(row);
    },
    async createOAuthConnection(input) {
      const rows = await sql<McpConnectionRow[]>`
        with target_user as (
          select id
          from users
          where supabase_user_id = ${input.supabaseUserId}
          limit 1
        )
        insert into mcp_connections (
          id,
          actor_user_id,
          client_name,
          client_type,
          auth_mode,
          role_type,
          oauth_client_id,
          scopes,
          idempotency_key,
          expires_at
        )
        select
          ${randomUUID()},
          id,
          ${input.clientName},
          ${input.clientType},
          'oauth',
          ${input.roleType},
          ${input.oauthClientId},
          ${input.scopes},
          ${`oauth-${randomUUID()}`},
          ${input.expiresAt}
        from target_user
        returning
          id,
          client_name,
          client_type,
          auth_mode,
          role_type,
          state,
          token_hint,
          scopes,
          expires_at,
          last_used_at,
          revoked_at,
          created_at
      `;

      const row = rows[0];
      if (!row) {
        throw new McpRepositoryConfigurationError();
      }

      return toConnection(row);
    },
    async listConnections(input) {
      const rows = await sql<McpConnectionRow[]>`
        select
          mc.id,
          mc.client_name,
          mc.client_type,
          mc.auth_mode,
          mc.role_type,
          case
            when mc.state = 'active' and mc.expires_at <= now() then 'expired'
            else mc.state
          end as state,
          mc.token_hint,
          mc.scopes,
          mc.expires_at,
          mc.last_used_at,
          mc.revoked_at,
          mc.created_at
        from mcp_connections mc
        join users u on u.id = mc.actor_user_id
        where u.supabase_user_id = ${input.supabaseUserId}
        order by mc.created_at desc
        limit 50
      `;

      return {
        items: rows.map(toConnection),
        nextCursor: null
      };
    },
    async findConnectionForUser(input) {
      const rows = await sql<McpConnectionRow[]>`
        select
          mc.id,
          mc.client_name,
          mc.client_type,
          mc.auth_mode,
          mc.role_type,
          case
            when mc.state = 'active' and mc.expires_at <= now() then 'expired'
            else mc.state
          end as state,
          mc.token_hint,
          mc.scopes,
          mc.expires_at,
          mc.last_used_at,
          mc.revoked_at,
          mc.created_at
        from mcp_connections mc
        join users u on u.id = mc.actor_user_id
        where mc.id = ${input.connectionId}
          and u.supabase_user_id = ${input.supabaseUserId}
        limit 1
      `;

      return rows[0] ? toConnection(rows[0]) : null;
    },
    async findConnectionByTokenHash(input) {
      const rows = await sql<McpConnectionRow[]>`
        select
          mc.id,
          u.supabase_user_id,
          mc.client_name,
          mc.client_type,
          mc.auth_mode,
          mc.role_type,
          case
            when mc.state = 'active' and mc.expires_at <= now() then 'expired'
            else mc.state
          end as state,
          mc.token_hint,
          mc.scopes,
          mc.expires_at,
          mc.last_used_at,
          mc.revoked_at,
          mc.created_at
        from mcp_connections mc
        join users u on u.id = mc.actor_user_id
        where mc.token_hash = ${input.tokenHash}
        limit 1
      `;

      const row = rows[0];
      return row?.supabase_user_id
        ? { ...toConnection(row), supabaseUserId: row.supabase_user_id }
        : null;
    },
    async findOAuthClientByClientId(input) {
      const rows = await sql<OAuthClientRow[]>`
        select
          id,
          client_id,
          client_name,
          client_type,
          client_mode,
          allowed_redirect_uris,
          allowed_scopes,
          status
        from oauth_clients
        where client_id = ${input.clientId}
        limit 1
      `;

      return rows[0] ? toOAuthClient(rows[0]) : null;
    },
    async createOAuthAuthorizationRequest(input) {
      const rows = await sql<OAuthAuthorizationRequestRow[]>`
        insert into oauth_authorization_requests (
          id,
          oauth_client_id,
          redirect_uri,
          code_challenge,
          code_challenge_method,
          state,
          resource,
          audience,
          role_type,
          requested_scopes,
          expires_at
        )
        values (
          ${randomUUID()},
          ${input.oauthClientId},
          ${input.redirectUri},
          ${input.codeChallenge},
          ${input.codeChallengeMethod},
          ${input.state},
          ${input.resource},
          ${input.audience},
          ${input.roleType},
          ${input.requestedScopes},
          ${input.expiresAt}
        )
        returning
          id,
          oauth_client_id,
          (select client_id from oauth_clients where id = oauth_authorization_requests.oauth_client_id) as public_client_id,
          (select client_name from oauth_clients where id = oauth_authorization_requests.oauth_client_id) as client_name,
          (select client_type from oauth_clients where id = oauth_authorization_requests.oauth_client_id) as client_type,
          redirect_uri,
          code_challenge,
          code_challenge_method,
          state,
          resource,
          audience,
          role_type,
          requested_scopes,
          approved_scopes,
          status,
          expires_at,
          created_at
      `;

      const row = rows[0];
      if (!row) {
        throw new McpRepositoryConfigurationError();
      }

      return toOAuthAuthorizationRequest(row);
    },
    async findOAuthAuthorizationRequest(input) {
      const rows = await sql<OAuthAuthorizationRequestRow[]>`
        select
          req.id,
          req.oauth_client_id,
          client.client_id as public_client_id,
          client.client_name,
          client.client_type,
          req.redirect_uri,
          req.code_challenge,
          req.code_challenge_method,
          req.state,
          req.resource,
          req.audience,
          req.role_type,
          req.requested_scopes,
          req.approved_scopes,
          case
            when req.status = 'pending' and req.expires_at <= now() then 'expired'
            else req.status
          end as status,
          req.expires_at,
          req.created_at
        from oauth_authorization_requests req
        join oauth_clients client on client.id = req.oauth_client_id
        where req.id = ${input.requestId}
        limit 1
      `;

      return rows[0] ? toOAuthAuthorizationRequest(rows[0]) : null;
    },
    async approveOAuthAuthorizationRequest(input) {
      return withPostgresTransaction(sql, async (tx) => {
        const requestRows = await tx<OAuthAuthorizationRequestRow[]>`
          select
            req.id,
            req.oauth_client_id,
            client.client_id as public_client_id,
            client.client_name,
            client.client_type,
            req.redirect_uri,
            req.code_challenge,
            req.code_challenge_method,
            req.state,
            req.resource,
            req.audience,
            req.role_type,
            req.requested_scopes,
            req.approved_scopes,
            req.status,
            req.expires_at,
            req.created_at
          from oauth_authorization_requests req
          join oauth_clients client on client.id = req.oauth_client_id
          where req.id = ${input.requestId}
            and req.status = 'pending'
            and req.expires_at > now()
          for update
        `;
        const request = requestRows[0];
        if (!request) return null;

        const connectionRows = await tx<McpConnectionRow[]>`
          with actor as (
            select id
            from users
            where supabase_user_id = ${input.supabaseUserId}
            limit 1
          )
          insert into mcp_connections (
            id,
            actor_user_id,
            client_name,
            client_type,
            auth_mode,
            role_type,
            oauth_client_id,
            scopes,
            idempotency_key,
            expires_at
          )
          select
            ${randomUUID()},
            id,
            ${request.client_name},
            ${request.client_type},
            'oauth',
            ${request.role_type},
            ${request.oauth_client_id},
            ${input.approvedScopes},
            ${`oauth-${input.requestId}`},
            ${input.connectionExpiresAt}
          from actor
          returning
            id,
            client_name,
            client_type,
            auth_mode,
            role_type,
            state,
            token_hint,
            scopes,
            expires_at,
            last_used_at,
            revoked_at,
            created_at
        `;
        const connection = connectionRows[0];
        if (!connection) {
          throw new McpRepositoryConfigurationError();
        }

        const codeRows = await tx<OAuthAuthorizationCodeRow[]>`
          with actor as (
            select id, supabase_user_id
            from users
            where supabase_user_id = ${input.supabaseUserId}
            limit 1
          )
          insert into oauth_authorization_codes (
            id,
            code_hash,
            authorization_request_id,
            oauth_client_id,
            actor_user_id,
            connection_id,
            role_type,
            redirect_uri,
            code_challenge,
            code_challenge_method,
            resource,
            audience,
            scopes,
            expires_at
          )
          select
            ${randomUUID()},
            ${input.codeHash},
            ${request.id},
            ${request.oauth_client_id},
            actor.id,
            ${connection.id},
            ${request.role_type},
            ${request.redirect_uri},
            ${request.code_challenge},
            ${request.code_challenge_method},
            ${request.resource},
            ${request.audience},
            ${input.approvedScopes},
            ${input.codeExpiresAt}
          from actor
          returning
            id,
            oauth_client_id,
            (select client_id from oauth_clients where id = oauth_authorization_codes.oauth_client_id) as public_client_id,
            connection_id,
            (select supabase_user_id from users where id = oauth_authorization_codes.actor_user_id) as supabase_user_id,
            role_type,
            redirect_uri,
            code_challenge,
            code_challenge_method,
            resource,
            audience,
            scopes,
            expires_at,
            used_at
        `;

        await tx`
          update oauth_authorization_requests
          set
            status = 'approved',
            approved_scopes = ${input.approvedScopes},
            approved_by_user_id = (select id from users where supabase_user_id = ${input.supabaseUserId} limit 1),
            approved_at = now()
          where id = ${input.requestId}
        `;

        return codeRows[0] ? toOAuthAuthorizationCode(codeRows[0]) : null;
      });
    },
    async denyOAuthAuthorizationRequest(input) {
      const rows = await sql<OAuthAuthorizationRequestRow[]>`
        update oauth_authorization_requests req
        set
          status = 'denied',
          denied_by_user_id = (select id from users where supabase_user_id = ${input.supabaseUserId} limit 1),
          denied_at = now()
        from oauth_clients client
        where req.id = ${input.requestId}
          and req.oauth_client_id = client.id
          and req.status = 'pending'
          and req.expires_at > now()
        returning
          req.id,
          req.oauth_client_id,
          client.client_id as public_client_id,
          client.client_name,
          client.client_type,
          req.redirect_uri,
          req.code_challenge,
          req.code_challenge_method,
          req.state,
          req.resource,
          req.audience,
          req.role_type,
          req.requested_scopes,
          req.approved_scopes,
          req.status,
          req.expires_at,
          req.created_at
      `;

      return rows[0] ? toOAuthAuthorizationRequest(rows[0]) : null;
    },
    async findOAuthAuthorizationCodeByHash(input) {
      const rows = await sql<OAuthAuthorizationCodeRow[]>`
        select
          code.id,
          code.oauth_client_id,
          client.client_id as public_client_id,
          code.connection_id,
          u.supabase_user_id,
          code.role_type,
          code.redirect_uri,
          code.code_challenge,
          code.code_challenge_method,
          code.resource,
          code.audience,
          code.scopes,
          code.expires_at,
          code.used_at
        from oauth_authorization_codes code
        join oauth_clients client on client.id = code.oauth_client_id
        join users u on u.id = code.actor_user_id
        where code.code_hash = ${input.codeHash}
        limit 1
      `;

      return rows[0] ? toOAuthAuthorizationCode(rows[0]) : null;
    },
    async markOAuthAuthorizationCodeUsed(input) {
      await sql`
        update oauth_authorization_codes
        set used_at = coalesce(used_at, now())
        where id = ${input.codeId}
      `;
    },
    async issueOAuthAccessToken(input) {
      const rows = await sql<{ expires_at: Date | string; scopes: McpScope[] }[]>`
        insert into oauth_access_tokens (
          id,
          token_hash,
          code_id,
          oauth_client_id,
          actor_user_id,
          connection_id,
          role_type,
          resource,
          audience,
          scopes,
          expires_at
        )
        select
          ${randomUUID()},
          ${input.tokenHash},
          code.id,
          code.oauth_client_id,
          code.actor_user_id,
          code.connection_id,
          code.role_type,
          code.resource,
          code.audience,
          code.scopes,
          ${input.expiresAt}
        from oauth_authorization_codes code
        where code.id = ${input.codeId}
        returning expires_at, scopes
      `;

      const row = rows[0];
      if (!row) throw new McpRepositoryConfigurationError();
      return { expiresAt: toIsoString(row.expires_at), scopes: row.scopes };
    },
    async findConnectionByOAuthAccessTokenHash(input) {
      const rows = await sql<OAuthAccessTokenRow[]>`
        select
          mc.id,
          u.supabase_user_id,
          mc.client_name,
          mc.client_type,
          mc.auth_mode,
          mc.role_type,
          case
            when mc.state = 'active' and mc.expires_at <= now() then 'expired'
            else mc.state
          end as state,
          mc.token_hint,
          token.scopes,
          mc.expires_at,
          mc.last_used_at,
          mc.revoked_at,
          mc.created_at,
          token.id as oauth_token_id,
          token.oauth_client_id,
          token.resource,
          token.audience,
          token.expires_at as token_expires_at,
          token.revoked_at as token_revoked_at
        from oauth_access_tokens token
        join mcp_connections mc on mc.id = token.connection_id
        join oauth_clients client on client.id = token.oauth_client_id
        join users u on u.id = token.actor_user_id
        where token.token_hash = ${input.tokenHash}
          and token.revoked_at is null
          and token.expires_at > now()
          and client.status = 'active'
        limit 1
      `;

      return rows[0] ? toOAuthAccessTokenRecord(rows[0]) : null;
    },
    async revokeOAuthAccessTokenHash(input) {
      await sql`
        update oauth_access_tokens
        set revoked_at = coalesce(revoked_at, now())
        where token_hash = ${input.tokenHash}
      `;
    },
    async listActiveStaffRoles(input) {
      const rows = await sql<{ role: string }[]>`
        select sm.role::text as role
        from users u
        join staff_memberships sm on sm.user_id = u.id
        where u.supabase_user_id = ${input.supabaseUserId}
          and u.state = 'active'
          and sm.state = 'active'
      `;

      return rows.map((row) => row.role);
    },
    async revokeConnection(input) {
      const rows = await sql<McpConnectionRow[]>`
        with actor as (
          select id
          from users
          where supabase_user_id = ${input.supabaseUserId}
          limit 1
        )
        update mcp_connections mc
        set
          state = 'revoked',
          revoked_at = coalesce(mc.revoked_at, now()),
          revoked_by_user_id = (select id from actor)
        where mc.id = ${input.connectionId}
          and mc.actor_user_id = (select id from actor)
        returning
          mc.id,
          mc.client_name,
          mc.client_type,
          mc.auth_mode,
          mc.role_type,
          mc.state,
          mc.token_hint,
          mc.scopes,
          mc.expires_at,
          mc.last_used_at,
          mc.revoked_at,
          mc.created_at
      `;

      const row = rows[0];
      if (!row) return null;

      await sql`
        update oauth_access_tokens
        set revoked_at = coalesce(revoked_at, now())
        where connection_id = ${row.id}
      `;

      return toConnection(row);
    },
    async touchConnection(input) {
      await sql`
        update mcp_connections
        set last_used_at = now()
        where id = ${input.connectionId}
      `;
    },
    async recordToolCall(input) {
      await sql`
        insert into mcp_tool_calls (
          id,
          connection_id,
          actor_user_id,
          tool_name,
          state,
          risk_level,
          required_scopes,
          input_summary,
          output_summary,
          input_redacted,
          output_redacted,
          denied_reason
        )
        select
          ${randomUUID()},
          ${input.connectionId},
          u.id,
          ${input.toolName},
          ${input.state},
          ${input.riskLevel},
          ${input.requiredScopes},
          ${input.inputSummary},
          ${input.outputSummary},
          ${sql.json(toJsonObject(input.inputRedacted))},
          ${sql.json(toJsonObject(input.outputRedacted))},
          ${input.deniedReason ?? null}
        from users u
        where u.supabase_user_id = ${input.supabaseUserId}
        limit 1
      `;
    },
    async close() {
      if (ownsClient) {
        await sql.end({ timeout: 5 });
      }
    }
  };
}

function createUnavailableMcpRepository(): McpRepository {
  return {
    async createConnection() {
      throw new McpRepositoryConfigurationError();
    },
    async createOAuthConnection() {
      throw new McpRepositoryConfigurationError();
    },
    async listConnections() {
      throw new McpRepositoryConfigurationError();
    },
    async findConnectionForUser() {
      throw new McpRepositoryConfigurationError();
    },
    async findConnectionByTokenHash() {
      throw new McpRepositoryConfigurationError();
    },
    async findOAuthClientByClientId() {
      throw new McpRepositoryConfigurationError();
    },
    async createOAuthAuthorizationRequest() {
      throw new McpRepositoryConfigurationError();
    },
    async findOAuthAuthorizationRequest() {
      throw new McpRepositoryConfigurationError();
    },
    async approveOAuthAuthorizationRequest() {
      throw new McpRepositoryConfigurationError();
    },
    async denyOAuthAuthorizationRequest() {
      throw new McpRepositoryConfigurationError();
    },
    async findOAuthAuthorizationCodeByHash() {
      throw new McpRepositoryConfigurationError();
    },
    async markOAuthAuthorizationCodeUsed() {
      throw new McpRepositoryConfigurationError();
    },
    async issueOAuthAccessToken() {
      throw new McpRepositoryConfigurationError();
    },
    async findConnectionByOAuthAccessTokenHash() {
      throw new McpRepositoryConfigurationError();
    },
    async revokeOAuthAccessTokenHash() {
      throw new McpRepositoryConfigurationError();
    },
    async listActiveStaffRoles() {
      throw new McpRepositoryConfigurationError();
    },
    async revokeConnection() {
      throw new McpRepositoryConfigurationError();
    },
    async touchConnection() {
      throw new McpRepositoryConfigurationError();
    },
    async recordToolCall() {
      throw new McpRepositoryConfigurationError();
    }
  };
}

function toConnection(row: McpConnectionRow): McpConnection {
  return {
    id: row.id,
    clientName: row.client_name,
    clientType: row.client_type,
    authMode: row.auth_mode,
    roleType: row.role_type,
    state: row.state,
    tokenHint: row.token_hint,
    scopes: row.scopes,
    expiresAt: toIsoString(row.expires_at),
    lastUsedAt: row.last_used_at ? toIsoString(row.last_used_at) : null,
    revokedAt: row.revoked_at ? toIsoString(row.revoked_at) : null,
    createdAt: toIsoString(row.created_at)
  };
}

function toOAuthClient(row: OAuthClientRow): OAuthClient {
  return {
    id: row.id,
    clientId: row.client_id,
    clientName: row.client_name,
    clientType: row.client_type,
    clientMode: row.client_mode,
    allowedRedirectUris: row.allowed_redirect_uris,
    allowedScopes: row.allowed_scopes,
    status: row.status
  };
}

function toOAuthAuthorizationRequest(row: OAuthAuthorizationRequestRow): OAuthAuthorizationRequest {
  return {
    id: row.id,
    clientId: row.oauth_client_id,
    publicClientId: row.public_client_id,
    clientName: row.client_name,
    clientType: row.client_type,
    redirectUri: row.redirect_uri,
    codeChallenge: row.code_challenge,
    codeChallengeMethod: row.code_challenge_method,
    state: row.state,
    resource: row.resource,
    audience: row.audience,
    roleType: row.role_type,
    requestedScopes: row.requested_scopes,
    approvedScopes: row.approved_scopes,
    status: row.status,
    expiresAt: toIsoString(row.expires_at),
    createdAt: toIsoString(row.created_at)
  };
}

function toOAuthAuthorizationCode(row: OAuthAuthorizationCodeRow): OAuthAuthorizationCode {
  return {
    id: row.id,
    clientId: row.oauth_client_id,
    publicClientId: row.public_client_id,
    connectionId: row.connection_id,
    supabaseUserId: row.supabase_user_id,
    roleType: row.role_type,
    redirectUri: row.redirect_uri,
    codeChallenge: row.code_challenge,
    codeChallengeMethod: row.code_challenge_method,
    resource: row.resource,
    audience: row.audience,
    scopes: row.scopes,
    expiresAt: toIsoString(row.expires_at),
    usedAt: row.used_at ? toIsoString(row.used_at) : null
  };
}

function toOAuthAccessTokenRecord(row: OAuthAccessTokenRow): OAuthAccessTokenRecord {
  return {
    ...toConnection(row),
    supabaseUserId: row.supabase_user_id ?? "",
    oauthTokenId: row.oauth_token_id,
    oauthClientId: row.oauth_client_id,
    resource: row.resource,
    audience: row.audience,
    tokenExpiresAt: toIsoString(row.token_expires_at),
    tokenRevokedAt: row.token_revoked_at ? toIsoString(row.token_revoked_at) : null
  };
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toJsonObject(value: Record<string, unknown>): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}
