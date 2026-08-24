import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AdminRepository } from "../admin/types.js";
import type { AgeRepository } from "../age/types.js";
import type { AnalyticsRepository } from "../analytics/types.js";
import { extractBearerToken, unauthorizedResponse, verifyRequestSession } from "../auth/http-auth.js";
import type { ContentRepository, MediaUploadProviderAdapter } from "../content/types.js";
import type { ProfileRepository } from "../profile/types.js";
import type { SessionRepository, ApplicationSessionVerifier } from "../session/types.js";
import type { WalletRepository } from "../wallet/types.js";
import { McpRepositoryConfigurationError } from "./mcp-repository.js";
import {
  adminMcpScopes,
  creatorMcpScopes,
  findMcpTool,
  isMcpScope,
  McpToolValidationError,
  mcpToolDefinitions,
  redactedToolInput,
  runMcpTool,
  scopesAllowedForRole,
  summarizeValue,
  toolsForConnection
} from "./mcp-tools.js";
import type {
  CreateMcpConnectionRequest,
  McpClientType,
  McpConnection,
  McpRepository,
  McpRoleType,
  McpScope,
  OAuthAuthorizationRequest,
  OAuthClient,
  McpToolDefinition
} from "./types.js";
import { registerMcpMediaRoutes } from "./mcp-media-routes.js";

interface RegisterMcpRoutesOptions {
  authVerifier: ApplicationSessionVerifier;
  sessionRepository: SessionRepository;
  ageRepository: AgeRepository;
  walletRepository: WalletRepository;
  profileRepository: ProfileRepository;
  contentRepository: ContentRepository;
  adminRepository: AdminRepository;
  analyticsRepository: AnalyticsRepository;
  mcpRepository: McpRepository;
  mediaUploadProvider: MediaUploadProviderAdapter;
}

type McpAccess =
  | { ok: true; supabaseUserId: string }
  | { ok: false; statusCode: 401 | 403; body: { code: string; message: string } };

type McpTokenAccess =
  | { ok: true; connection: McpConnection & { supabaseUserId: string } }
  | { ok: false; statusCode: 401 | 403 | 404 | 503; body: { code: string; message: string } };

const toolCallBuckets = new Map<string, { count: number; resetAt: number }>();

