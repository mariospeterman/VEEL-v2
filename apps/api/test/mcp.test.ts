import { createHash, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApi } from "../src/app";
import type { BuildApiOptions } from "../src/app";
import type { AdminRepository } from "../src/modules/admin/types";
import type { AgeRepository } from "../src/modules/age/types";
import type { ContentRepository, CreateContentDraftInput } from "../src/modules/content/types";
import type {
  McpConnection,
  McpRepository,
  McpScope,
  McpToolCallAuditInput,
  OAuthAuthorizationCode,
  OAuthAuthorizationRequest,
  OAuthClient
} from "../src/modules/mcp/types";
import type { ProfileRepository } from "../src/modules/profile/types";
import type { SessionRepository, ApplicationSessionVerifier } from "../src/modules/session/types";
import type { WalletRepository } from "../src/modules/wallet/types";

const previousEnv = { ...process.env };
const supabaseUserId = "00000000-0000-4000-8000-000000000001";

describe("external MCP connector foundation", () => {
  beforeEach(() => {
    process.env = {
      ...previousEnv,
      NODE_ENV: "test",
      MCP_ENABLED: "true",
      MCP_AUTH_MODE: "scoped_token",
      MCP_ALLOW_STATIC_TOKENS_DEV: "true",
      MCP_REQUIRE_OAUTH: "false",
      MCP_ALLOWED_CLIENTS: "claude,custom",
      MCP_CONNECTION_TOKEN_TTL_SECONDS: "3600"
    };
  });

  afterEach(() => {
    process.env = { ...previousEnv };
  });

  it("creates scoped token connections and never returns the token from list/get routes", async () => {
    const mcpRepository = new FakeMcpRepository();
    const app = await buildApi(testDependencies({ mcpRepository }));
    await app.ready();

    const created = await app.inject({
      method: "POST",
      url: "/v1/mcp/connections",
      headers: { authorization: "Bearer valid-token", "idempotency-key": "mcp-create-1" },
      payload: {
        clientName: "Claude local",
        clientType: "claude",
        roleType: "creator",
        scopes: ["creator.profile.read"]
      }
    });

    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      clientName: "Claude local",
      clientType: "claude",
      roleType: "creator",
      tokenHint: expect.any(String)
    });
    expect(created.json().token).toMatch(/^veel_mcp_/);

    const listed = await app.inject({
      method: "GET",
      url: "/v1/mcp/connections",
      headers: { authorization: "Bearer valid-token" }
    });

    expect(listed.statusCode).toBe(200);
    expect(listed.json().items).toHaveLength(1);
    expect(listed.json().items[0].token).toBeUndefined();

    await app.close();
  });

  it("rejects creator connections that request admin scopes", async () => {
    const app = await buildApi(testDependencies({ mcpRepository: new FakeMcpRepository() }));
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/v1/mcp/connections",
      headers: { authorization: "Bearer valid-token", "idempotency-key": "mcp-create-2" },
      payload: {
        clientName: "Bad scope",
        clientType: "claude",
        roleType: "creator",
        scopes: ["admin.payments.read"]
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: "validation_failed" });

    await app.close();
  });

  it("filters MCP tools by token scopes and audits denied scope violations", async () => {
    const mcpRepository = new FakeMcpRepository();
    const app = await buildApi(testDependencies({ mcpRepository }));
    await app.ready();
    const token = await createCreatorToken(app);

    const listResponse = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { authorization: `Bearer ${token}` },
      payload: { jsonrpc: "2.0", id: 1, method: "tools/list" }
    });

    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json().result.tools.map((tool: { name: string }) => tool.name)).toEqual([
      "creator_create_content_draft"
    ]);

    const deniedResponse = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "admin_list_payment_intents", arguments: {} }
      }
    });

    expect(deniedResponse.statusCode).toBe(200);
    expect(deniedResponse.json().error.message).toContain("required tool scope");
    expect(mcpRepository.toolCalls).toMatchObject([{ state: "denied" }]);

    await app.close();
  });

  it("runs a creator draft tool through the content repository without publishing", async () => {
    const mcpRepository = new FakeMcpRepository();
    const contentRepository = new FakeContentRepository();
    const app = await buildApi(testDependencies({ mcpRepository, contentRepository }));
    await app.ready();
    const token = await createCreatorToken(app);

    const response = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "creator_create_content_draft",
          arguments: {
            mediaType: "image",
            visibility: "private",
            nsfwLabel: "none",
            caption: "Private draft"
          }
        }
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().result.content[0].json.content).toMatchObject({
      mediaType: "image",
      caption: "Private draft"
    });
    expect(contentRepository.createdDrafts).toMatchObject([
      { visibility: "private", nsfwLabel: "none", representationMode: "not_declared" }
    ]);
    expect(mcpRepository.toolCalls).toMatchObject([{ state: "allowed" }]);

    await app.close();
  });
});

