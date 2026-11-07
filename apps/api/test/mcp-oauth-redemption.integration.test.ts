import { createHash, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { createPostgresMcpRepository } from "../src/modules/mcp/mcp-repository.js";
import { createPostgresClient, type PostgresSql } from "../src/shared/postgres.js";
import {
  assertIntegrationDatabaseIsAllowed,
  integrationDatabaseUrl
} from "./integration-database.js";

const enabled = ["1", "true"].includes(
  process.env.VEEL_ENABLE_REAL_API_INTEGRATION_TESTS ?? ""
);
const describeIntegration = enabled ? describe : describe.skip;
const openClients: PostgresSql[] = [];

afterEach(async () => {
  await Promise.all(openClients.splice(0).map((sql) => sql.end({ timeout: 5 })));
});

describeIntegration("MCP OAuth authorization-code redemption against Postgres", () => {
  it("issues exactly one token concurrently and rolls consumption back when token insertion fails", async () => {
    const databaseUrl = integrationDatabaseUrl();
    assertIntegrationDatabaseIsAllowed(databaseUrl);
    const sql = createPostgresClient(databaseUrl);
    openClients.push(sql);
    const repository = createPostgresMcpRepository(sql);
    const userId = randomUUID();
    const oauthClientId = randomUUID();
    const connectionId = randomUUID();
    const publicClientId = `oauth-race-${randomUUID()}`;
    const redirectUri = "https://connector.example.test/callback";
    const resource = "https://api.example.test/mcp";
    const verifier = "v".repeat(64);
    const codeChallenge = sha256Base64Url(verifier);
    const scopes = ["creator.profile.read"];

    try {
      await sql`insert into users (id, supabase_user_id, state) values (${userId}, ${userId}, 'active')`;
      await sql`
        insert into oauth_clients (
          id, client_id, client_name, client_type, client_mode,
          allowed_redirect_uris, allowed_scopes, status
        ) values (
          ${oauthClientId}, ${publicClientId}, 'OAuth race integration', 'custom', 'public',
          ${[redirectUri]}, ${scopes}, 'active'
        )
      `;
      await sql`
        insert into mcp_connections (
          id, actor_user_id, client_name, client_type, auth_mode, role_type,
          oauth_client_id, scopes, idempotency_key, expires_at
        ) values (
          ${connectionId}, ${userId}, 'OAuth race integration', 'custom', 'oauth', 'creator',
          ${oauthClientId}, ${scopes}, ${`oauth-race-${randomUUID()}`}, now() + interval '1 hour'
        )
      `;

      const firstCode = await seedAuthorizationCode(sql, {
        userId,
        oauthClientId,
        connectionId,
        redirectUri,
        resource,
        codeChallenge,
        scopes
      });
      const tokenHashes = Array.from({ length: 8 }, (_, index) => sha256(`parallel-token-${index}-${randomUUID()}`));
      const exchanges = await Promise.all(tokenHashes.map((tokenHash) => repository.exchangeOAuthAuthorizationCode({
        codeHash: firstCode.codeHash,
        clientId: publicClientId,
        redirectUri,
        codeChallenge,
        resource,
        tokenHash,
        expiresAt: new Date(Date.now() + 30 * 60_000)
      })));
      const successfulIndex = exchanges.findIndex((result) => result !== null);
      expect(exchanges.filter((result) => result !== null)).toHaveLength(1);
      expect(successfulIndex).toBeGreaterThanOrEqual(0);

      const firstState = await sql<{ used: boolean; request_status: string; token_count: string }[]>`
        select
          code.used_at is not null as used,
          auth_request.status as request_status,
          count(token.id)::text as token_count
        from oauth_authorization_codes code
        join oauth_authorization_requests auth_request on auth_request.id = code.authorization_request_id
        left join oauth_access_tokens token on token.code_id = code.id
        where code.id = ${firstCode.codeId}
        group by code.used_at, auth_request.status
      `;
      expect(firstState[0]).toEqual({ used: true, request_status: "exchanged", token_count: "1" });

      const secondCode = await seedAuthorizationCode(sql, {
        userId,
        oauthClientId,
        connectionId,
        redirectUri,
        resource,
        codeChallenge,
        scopes
      });
      await expect(repository.exchangeOAuthAuthorizationCode({
        codeHash: secondCode.codeHash,
        clientId: publicClientId,
        redirectUri,
        codeChallenge,
        resource,
        tokenHash: tokenHashes[successfulIndex]!,
        expiresAt: new Date(Date.now() + 30 * 60_000)
      })).rejects.toThrow();

      const rolledBackState = await sql<{ used_at: Date | null; request_status: string; token_count: string }[]>`
        select code.used_at, auth_request.status as request_status, count(token.id)::text as token_count
        from oauth_authorization_codes code
        join oauth_authorization_requests auth_request on auth_request.id = code.authorization_request_id
        left join oauth_access_tokens token on token.code_id = code.id
        where code.id = ${secondCode.codeId}
        group by code.used_at, auth_request.status
      `;
      expect(rolledBackState[0]).toEqual({ used_at: null, request_status: "approved", token_count: "0" });

      const retry = await repository.exchangeOAuthAuthorizationCode({
        codeHash: secondCode.codeHash,
        clientId: publicClientId,
        redirectUri,
        codeChallenge,
        resource,
        tokenHash: sha256(`retry-token-${randomUUID()}`),
        expiresAt: new Date(Date.now() + 30 * 60_000)
      });
      expect(retry).not.toBeNull();
    } finally {
      await sql`delete from oauth_access_tokens where connection_id = ${connectionId}`;
      await sql`delete from oauth_authorization_codes where connection_id = ${connectionId}`;
      await sql`delete from oauth_authorization_requests where oauth_client_id = ${oauthClientId}`;
      await sql`delete from mcp_connections where id = ${connectionId}`;
      await sql`delete from oauth_clients where id = ${oauthClientId}`;
      await sql`delete from users where id = ${userId}`;
    }
  });
});

async function seedAuthorizationCode(
  sql: PostgresSql,
  input: {
    userId: string;
    oauthClientId: string;
    connectionId: string;
    redirectUri: string;
    resource: string;
    codeChallenge: string;
    scopes: string[];
  }
): Promise<{ codeId: string; codeHash: string }> {
  const requestId = randomUUID();
  const codeId = randomUUID();
  const codeHash = sha256(`authorization-code-${randomUUID()}`);
  await sql`
    insert into oauth_authorization_requests (
      id, oauth_client_id, redirect_uri, code_challenge, code_challenge_method,
      resource, audience, role_type, requested_scopes, approved_scopes,
      status, expires_at, approved_by_user_id, approved_at
    ) values (
      ${requestId}, ${input.oauthClientId}, ${input.redirectUri}, ${input.codeChallenge}, 'S256',
      ${input.resource}, ${input.resource}, 'creator', ${input.scopes}, ${input.scopes},
      'approved', now() + interval '10 minutes', ${input.userId}, now()
    )
  `;
  await sql`
    insert into oauth_authorization_codes (
      id, code_hash, authorization_request_id, oauth_client_id, actor_user_id,
      connection_id, role_type, redirect_uri, code_challenge, code_challenge_method,
      resource, audience, scopes, expires_at
    ) values (
      ${codeId}, ${codeHash}, ${requestId}, ${input.oauthClientId}, ${input.userId},
      ${input.connectionId}, 'creator', ${input.redirectUri}, ${input.codeChallenge}, 'S256',
      ${input.resource}, ${input.resource}, ${input.scopes}, now() + interval '10 minutes'
    )
  `;
  return { codeId, codeHash };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sha256Base64Url(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}