export async function registerMcpRoutes(
  app: FastifyInstance,
  options: RegisterMcpRoutesOptions
): Promise<void> {
  await registerMcpMediaRoutes(app, options, (request) => verifyMcpTokenAccess(request, options));
  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string" },
    (_request, body, done) => {
      done(null, Object.fromEntries(new URLSearchParams(String(body))));
    }
  );

  app.get("/.well-known/oauth-protected-resource", async (_request, reply) => {
    const baseUrl = mcpPublicBaseUrl(app);
    return reply.send({
      resource: mcpResourceIdentifier(app),
      authorization_servers: [baseUrl],
      bearer_methods_supported: ["header"],
      scopes_supported: [...creatorMcpScopes, ...adminMcpScopes],
      resource_documentation: `${app.config.WEB_URL}/docs/mcp`,
      mcp_status:
        app.config.MCP_AUTH_MODE === "oauth"
          ? "oauth_required"
          : "scoped_token_foundation"
    });
  });

  app.get("/.well-known/oauth-authorization-server", async (_request, reply) => {
    const baseUrl = mcpPublicBaseUrl(app);
    return reply.send({
      issuer: baseUrl,
      authorization_endpoint: `${baseUrl}/oauth/authorize`,
      token_endpoint: `${baseUrl}/oauth/token`,
      revocation_endpoint: `${baseUrl}/oauth/revoke`,
      scopes_supported: [...creatorMcpScopes, ...adminMcpScopes],
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      revocation_endpoint_auth_methods_supported: ["none"],
      service_documentation: `${app.config.WEB_URL}/docs/mcp`,
      status: app.config.MCP_AUTH_MODE === "oauth" ? "active" : "scoped_token_dev_mode"
    });
  });

  app.get("/.well-known/openid-configuration", async (_request, reply) => {
    const baseUrl = mcpPublicBaseUrl(app);
    return reply.send({
      issuer: baseUrl,
      authorization_endpoint: `${baseUrl}/oauth/authorize`,
      token_endpoint: `${baseUrl}/oauth/token`,
      revocation_endpoint: `${baseUrl}/oauth/revoke`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      code_challenge_methods_supported: ["S256"],
      scopes_supported: [...creatorMcpScopes, ...adminMcpScopes]
    });
  });

  app.get("/oauth/authorize", async (request, reply) => {
    if (!app.config.MCP_ENABLED || app.config.MCP_AUTH_MODE !== "oauth") {
      return reply.code(503).send(serviceUnavailable("MCP OAuth authorization is disabled"));
    }

    const parsed = await parseAuthorizeRequest(request, app, options);
    if (!parsed.ok) {
      return reply.code(400).send(validationFailed(parsed.message));
    }

    try {
      const authorizationRequest = await options.mcpRepository.createOAuthAuthorizationRequest({
        oauthClientId: parsed.client.id,
        redirectUri: parsed.redirectUri,
        codeChallenge: parsed.codeChallenge,
        codeChallengeMethod: "S256",
        state: parsed.state,
        resource: parsed.resource,
        audience: parsed.resource,
        roleType: parsed.roleType,
        requestedScopes: parsed.scopes,
        expiresAt: new Date(Date.now() + app.config.MCP_OAUTH_AUTH_CODE_TTL_SECONDS * 1000)
      });

      return reply.redirect(consentUrl(app, authorizationRequest.id));
    } catch (error) {
      return handleMcpRepositoryError(request, reply, error);
    }
  });

  app.get("/oauth/consent/:requestId", async (request, reply) => {
    const access = await verifyMcpManagementAccess(request, options);
    if (!access.ok) return reply.code(access.statusCode).send(access.body);

    const params = request.params as { requestId?: string };
    if (!params.requestId) return reply.code(400).send(validationFailed("requestId is required"));

    try {
      const authorizationRequest = await options.mcpRepository.findOAuthAuthorizationRequest({
        requestId: params.requestId
      });
      if (!authorizationRequest) {
        return reply.code(404).send({ code: "not_found", message: "OAuth authorization request not found" });
      }

      const roleAccess = await verifyRoleAccess(
        access.supabaseUserId,
        authorizationRequest.roleType,
        options,
        authorizationRequest.requestedScopes
      );
      if (!roleAccess.ok) return reply.code(roleAccess.statusCode).send(roleAccess.body);

      return reply.send(publicConsentRequest(authorizationRequest));
    } catch (error) {
      return handleMcpRepositoryError(request, reply, error);
    }
  });

  app.post("/oauth/consent/:requestId/approve", async (request, reply) => {
    const access = await verifyMcpManagementAccess(request, options);
    if (!access.ok) return reply.code(access.statusCode).send(access.body);

    const params = request.params as { requestId?: string };
    if (!params.requestId) return reply.code(400).send(validationFailed("requestId is required"));

    try {
      const authorizationRequest = await options.mcpRepository.findOAuthAuthorizationRequest({
        requestId: params.requestId
      });
      if (!authorizationRequest) {
        return reply.code(404).send({ code: "not_found", message: "OAuth authorization request not found" });
      }
      if (authorizationRequest.status !== "pending") {
        return reply.code(400).send(validationFailed("OAuth authorization request is not pending"));
      }

      const roleAccess = await verifyRoleAccess(
        access.supabaseUserId,
        authorizationRequest.roleType,
        options,
        authorizationRequest.requestedScopes
      );
      if (!roleAccess.ok) return reply.code(roleAccess.statusCode).send(roleAccess.body);

      const code = `veel_oauth_${randomBytes(32).toString("base64url")}`;
      const authorizationCode = await options.mcpRepository.approveOAuthAuthorizationRequest({
        requestId: authorizationRequest.id,
        supabaseUserId: access.supabaseUserId,
        approvedScopes: authorizationRequest.requestedScopes,
        codeHash: hashToken(code),
        codeExpiresAt: new Date(Date.now() + app.config.MCP_OAUTH_AUTH_CODE_TTL_SECONDS * 1000),
        connectionExpiresAt: new Date(Date.now() + app.config.MCP_CONNECTION_TOKEN_TTL_SECONDS * 1000)
      });
      if (!authorizationCode) {
        return reply.code(400).send(validationFailed("OAuth authorization request could not be approved"));
      }

      return reply.send({ redirectUri: oauthRedirectUri(authorizationRequest, { code }) });
    } catch (error) {
      return handleMcpRepositoryError(request, reply, error);
    }
  });

  app.post("/oauth/consent/:requestId/deny", async (request, reply) => {
    const access = await verifyMcpManagementAccess(request, options);
    if (!access.ok) return reply.code(access.statusCode).send(access.body);

    const params = request.params as { requestId?: string };
    if (!params.requestId) return reply.code(400).send(validationFailed("requestId is required"));

    try {
      const authorizationRequest = await options.mcpRepository.denyOAuthAuthorizationRequest({
        requestId: params.requestId,
        supabaseUserId: access.supabaseUserId
      });
      if (!authorizationRequest) {
        return reply.code(404).send({ code: "not_found", message: "OAuth authorization request not found" });
      }

      return reply.send({
        redirectUri: oauthRedirectUri(authorizationRequest, {
          error: "access_denied",
          error_description: "User denied the MCP connection"
        })
      });
    } catch (error) {
      return handleMcpRepositoryError(request, reply, error);
    }
  });

  app.post("/oauth/token", async (request, reply) => {
    if (!app.config.MCP_ENABLED || app.config.MCP_AUTH_MODE !== "oauth") {
      return reply.code(503).send(serviceUnavailable("MCP OAuth token exchange is disabled"));
    }

    const body = formBody(request.body);
    if (body.grant_type !== "authorization_code") {
      return reply.code(400).send(oauthError("unsupported_grant_type", "Only authorization_code is supported"));
    }
    if (!body.client_id || !body.code || !body.redirect_uri || !body.code_verifier) {
      return reply.code(400).send(oauthError("invalid_request", "client_id, code, redirect_uri, and code_verifier are required"));
    }

    try {
      const [client, authorizationCode] = await Promise.all([
        options.mcpRepository.findOAuthClientByClientId({ clientId: body.client_id }),
        options.mcpRepository.findOAuthAuthorizationCodeByHash({ codeHash: hashToken(body.code) })
      ]);
      if (!client || client.status !== "active" || !authorizationCode || authorizationCode.publicClientId !== body.client_id) {
        return reply.code(400).send(oauthError("invalid_grant", "Authorization code is invalid"));
      }
      if (authorizationCode.usedAt || new Date(authorizationCode.expiresAt).getTime() <= Date.now()) {
        return reply.code(400).send(oauthError("invalid_grant", "Authorization code is expired or already used"));
      }
      if (authorizationCode.redirectUri !== body.redirect_uri) {
        return reply.code(400).send(oauthError("invalid_grant", "redirect_uri does not match"));
      }
      if (!verifyPkce(body.code_verifier, authorizationCode.codeChallenge)) {
        return reply.code(400).send(oauthError("invalid_grant", "PKCE verification failed"));
      }

      await options.mcpRepository.markOAuthAuthorizationCodeUsed({ codeId: authorizationCode.id });
      const accessToken = `veel_oauth_at_${randomBytes(32).toString("base64url")}`;
      const issued = await options.mcpRepository.issueOAuthAccessToken({
        codeId: authorizationCode.id,
        tokenHash: hashToken(accessToken),
        expiresAt: new Date(Date.now() + app.config.MCP_OAUTH_ACCESS_TOKEN_TTL_SECONDS * 1000)
      });

      return reply.send({
        access_token: accessToken,
        token_type: "Bearer",
        expires_in: Math.max(0, Math.floor((new Date(issued.expiresAt).getTime() - Date.now()) / 1000)),
        scope: issued.scopes.join(" ")
      });
    } catch (error) {
      return handleMcpRepositoryError(request, reply, error);
    }
  });

  app.post("/oauth/revoke", async (request, reply) => {
    const body = formBody(request.body);
    if (body.token) {
      try {
        await options.mcpRepository.revokeOAuthAccessTokenHash({ tokenHash: hashToken(body.token) });
      } catch (error) {
        return handleMcpRepositoryError(request, reply, error);
      }
    }

    return reply.code(200).send({});
  });

  app.get("/v1/mcp/tools", async (request, reply) => {
    const access = await verifyMcpManagementAccess(request, options);
    if (!access.ok) return reply.code(access.statusCode).send(access.body);

    const isAdmin = await options.adminRepository.hasAdminAccess(access.supabaseUserId);
    const roleTypes: McpRoleType[] = isAdmin ? ["creator", "admin"] : ["creator"];
    return reply.send({
      items: mcpToolDefinitions.filter((tool) =>
        tool.roleTypes.some((roleType) => roleTypes.includes(roleType))
      )
    });
  });

  app.get("/v1/mcp/connections", async (request, reply) => {
    const access = await verifyMcpManagementAccess(request, options);
    if (!access.ok) return reply.code(access.statusCode).send(access.body);

    try {
      return reply.send(await options.mcpRepository.listConnections(access));
    } catch (error) {
      return handleMcpRepositoryError(request, reply, error);
    }
  });

  app.post("/v1/mcp/connections", async (request, reply) => {
    if (!app.config.MCP_ENABLED) {
      return reply.code(503).send(serviceUnavailable("MCP connector management is disabled"));
    }

    if (app.config.MCP_AUTH_MODE !== "scoped_token" || !app.config.MCP_ALLOW_STATIC_TOKENS_DEV) {
      return reply.code(501).send({
        code: "not_implemented",
        message: "MCP connection creation requires OAuth or explicit dev scoped-token mode"
      });
    }

    const access = await verifyMcpManagementAccess(request, options);
    if (!access.ok) return reply.code(access.statusCode).send(access.body);

    const idempotencyKey = requiredIdempotencyKey(request);
    if (!idempotencyKey) {
      return reply.code(400).send(validationFailed("Idempotency-Key header is required"));
    }

    const body = request.body as Partial<CreateMcpConnectionRequest> | undefined;
    const parsed = parseCreateConnectionRequest(body);
    if (!parsed.ok) return reply.code(400).send(validationFailed(parsed.message));

    if (!scopesAllowedForRole(parsed.body.roleType, parsed.body.scopes)) {
      return reply.code(400).send(validationFailed("Requested scopes are not valid for the requested role"));
    }

    const allowedClient = clientAllowed(app.config.MCP_ALLOWED_CLIENTS, parsed.body.clientType);
    if (!allowedClient) {
      return reply.code(403).send({
        code: "forbidden",
        message: "MCP client type is not allow-listed"
      });
    }

    const roleAccess = await verifyRoleAccess(access.supabaseUserId, parsed.body.roleType, options, parsed.body.scopes);
    if (!roleAccess.ok) return reply.code(roleAccess.statusCode).send(roleAccess.body);

    const token = `veel_mcp_${randomBytes(32).toString("base64url")}`;
    const tokenHint = token.slice(-6);
    const tokenHash = hashToken(token);

    try {
      const connection = await options.mcpRepository.createConnection({
        supabaseUserId: access.supabaseUserId,
        clientName: parsed.body.clientName,
        clientType: parsed.body.clientType,
        roleType: parsed.body.roleType,
        tokenHash,
        tokenHint,
        idempotencyKey,
        scopes: parsed.body.scopes,
        expiresAt: new Date(Date.now() + app.config.MCP_CONNECTION_TOKEN_TTL_SECONDS * 1000)
      });

      return reply.code(201).send({ ...connection, token });
    } catch (error) {
      return handleMcpRepositoryError(request, reply, error);
    }
  });

  app.get("/v1/mcp/connections/:mcpConnectionId", async (request, reply) => {
    const access = await verifyMcpManagementAccess(request, options);
    if (!access.ok) return reply.code(access.statusCode).send(access.body);

    const params = request.params as { mcpConnectionId?: string };
    if (!params.mcpConnectionId) return reply.code(400).send(validationFailed("mcpConnectionId is required"));

    try {
      const connection = await options.mcpRepository.findConnectionForUser({
        connectionId: params.mcpConnectionId,
        supabaseUserId: access.supabaseUserId
      });
      return connection
        ? reply.send(connection)
        : reply.code(404).send({ code: "not_found", message: "MCP connection not found" });
    } catch (error) {
      return handleMcpRepositoryError(request, reply, error);
    }
  });

  app.post("/v1/mcp/connections/:mcpConnectionId/revoke", async (request, reply) => {
    const access = await verifyMcpManagementAccess(request, options);
    if (!access.ok) return reply.code(access.statusCode).send(access.body);

    if (!requiredIdempotencyKey(request)) {
      return reply.code(400).send(validationFailed("Idempotency-Key header is required"));
    }

    const params = request.params as { mcpConnectionId?: string };
    if (!params.mcpConnectionId) return reply.code(400).send(validationFailed("mcpConnectionId is required"));

    try {
      const connection = await options.mcpRepository.revokeConnection({
        connectionId: params.mcpConnectionId,
        supabaseUserId: access.supabaseUserId
      });
      return connection
        ? reply.send(connection)
        : reply.code(404).send({ code: "not_found", message: "MCP connection not found" });
    } catch (error) {
      return handleMcpRepositoryError(request, reply, error);
    }
  });

  app.get("/mcp", async (request, reply) => {
    if (!isAllowedMcpOrigin(request, app)) {
      return reply.code(403).send({ code: "forbidden", message: "MCP request origin is not allowed" });
    }
    if (hasUnsupportedMcpProtocolHeader(request)) {
      return reply.code(400).send({ code: "invalid_protocol_version", message: "Unsupported MCP protocol version" });
    }
    if (!app.config.MCP_ENABLED) {
      return reply.code(404).send({ code: "not_found", message: "MCP connector is disabled" });
    }
    reply.header("Allow", "POST");
    return reply.code(405).send({ code: "method_not_allowed", message: "This MCP server does not provide an SSE stream" });
  });

  app.post("/mcp", async (request, reply) => {
    if (!isAllowedMcpOrigin(request, app)) {
      return reply.code(403).send({ code: "forbidden", message: "MCP request origin is not allowed" });
    }
    if (hasUnsupportedMcpProtocolHeader(request)) {
      return reply.code(400).send({ code: "invalid_protocol_version", message: "Unsupported MCP protocol version" });
    }
    const tokenAccess = await verifyMcpTokenAccess(request, options);
    if (!tokenAccess.ok) {
      if (tokenAccess.statusCode === 401) setMcpOAuthChallenge(reply, app);
      return reply.code(tokenAccess.statusCode).send(tokenAccess.body);
    }

    const message = request.body as { jsonrpc?: string; id?: unknown; method?: string; params?: unknown };
    if (message?.jsonrpc !== "2.0" || typeof message.method !== "string") {
      return reply.code(400).send(jsonRpcError(null, -32600, "Invalid JSON-RPC request"));
    }

    if (message.method === "initialize") {
      const requestedProtocolVersion = initializeProtocolVersion(message.params);
      return reply.send({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: requestedProtocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "wevid", version: "0.2.0" }
        }
      });
    }

    if (message.method === "notifications/initialized") {
      return reply.code(202).send();
    }

    if (message.method === "tools/list") {
      return reply.send({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          tools: toolsForConnection(tokenAccess.connection).map(publicToolDefinition)
        }
      });
    }

    if (message.method === "tools/call") {
      return handleToolCall({
        app,
        request,
        reply,
        options,
        id: message.id,
        connection: tokenAccess.connection,
        params: message.params
      });
    }

    return reply.send(jsonRpcError(message.id, -32601, "Method not found"));
  });
}