describe("MCP OAuth completion", () => {
  beforeEach(() => {
    process.env = {
      ...previousEnv,
      NODE_ENV: "test",
      API_URL: "http://localhost:4000",
      WEB_URL: "http://localhost:3000",
      MCP_ENABLED: "true",
      MCP_AUTH_MODE: "oauth",
      MCP_REQUIRE_OAUTH: "true",
      MCP_ALLOWED_CLIENTS: "claude,custom",
      MCP_CONNECTION_TOKEN_TTL_SECONDS: "3600",
      MCP_OAUTH_AUTH_CODE_TTL_SECONDS: "600",
      MCP_OAUTH_ACCESS_TOKEN_TTL_SECONDS: "3600"
    };
  });

  afterEach(() => {
    process.env = { ...previousEnv };
  });

  it("publishes OAuth metadata without dynamic client registration or refresh token support", async () => {
    const app = await buildApi(testDependencies({ mcpRepository: new FakeMcpRepository() }));
    await app.ready();

    const protectedResource = await app.inject({
      method: "GET",
      url: "/.well-known/oauth-protected-resource"
    });
    const authorizationServer = await app.inject({
      method: "GET",
      url: "/.well-known/oauth-authorization-server"
    });

    expect(protectedResource.statusCode).toBe(200);
    expect(protectedResource.json()).toMatchObject({
      resource: "http://localhost:4000/mcp",
      authorization_servers: ["http://localhost:4000"]
    });
    expect(authorizationServer.statusCode).toBe(200);
    expect(authorizationServer.json().registration_endpoint).toBeUndefined();
    expect(authorizationServer.json().grant_types_supported).toEqual(["authorization_code"]);

    await app.close();
  });

  it("rejects authorize requests without S256 PKCE and redirects valid requests to consent", async () => {
    const repository = new FakeMcpRepository();
    const app = await buildApi(testDependencies({ mcpRepository: repository }));
    await app.ready();

    const invalid = await app.inject({
      method: "GET",
      url: "/oauth/authorize?client_id=claude-test&redirect_uri=http%3A%2F%2Flocalhost%3A8787%2Fcallback&response_type=code&resource=http%3A%2F%2Flocalhost%3A4000%2Fmcp&scope=creator.profile.read"
    });
    expect(invalid.statusCode).toBe(400);

    const { challenge } = pkcePair();
    const valid = await app.inject({
      method: "GET",
      url: `/oauth/authorize?client_id=claude-test&redirect_uri=http%3A%2F%2Flocalhost%3A8787%2Fcallback&response_type=code&resource=http%3A%2F%2Flocalhost%3A4000%2Fmcp&scope=creator.profile.read&state=abc&code_challenge=${challenge}&code_challenge_method=S256`
    });

    expect(valid.statusCode).toBe(302);
    expect(valid.headers.location).toMatch(/^http:\/\/localhost:3000\/oauth\/mcp\/consent\?requestId=/);
    expect(repository.authorizationRequests).toHaveLength(1);

    await app.close();
  });

  it("approves consent, exchanges a single-use code, authorizes MCP, and revokes the token", async () => {
    const repository = new FakeMcpRepository();
    const app = await buildApi(testDependencies({ mcpRepository: repository }));
    await app.ready();

    const { verifier, challenge } = pkcePair();
    const authorize = await app.inject({
      method: "GET",
      url: `/oauth/authorize?client_id=claude-test&redirect_uri=http%3A%2F%2Flocalhost%3A8787%2Fcallback&response_type=code&resource=http%3A%2F%2Flocalhost%3A4000%2Fmcp&scope=creator.profile.read&state=state-1&code_challenge=${challenge}&code_challenge_method=S256`
    });
    const requestId = new URL(authorize.headers.location as string).searchParams.get("requestId");
    expect(requestId).toBeTruthy();

    const consent = await app.inject({
      method: "GET",
      url: `/oauth/consent/${requestId}`,
      headers: { authorization: "Bearer valid-token" }
    });
    expect(consent.statusCode).toBe(200);
    expect(consent.json()).toMatchObject({
      clientName: "Claude test",
      requestedScopes: ["creator.profile.read"]
    });

    const approval = await app.inject({
      method: "POST",
      url: `/oauth/consent/${requestId}/approve`,
      headers: { authorization: "Bearer valid-token" }
    });
    expect(approval.statusCode).toBe(200);
    const callback = new URL(approval.json().redirectUri);
    expect(callback.searchParams.get("state")).toBe("state-1");
    const code = callback.searchParams.get("code");
    expect(code).toMatch(/^veel_oauth_/);

    const wrongVerifier = await app.inject({
      method: "POST",
      url: "/oauth/token",
      payload: {
        grant_type: "authorization_code",
        client_id: "claude-test",
        redirect_uri: "http://localhost:8787/callback",
        code,
        code_verifier: "wrong-verifier-wrong-verifier-wrong-verifier-wrong"
      }
    });
    expect(wrongVerifier.statusCode).toBe(400);

    const tokenResponse = await app.inject({
      method: "POST",
      url: "/oauth/token",
      payload: {
        grant_type: "authorization_code",
        client_id: "claude-test",
        redirect_uri: "http://localhost:8787/callback",
        code,
        code_verifier: verifier
      }
    });
    expect(tokenResponse.statusCode).toBe(200);
    expect(tokenResponse.json()).toMatchObject({
      token_type: "Bearer",
      scope: "creator.profile.read"
    });

    const reuse = await app.inject({
      method: "POST",
      url: "/oauth/token",
      payload: {
        grant_type: "authorization_code",
        client_id: "claude-test",
        redirect_uri: "http://localhost:8787/callback",
        code,
        code_verifier: verifier
      }
    });
    expect(reuse.statusCode).toBe(400);

    const mcp = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { authorization: `Bearer ${tokenResponse.json().access_token}` },
      payload: { jsonrpc: "2.0", id: 1, method: "tools/list" }
    });
    expect(mcp.statusCode).toBe(200);
    expect(mcp.json().result.tools.map((tool: { name: string }) => tool.name)).toEqual(["creator_get_profile"]);

    const revoke = await app.inject({
      method: "POST",
      url: "/oauth/revoke",
      payload: { token: tokenResponse.json().access_token }
    });
    expect(revoke.statusCode).toBe(200);

    const denied = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { authorization: `Bearer ${tokenResponse.json().access_token}` },
      payload: { jsonrpc: "2.0", id: 2, method: "tools/list" }
    });
    expect(denied.statusCode).toBe(401);
    expect(denied.headers["www-authenticate"]).toContain("resource_metadata=");

    await app.close();
  });

  it("rejects admin OAuth scopes when the staff role is not allowed for that scope", async () => {
    const repository = new FakeMcpRepository();
    repository.staffRoles = ["finance"];
    const app = await buildApi(testDependencies({ mcpRepository: repository }));
    await app.ready();

    const { challenge } = pkcePair();
    const authorize = await app.inject({
      method: "GET",
      url: `/oauth/authorize?client_id=claude-admin-test&redirect_uri=http%3A%2F%2Flocalhost%3A8787%2Fcallback&response_type=code&resource=http%3A%2F%2Flocalhost%3A4000%2Fmcp&scope=admin.support.read&code_challenge=${challenge}&code_challenge_method=S256`
    });
    const requestId = new URL(authorize.headers.location as string).searchParams.get("requestId");

    const consent = await app.inject({
      method: "GET",
      url: `/oauth/consent/${requestId}`,
      headers: { authorization: "Bearer valid-token" }
    });
    expect(consent.statusCode).toBe(403);

    await app.close();
  });
});