async function handleToolCall(input: {
  app: FastifyInstance;
  request: FastifyRequest;
  reply: FastifyReply;
  options: RegisterMcpRoutesOptions;
  id: unknown;
  connection: McpConnection & { supabaseUserId: string };
  params: unknown;
}) {
  const parsed = parseToolCallParams(input.params);
  if (!parsed.ok) {
    return input.reply.send(jsonRpcError(input.id, -32602, parsed.message));
  }

  const tool = findMcpTool(parsed.name);
  if (!tool) {
    await auditDeniedTool(input.options, input.connection, parsed.name, parsed.arguments, "Tool is not registered");
    return input.reply.send(jsonRpcError(input.id, -32602, "Tool is not registered"));
  }

  const granted = new Set(input.connection.scopes);
  const allowed =
    tool.roleTypes.includes(input.connection.roleType) &&
    tool.requiredScopes.every((scope) => granted.has(scope));

  if (!allowed) {
    await auditDeniedTool(
      input.options,
      input.connection,
      tool.name,
      parsed.arguments,
      "Connection is missing the required tool scope"
    );
    return input.reply.send(jsonRpcError(input.id, -32603, "Connection is missing the required tool scope"));
  }

  if (!consumeToolRateLimit(input.connection.id, input.app.config.MCP_TOOL_CALL_RATE_LIMIT_PER_MINUTE)) {
    await auditDeniedTool(input.options, input.connection, tool.name, parsed.arguments, "Tool rate limit exceeded");
    return input.reply.send(jsonRpcError(input.id, -32029, "Tool rate limit exceeded"));
  }

  try {
    const result = await runMcpTool({
      connection: input.connection,
      tool,
      params: parsed.arguments,
      profileRepository: input.options.profileRepository,
      contentRepository: input.options.contentRepository,
      adminRepository: input.options.adminRepository,
      analyticsRepository: input.options.analyticsRepository
    });

    try {
      await Promise.all([
        input.options.mcpRepository.touchConnection({ connectionId: input.connection.id }),
        input.options.mcpRepository.recordToolCall({
          connectionId: input.connection.id,
          supabaseUserId: input.connection.supabaseUserId,
          toolName: tool.name,
          state: "allowed",
          riskLevel: tool.riskLevel,
          requiredScopes: tool.requiredScopes,
          inputSummary: summarizeValue(parsed.arguments),
          outputSummary: summarizeValue(result),
          inputRedacted: redactedToolInput(parsed.arguments),
          outputRedacted: redactedToolInput(result)
        })
      ]);
    } catch (persistenceError) {
      if (!isFreshPrivateMediaCapabilityResult(tool.name, result)) throw persistenceError;
      // Capability issuance already writes its durable audit event in the same
      // transaction. Ancillary MCP activity persistence must not suppress the
      // only response that contains this one-time secret.
      input.request.log.warn(
        { error: persistenceError, connectionId: input.connection.id },
        "MCP capability issued despite ancillary activity persistence failure"
      );
    }

    return input.reply.send({
      jsonrpc: "2.0",
      id: input.id,
      result: {
        content: [{ type: "text", text: JSON.stringify(result) }],
        structuredContent: result
      }
    });
  } catch (error) {
    const message =
      error instanceof McpToolValidationError ? error.message : "MCP tool execution failed";
    await input.options.mcpRepository.recordToolCall({
      connectionId: input.connection.id,
      supabaseUserId: input.connection.supabaseUserId,
      toolName: tool.name,
      state: "failed",
      riskLevel: tool.riskLevel,
      requiredScopes: tool.requiredScopes,
      inputSummary: summarizeValue(parsed.arguments),
      outputSummary: message,
      inputRedacted: redactedToolInput(parsed.arguments),
      outputRedacted: { message },
      deniedReason: message
    });
    if (!(error instanceof McpToolValidationError)) {
      input.request.log.warn({ error }, "MCP tool execution failed");
    }
    return input.reply.send(jsonRpcError(input.id, -32603, message));
  }
}

function isFreshPrivateMediaCapabilityResult(toolName: string, result: unknown): boolean {
  if (toolName !== "creator_prepare_private_media_upload" || !result || typeof result !== "object") {
    return false;
  }
  const capability = (result as { capability?: unknown }).capability;
  return Boolean(
    capability &&
    typeof capability === "object" &&
    (capability as { status?: unknown }).status === "issued" &&
    typeof (capability as { capabilityToken?: unknown }).capabilityToken === "string"
  );
}

async function verifyMcpManagementAccess(
  request: FastifyRequest,
  options: RegisterMcpRoutesOptions
): Promise<McpAccess> {
  const verifiedSession = await verifyRequestSession(request, options.authVerifier);
  if (!verifiedSession) {
    return {
      ok: false,
      statusCode: 401,
      body: unauthorizedResponse("Missing or invalid bearer token")
    };
  }

  return { ok: true, supabaseUserId: verifiedSession.supabaseUserId };
}

async function verifyRoleAccess(
  supabaseUserId: string,
  roleType: McpRoleType,
  options: RegisterMcpRoutesOptions,
  scopes?: McpScope[]
): Promise<McpAccess> {
  if (roleType === "admin") {
    const allowedScopes = await allowedAdminScopesForUser(supabaseUserId, options);
    const requestedScopes = scopes ?? [];
    const adminAllowed = requestedScopes.length > 0
      ? requestedScopes.every((scope) => allowedScopes.has(scope))
      : allowedScopes.size > 0;
    return adminAllowed
      ? { ok: true, supabaseUserId }
      : { ok: false, statusCode: 403, body: { code: "forbidden", message: "Admin MCP scopes require matching staff access" } };
  }

  if (scopes?.some((scope) => scope.startsWith("admin."))) {
    return {
      ok: false,
      statusCode: 403,
      body: { code: "forbidden", message: "Creator MCP connections cannot grant admin scopes" }
    };
  }

  const [profile, ageStatus, hasWallet] = await Promise.all([
    options.sessionRepository.findProfileBySupabaseUserId(supabaseUserId),
    options.ageRepository.findLatestAgeStatusBySupabaseUserId(supabaseUserId),
    options.walletRepository.hasWalletBySupabaseUserId(supabaseUserId)
  ]);

  return profile?.state === "active" && profile.handle && profile.displayName && ageStatus.state === "verified" && hasWallet
    ? { ok: true, supabaseUserId }
    : {
        ok: false,
        statusCode: 403,
        body: {
          code: "forbidden",
          message: "Creator MCP scopes require profile, age verification, and wallet readiness"
        }
      };
}