async function createCreatorToken(app: Awaited<ReturnType<typeof buildApi>>): Promise<string> {
  const created = await app.inject({
    method: "POST",
    url: "/v1/mcp/connections",
    headers: { authorization: "Bearer valid-token", "idempotency-key": `mcp-create-${randomUUID()}` },
    payload: {
      clientName: "Claude local",
      clientType: "claude",
      roleType: "creator",
      scopes: ["creator.drafts.write"]
    }
  });

  return created.json().token;
}

function testDependencies(input: {
  mcpRepository: McpRepository;
  contentRepository?: FakeContentRepository;
}): BuildApiOptions {
  return {
    authVerifier: fakeAuthVerifier,
    sessionRepository: fakeSessionRepository,
    ageRepository: fakeAgeRepository,
    walletRepository: fakeWalletRepository,
    profileRepository: fakeProfileRepository,
    contentRepository: (input.contentRepository ?? new FakeContentRepository()) as unknown as ContentRepository,
    adminRepository: fakeAdminRepository,
    mcpRepository: input.mcpRepository
  };
}

const fakeAuthVerifier: ApplicationSessionVerifier = {
  async verifyToken(token) {
    return token === "valid-token" ? {
      userId: supabaseUserId,
      supabaseUserId,
      sessionId: "00000000-0000-4000-8000-000000000099",
      authenticatedAt: new Date(),
      authenticationMethod: "wallet"
    } : null;
  }
};