async function verifyMcpTokenAccess(
  request: FastifyRequest,
  options: RegisterMcpRoutesOptions
): Promise<McpTokenAccess> {
  if (!request.server.config.MCP_ENABLED) {
    return {
      ok: false,
      statusCode: 404,
      body: { code: "not_found", message: "MCP connector is disabled" }
    };
  }

  const token = extractBearerToken(request.headers.authorization);
  if (!token) {
    return {
      ok: false,
      statusCode: 401,
      body: unauthorizedResponse("Missing or invalid MCP bearer token")
    };
  }

  try {
    if (request.server.config.MCP_AUTH_MODE === "oauth") {
      const connection = await options.mcpRepository.findConnectionByOAuthAccessTokenHash({
        tokenHash: hashToken(token)
      });
      if (!connection || connection.resource !== mcpResourceIdentifier(request.server) || connection.audience !== mcpResourceIdentifier(request.server)) {
        return {
          ok: false,
          statusCode: 401,
          body: unauthorizedResponse("Missing or invalid MCP OAuth bearer token")
        };
      }
      if (connection.state !== "active") {
        return {
          ok: false,
          statusCode: 403,
          body: { code: "forbidden", message: "MCP connection is not active" }
        };
      }

      const roleAccess = await verifyRoleAccess(
        connection.supabaseUserId,
        connection.roleType,
        options,
        connection.scopes
      );
      if (!roleAccess.ok) return roleAccess;

      return { ok: true, connection };
    }

    const connection = await options.mcpRepository.findConnectionByTokenHash({
      tokenHash: hashToken(token)
    });
    if (!connection) {
      return {
        ok: false,
        statusCode: 401,
        body: unauthorizedResponse("Missing or invalid MCP bearer token")
      };
    }
    if (connection.state !== "active") {
      return {
        ok: false,
        statusCode: 403,
        body: { code: "forbidden", message: "MCP connection is not active" }
      };
    }

    return { ok: true, connection };
  } catch (error) {
    if (error instanceof McpRepositoryConfigurationError) {
      request.log.warn({ error }, "MCP repository is not configured");
      return {
        ok: false,
        statusCode: 503,
        body: serviceUnavailable("MCP repository is not configured")
      };
    }
    throw error;
  }
}