const fakeSessionRepository: SessionRepository = {
  async findProfileByUserId() {
    return this.findProfileBySupabaseUserId(supabaseUserId);
  },
  async findProfileBySupabaseUserId() {
    return {
      id: "00000000-0000-4000-8000-000000000010",
      state: "active",
      handle: "creator",
      displayName: "Creator",
      avatarUrl: null
    };
  }
};

const fakeAgeRepository = {
  async findLatestAgeStatusBySupabaseUserId() {
    return { state: "verified" };
  },
  async createPendingAgeVerification() {},
  async applyProviderWebhook() {
    return "applied";
  },
  async updateVerificationFromWebhook() {
    return true;
  }
} as unknown as AgeRepository;

const fakeWalletRepository = {
  async hasWalletBySupabaseUserId() {
    return true;
  }
} as unknown as WalletRepository;

const fakeProfileRepository = {
  async getMyCreatorDashboard() {
    return { state: "active" };
  },
  async getMyCreatorOnboarding() {
    return { state: "ready" };
  }
} as unknown as ProfileRepository;

const fakeAdminRepository = {
  async hasAdminAccess() {
    return true;
  },
  async getOpsSummary() {
    return { status: "ok" };
  },
  async listSupportCases() {
    return { items: [], nextCursor: null };
  },
  async listPaymentIntents() {
    return { items: [], nextCursor: null };
  }
} as unknown as AdminRepository;

class FakeContentRepository {
  readonly createdDrafts: CreateContentDraftInput[] = [];

  async createDraft(input: CreateContentDraftInput) {
    this.createdDrafts.push(input);
    return {
      id: "00000000-0000-4000-8000-000000000099",
      creator: {
        id: "00000000-0000-4000-8000-000000000010",
        handle: "creator",
        displayName: "Creator",
        avatarUrl: null,
        badges: []
      },
      mediaType: input.mediaType,
      caption: input.caption ?? null,
      accessState: "free",
      nsfwLabel: input.nsfwLabel,
      engagement: { liked: false, saved: false, likeCount: 0, commentCount: 0 }
    };
  }
}

class FakeMcpRepository implements McpRepository {
  readonly connections = new Map<string, McpConnection & { supabaseUserId: string; tokenHash: string }>();
  readonly oauthAccessTokens = new Map<string, McpConnection & {
    supabaseUserId: string;
    oauthTokenId: string;
    oauthClientId: string;
    resource: string;
    audience: string;
    tokenHash: string;
    tokenExpiresAt: string;
    tokenRevokedAt: string | null;
  }>();
  readonly authorizationRequests: OAuthAuthorizationRequest[] = [];
  readonly authorizationCodes = new Map<string, OAuthAuthorizationCode & { codeHash: string }>();
  readonly toolCalls: McpToolCallAuditInput[] = [];
  staffRoles = ["owner"];
  readonly clients: OAuthClient[] = [
    {
      id: "00000000-0000-4000-8000-000000000201",
      clientId: "claude-test",
      clientName: "Claude test",
      clientType: "claude",
      clientMode: "public",
      allowedRedirectUris: ["http://localhost:8787/callback"],
      allowedScopes: ["creator.profile.read", "creator.drafts.write"],
      status: "active"
    },
    {
      id: "00000000-0000-4000-8000-000000000202",
      clientId: "claude-admin-test",
      clientName: "Claude admin test",
      clientType: "claude",
      clientMode: "public",
      allowedRedirectUris: ["http://localhost:8787/callback"],
      allowedScopes: ["admin.health.read", "admin.support.read", "admin.payments.read"],
      status: "active"
    }
  ];