async function auditDeniedTool(
  options: RegisterMcpRoutesOptions,
  connection: McpConnection & { supabaseUserId: string },
  toolName: string,
  toolInput: unknown,
  reason: string
): Promise<void> {
  const registered = findMcpTool(toolName);
  await options.mcpRepository.recordToolCall({
    connectionId: connection.id,
    supabaseUserId: connection.supabaseUserId,
    toolName,
    state: "denied",
    riskLevel: registered?.riskLevel ?? "read",
    requiredScopes: registered?.requiredScopes ?? ["creator.profile.read"],
    inputSummary: summarizeValue(toolInput),
    outputSummary: reason,
    inputRedacted: redactedToolInput(toolInput),
    outputRedacted: { message: reason },
    deniedReason: reason
  });
}

function parseCreateConnectionRequest(
  body: Partial<CreateMcpConnectionRequest> | undefined
): { ok: true; body: CreateMcpConnectionRequest } | { ok: false; message: string } {
  const clientType = parseClientType(body?.clientType);
  const roleType = parseRoleType(body?.roleType);
  const scopes = Array.isArray(body?.scopes) ? body.scopes.filter(isMcpScope) : [];

  if (!body || typeof body.clientName !== "string" || body.clientName.trim().length === 0) {
    return { ok: false, message: "clientName is required" };
  }
  if (!clientType || !roleType || scopes.length !== body.scopes?.length || scopes.length === 0) {
    return { ok: false, message: "clientType, roleType, and valid scopes are required" };
  }

  return {
    ok: true,
    body: {
      clientName: body.clientName.trim().slice(0, 120),
      clientType,
      roleType,
      scopes
    }
  };
}