  async createConnection(input: Parameters<McpRepository["createConnection"]>[0]) {
    const connection = {
      id: randomUUID(),
      supabaseUserId: input.supabaseUserId,
      clientName: input.clientName,
      clientType: input.clientType,
      authMode: "scoped_token" as const,
      roleType: input.roleType,
      state: "active" as const,
      tokenHash: input.tokenHash,
      tokenHint: input.tokenHint,
      scopes: input.scopes,
      expiresAt: input.expiresAt.toISOString(),
      lastUsedAt: null,
      revokedAt: null,
      createdAt: new Date().toISOString()
    };
    this.connections.set(connection.id, connection);
    return stripHash(connection);
  }

  async createOAuthConnection(input: Parameters<McpRepository["createOAuthConnection"]>[0]) {
    const connection = {
      id: randomUUID(),
      supabaseUserId: input.supabaseUserId,
      clientName: input.clientName,
      clientType: input.clientType,
      authMode: "oauth" as const,
      roleType: input.roleType,
      state: "active" as const,
      tokenHash: "",
      tokenHint: null,
      scopes: input.scopes,
      expiresAt: input.expiresAt.toISOString(),
      lastUsedAt: null,
      revokedAt: null,
      createdAt: new Date().toISOString()
    };
    this.connections.set(connection.id, connection);
    return stripHash(connection);
  }

  async listConnections() {
    return {
      items: [...this.connections.values()].map(stripHash),
      nextCursor: null
    };
  }

  async findConnectionForUser(input: Parameters<McpRepository["findConnectionForUser"]>[0]) {
    const connection = this.connections.get(input.connectionId);
    return connection?.supabaseUserId === input.supabaseUserId ? stripHash(connection) : null;
  }

  async findConnectionByTokenHash(input: Parameters<McpRepository["findConnectionByTokenHash"]>[0]) {
    return [...this.connections.values()]
      .filter((connection) => connection.tokenHash === input.tokenHash)
      .map((connection) => ({ ...stripHash(connection), supabaseUserId: connection.supabaseUserId }))[0] ?? null;
  }

  async findOAuthClientByClientId(input: Parameters<McpRepository["findOAuthClientByClientId"]>[0]) {
    return this.clients.find((client) => client.clientId === input.clientId) ?? null;
  }

  async createOAuthAuthorizationRequest(input: Parameters<McpRepository["createOAuthAuthorizationRequest"]>[0]) {
    const client = this.clients.find((item) => item.id === input.oauthClientId);
    if (!client) throw new Error("missing test client");
    const request: OAuthAuthorizationRequest = {
      id: randomUUID(),
      clientId: client.id,
      publicClientId: client.clientId,
      clientName: client.clientName,
      clientType: client.clientType,
      redirectUri: input.redirectUri,
      codeChallenge: input.codeChallenge,
      codeChallengeMethod: input.codeChallengeMethod,
      state: input.state,
      resource: input.resource,
      audience: input.audience,
      roleType: input.roleType,
      requestedScopes: input.requestedScopes,
      approvedScopes: null,
      status: "pending",
      expiresAt: input.expiresAt.toISOString(),
      createdAt: new Date().toISOString()
    };
    this.authorizationRequests.push(request);
    return request;
  }

  async findOAuthAuthorizationRequest(input: Parameters<McpRepository["findOAuthAuthorizationRequest"]>[0]) {
    return this.authorizationRequests.find((request) => request.id === input.requestId) ?? null;
  }

  async approveOAuthAuthorizationRequest(input: Parameters<McpRepository["approveOAuthAuthorizationRequest"]>[0]) {
    const request = this.authorizationRequests.find((item) => item.id === input.requestId);
    if (!request || request.status !== "pending") return null;
    const connection = await this.createOAuthConnection({
      supabaseUserId: input.supabaseUserId,
      oauthClientId: request.clientId,
      clientName: request.clientName,
      clientType: request.clientType,
      roleType: request.roleType,
      scopes: input.approvedScopes,
      expiresAt: input.connectionExpiresAt
    });
    const code: OAuthAuthorizationCode & { codeHash: string } = {
      id: randomUUID(),
      clientId: request.clientId,
      publicClientId: request.publicClientId,
      connectionId: connection.id,
      supabaseUserId: input.supabaseUserId,
      roleType: request.roleType,
      redirectUri: request.redirectUri,
      codeChallenge: request.codeChallenge,
      codeChallengeMethod: "S256",
      resource: request.resource,
      audience: request.audience,
      scopes: input.approvedScopes,
      expiresAt: input.codeExpiresAt.toISOString(),
      usedAt: null,
      codeHash: input.codeHash
    };
    request.status = "approved";
    request.approvedScopes = input.approvedScopes;
    this.authorizationCodes.set(code.id, code);
    return code;
  }

  async denyOAuthAuthorizationRequest(input: Parameters<McpRepository["denyOAuthAuthorizationRequest"]>[0]) {
    const request = this.authorizationRequests.find((item) => item.id === input.requestId);
    if (!request || request.status !== "pending") return null;
    request.status = "denied";
    return request;
  }

  async findOAuthAuthorizationCodeByHash(input: Parameters<McpRepository["findOAuthAuthorizationCodeByHash"]>[0]) {
    return [...this.authorizationCodes.values()].find((code) => code.codeHash === input.codeHash) ?? null;
  }

  async markOAuthAuthorizationCodeUsed(input: Parameters<McpRepository["markOAuthAuthorizationCodeUsed"]>[0]) {
    const code = this.authorizationCodes.get(input.codeId);
    if (code) code.usedAt = new Date().toISOString();
  }

  async issueOAuthAccessToken(input: Parameters<McpRepository["issueOAuthAccessToken"]>[0]) {
    const code = this.authorizationCodes.get(input.codeId);
    if (!code) throw new Error("missing code");
    const connection = this.connections.get(code.connectionId);
    if (!connection) throw new Error("missing connection");
    const token = {
      ...stripHash(connection),
      supabaseUserId: connection.supabaseUserId,
      oauthTokenId: randomUUID(),
      oauthClientId: code.clientId,
      resource: code.resource,
      audience: code.audience,
      tokenHash: input.tokenHash,
      tokenExpiresAt: input.expiresAt.toISOString(),
      tokenRevokedAt: null
    };
    this.oauthAccessTokens.set(token.oauthTokenId, token);
    return { expiresAt: token.tokenExpiresAt, scopes: code.scopes };
  }

  async findConnectionByOAuthAccessTokenHash(input: Parameters<McpRepository["findConnectionByOAuthAccessTokenHash"]>[0]) {
    return [...this.oauthAccessTokens.values()].find((token) =>
      token.tokenHash === input.tokenHash &&
      token.tokenRevokedAt === null &&
      new Date(token.tokenExpiresAt).getTime() > Date.now()
    ) ?? null;
  }

  async revokeOAuthAccessTokenHash(input: Parameters<McpRepository["revokeOAuthAccessTokenHash"]>[0]) {
    for (const token of this.oauthAccessTokens.values()) {
      if (token.tokenHash === input.tokenHash) {
        token.tokenRevokedAt = new Date().toISOString();
      }
    }
  }

  async listActiveStaffRoles() {
    return this.staffRoles;
  }

  async revokeConnection(input: Parameters<McpRepository["revokeConnection"]>[0]) {
    const connection = this.connections.get(input.connectionId);
    if (!connection || connection.supabaseUserId !== input.supabaseUserId) return null;
    connection.state = "revoked";
    connection.revokedAt = new Date().toISOString();
    for (const token of this.oauthAccessTokens.values()) {
      if (token.id === connection.id) {
        token.tokenRevokedAt = new Date().toISOString();
      }
    }
    return stripHash(connection);
  }

  async touchConnection(input: Parameters<McpRepository["touchConnection"]>[0]) {
    const connection = this.connections.get(input.connectionId);
    if (connection) connection.lastUsedAt = new Date().toISOString();
  }

  async recordToolCall(input: McpToolCallAuditInput) {
    this.toolCalls.push(input);
  }
}

function stripHash(
  connection: McpConnection & { supabaseUserId: string; tokenHash: string }
): McpConnection {
  return {
    id: connection.id,
    clientName: connection.clientName,
    clientType: connection.clientType,
    authMode: connection.authMode,
    roleType: connection.roleType,
    state: connection.state,
    tokenHint: connection.tokenHint,
    scopes: connection.scopes as McpScope[],
    expiresAt: connection.expiresAt,
    lastUsedAt: connection.lastUsedAt,
    revokedAt: connection.revokedAt,
    createdAt: connection.createdAt
  };
}

function pkcePair() {
  const verifier = "a".repeat(64);
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}