async function parseAuthorizeRequest(
  request: FastifyRequest,
  app: FastifyInstance,
  options: RegisterMcpRoutesOptions
): Promise<
  | {
      ok: true;
      client: OAuthClient;
      redirectUri: string;
      codeChallenge: string;
      state: string | null;
      resource: string;
      roleType: McpRoleType;
      scopes: McpScope[];
    }
  | { ok: false; message: string }
> {
  const query = request.query && typeof request.query === "object"
    ? (request.query as Record<string, unknown>)
    : {};
  const clientId = query.client_id;
  const redirectUri = query.redirect_uri;
  const responseType = query.response_type;
  const codeChallenge = query.code_challenge;
  const codeChallengeMethod = query.code_challenge_method;
  const resource = query.resource;
  const state = typeof query.state === "string" ? query.state : null;
  const scopeText = typeof query.scope === "string" ? query.scope : "";

  if (
    typeof clientId !== "string" ||
    typeof redirectUri !== "string" ||
    responseType !== "code" ||
    typeof codeChallenge !== "string" ||
    codeChallengeMethod !== "S256" ||
    typeof resource !== "string"
  ) {
    return { ok: false, message: "client_id, redirect_uri, response_type=code, code_challenge, code_challenge_method=S256, and resource are required" };
  }

  if (resource !== mcpResourceIdentifier(app)) {
    return { ok: false, message: "resource must match the MCP protected resource" };
  }

  const client = await options.mcpRepository.findOAuthClientByClientId({ clientId });
  if (!client || client.status !== "active") {
    return { ok: false, message: "OAuth client is not active" };
  }

  if (!client.allowedRedirectUris.includes(redirectUri)) {
    return { ok: false, message: "redirect_uri is not registered for this OAuth client" };
  }

  if (!clientAllowed(app.config.MCP_ALLOWED_CLIENTS, client.clientType)) {
    return { ok: false, message: "MCP client type is not allow-listed" };
  }

  const scopes = parseScopeList(scopeText);
  if (scopes.length === 0 || !scopesAllowedByClient(scopes, client)) {
    return { ok: false, message: "Requested scopes are not allowed for this OAuth client" };
  }

  const roleType = roleTypeForScopes(scopes);
  if (!roleType || !scopesAllowedForRole(roleType, scopes)) {
    return { ok: false, message: "Requested scopes must belong to one MCP role" };
  }

  return {
    ok: true,
    client,
    redirectUri,
    codeChallenge,
    state,
    resource,
    roleType,
    scopes
  };
}

function parseScopeList(value: string): McpScope[] {
  const scopes = value
    .split(/\s+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
  if (scopes.some((scope) => !isMcpScope(scope))) return [];
  return [...new Set(scopes)] as McpScope[];
}

function scopesAllowedByClient(scopes: McpScope[], client: OAuthClient): boolean {
  const allowed = new Set(client.allowedScopes);
  return scopes.every((scope) => allowed.has(scope));
}

function roleTypeForScopes(scopes: McpScope[]): McpRoleType | null {
  const creator = scopes.every((scope) => scope.startsWith("creator."));
  const admin = scopes.every((scope) => scope.startsWith("admin."));
  if (creator) return "creator";
  if (admin) return "admin";
  return null;
}

function publicConsentRequest(request: OAuthAuthorizationRequest) {
  return {
    id: request.id,
    clientName: request.clientName,
    clientType: request.clientType,
    roleType: request.roleType,
    resource: request.resource,
    requestedScopes: request.requestedScopes,
    status: request.status,
    expiresAt: request.expiresAt,
    createdAt: request.createdAt
  };
}

function formBody(body: unknown): Record<string, string> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return {};
  return Object.fromEntries(
    Object.entries(body as Record<string, unknown>)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
  );
}

function verifyPkce(codeVerifier: string, codeChallenge: string): boolean {
  if (codeVerifier.length < 43 || codeVerifier.length > 128) return false;
  const expected = createHash("sha256").update(codeVerifier).digest("base64url");
  return timingSafeStringEqual(expected, codeChallenge);
}

function timingSafeStringEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function oauthRedirectUri(
  request: Pick<OAuthAuthorizationRequest, "redirectUri" | "state">,
  params: { code?: string; error?: string; error_description?: string }
): string {
  const url = new URL(request.redirectUri);
  if (params.code) url.searchParams.set("code", params.code);
  if (params.error) url.searchParams.set("error", params.error);
  if (params.error_description) url.searchParams.set("error_description", params.error_description);
  if (request.state) url.searchParams.set("state", request.state);
  return url.toString();
}

function consentUrl(app: FastifyInstance, requestId: string): string {
  const url = new URL("/oauth/mcp/consent", app.config.WEB_URL);
  url.searchParams.set("requestId", requestId);
  return url.toString();
}

async function allowedAdminScopesForUser(
  supabaseUserId: string,
  options: RegisterMcpRoutesOptions
): Promise<Set<McpScope>> {
  const roles = await options.mcpRepository.listActiveStaffRoles({ supabaseUserId });
  const allowed = new Set<McpScope>();

  for (const role of roles) {
    for (const scope of adminScopesForStaffRole(role)) {
      allowed.add(scope);
    }
  }

  return allowed;
}

function adminScopesForStaffRole(role: string): McpScope[] {
  switch (role) {
    case "owner":
    case "admin":
      return [...adminMcpScopes];
    case "support":
    case "creator_success":
      return ["admin.health.read", "admin.support.read", "admin.support.draft"];
    case "finance":
      return ["admin.health.read", "admin.payments.read"];
    case "trust_safety":
      return ["admin.health.read", "admin.moderation.read", "admin.moderation.draft"];
    case "ops":
    case "ai_ops":
    case "event_ops":
    case "readonly_auditor":
      return ["admin.health.read"];
    default:
      return [];
  }
}

function parseToolCallParams(
  params: unknown
): { ok: true; name: string; arguments: unknown } | { ok: false; message: string } {
  const body = params && typeof params === "object" ? (params as Record<string, unknown>) : {};
  return typeof body.name === "string"
    ? { ok: true, name: body.name, arguments: body.arguments ?? {} }
    : { ok: false, message: "Tool name is required" };
}

function parseClientType(value: unknown): McpClientType | null {
  return typeof value === "string" &&
    ["claude", "claude_code", "cursor", "openai", "custom", "internal"].includes(value)
    ? (value as McpClientType)
    : null;
}

function parseRoleType(value: unknown): McpRoleType | null {
  return value === "creator" || value === "admin" ? value : null;
}

function clientAllowed(allowedClients: string, clientType: McpClientType): boolean {
  const allowed = allowedClients
    .split(",")
    .map((client) => client.trim())
    .filter(Boolean);
  return allowed.length === 0 || allowed.includes(clientType);
}

function publicToolDefinition(tool: McpToolDefinition) {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    outputSchema: tool.outputSchema,
    annotations: tool.annotations
  };
}

function initializeProtocolVersion(params: unknown): "2025-11-25" | "2025-06-18" {
  const requested = params && typeof params === "object"
    ? (params as Record<string, unknown>).protocolVersion
    : undefined;
  return requested === "2025-06-18" ? requested : "2025-11-25";
}

function isAllowedMcpOrigin(request: FastifyRequest, app: FastifyInstance): boolean {
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    if (origin !== new URL(origin).origin) return false;
    const allowedOrigins = [app.config.WEB_URL, app.config.API_URL, mcpPublicBaseUrl(app)]
      .map((value) => new URL(value).origin);
    return allowedOrigins.includes(new URL(origin).origin);
  } catch {
    return false;
  }
}

function hasUnsupportedMcpProtocolHeader(request: FastifyRequest): boolean {
  const version = request.headers["mcp-protocol-version"];
  if (version === undefined) return false;
  if (Array.isArray(version)) return true;
  return !["2025-03-26", "2025-06-18", "2025-11-25"].includes(version);
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function consumeToolRateLimit(connectionId: string, limit: number): boolean {
  const now = Date.now();
  const existing = toolCallBuckets.get(connectionId);
  if (!existing || existing.resetAt <= now) {
    toolCallBuckets.set(connectionId, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (existing.count >= limit) return false;
  existing.count += 1;
  return true;
}

function mcpPublicBaseUrl(app: FastifyInstance): string {
  return app.config.MCP_PUBLIC_BASE_URL ?? app.config.API_URL;
}

function mcpResourceIdentifier(app: FastifyInstance): string {
  return `${mcpPublicBaseUrl(app).replace(/\/$/, "")}/mcp`;
}

function setMcpOAuthChallenge(reply: FastifyReply, app: FastifyInstance): void {
  const metadataUrl = `${mcpPublicBaseUrl(app).replace(/\/$/, "")}/.well-known/oauth-protected-resource`;
  reply.header(
    "WWW-Authenticate",
    `Bearer resource_metadata="${metadataUrl}", scope="${creatorMcpScopes.join(" ")}"`
  );
}

function validationFailed(message: string) {
  return { code: "validation_failed", message };
}

function oauthError(error: string, errorDescription: string) {
  return { error, error_description: errorDescription };
}

function requiredIdempotencyKey(request: FastifyRequest): string | null {
  const idempotencyKey = request.headers["idempotency-key"];
  return typeof idempotencyKey === "string" && idempotencyKey.length > 0 ? idempotencyKey : null;
}

function serviceUnavailable(message: string) {
  return { code: "service_unavailable", message };
}

function jsonRpcError(id: unknown, code: number, message: string) {
  return {
    jsonrpc: "2.0",
    id,
    error: { code, message }
  };
}

function handleMcpRepositoryError(
  request: FastifyRequest,
  reply: FastifyReply,
  error: unknown
) {
  if (error instanceof McpRepositoryConfigurationError) {
    request.log.warn({ error }, "MCP repository is not configured");
    return reply.code(503).send(serviceUnavailable("MCP repository is not configured"));
  }

  throw error;
}
