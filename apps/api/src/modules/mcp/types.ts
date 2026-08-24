export type McpClientType = "claude" | "claude_code" | "cursor" | "openai" | "custom" | "internal";
export type McpRoleType = "creator" | "admin";
export type McpConnectionState = "active" | "revoked" | "expired";
export type McpToolCallState = "allowed" | "denied" | "failed";
export type McpToolRiskLevel = "read" | "draft" | "request";
export type McpAuthMode = "scoped_token" | "oauth";
export type OAuthAuthorizationRequestState = "pending" | "approved" | "denied" | "expired" | "exchanged";

export type CreatorMcpScope =
  | "creator.profile.read"
  | "creator.profile.draft"
  | "creator.metrics.read"
  | "creator.drafts.read"
  | "creator.drafts.write"
  | "creator.events.read"
  | "creator.events.draft"
  | "creator.media.read"
  | "creator.media.label"
  | "creator.publish.request";

export type AdminMcpScope =
  | "admin.health.read"
  | "admin.support.read"
  | "admin.support.draft"
  | "admin.moderation.read"
  | "admin.moderation.draft"
  | "admin.payments.read"
  | "admin.tasks.create";

export type McpScope = CreatorMcpScope | AdminMcpScope;

export interface McpConnection {
  id: string;
  clientName: string;
  clientType: McpClientType;
  authMode: McpAuthMode;
  roleType: McpRoleType;
  state: McpConnectionState;
  tokenHint: string | null;
  scopes: McpScope[];
  expiresAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface CreatedMcpConnection extends McpConnection {
  token: string;
}

export interface CreateMcpConnectionInput {
  supabaseUserId: string;
  clientName: string;
  clientType: McpClientType;
  roleType: McpRoleType;
  tokenHash: string;
  tokenHint: string;
  scopes: McpScope[];
  idempotencyKey: string;
  expiresAt: Date;
}

export interface CreateOAuthConnectionInput {
  supabaseUserId: string;
  oauthClientId: string;
  clientName: string;
  clientType: McpClientType;
  roleType: McpRoleType;
  scopes: McpScope[];
  expiresAt: Date;
}

export interface CreateMcpConnectionRequest {
  clientName: string;
  clientType: McpClientType;
  roleType: McpRoleType;
  scopes: McpScope[];
}

export interface McpConnectionPage {
  items: McpConnection[];
  nextCursor: string | null;
}

export interface McpToolDefinition {
  name: string;
  version: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  requiredScopes: McpScope[];
  roleTypes: McpRoleType[];
  riskLevel: McpToolRiskLevel;
  annotations: {
    title: string;
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
    openWorldHint: boolean;
  };
}

export interface OAuthClient {
  id: string;
  clientId: string;
  clientName: string;
  clientType: McpClientType;
  clientMode: "public" | "confidential";
  allowedRedirectUris: string[];
  allowedScopes: McpScope[];
  status: "active" | "disabled";
}

export interface OAuthAuthorizationRequest {
  id: string;
  clientId: string;
  publicClientId: string;
  clientName: string;
  clientType: McpClientType;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
  state: string | null;
  resource: string;
  audience: string;
  roleType: McpRoleType;
  requestedScopes: McpScope[];
  approvedScopes: McpScope[] | null;
  status: OAuthAuthorizationRequestState;
  expiresAt: string;
  createdAt: string;
}

export interface OAuthAuthorizationCode {
  id: string;
  clientId: string;
  publicClientId: string;
  connectionId: string;
  supabaseUserId: string;
  roleType: McpRoleType;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
  resource: string;
  audience: string;
  scopes: McpScope[];
  expiresAt: string;
  usedAt: string | null;
}

export interface OAuthAccessTokenRecord extends McpConnection {
  supabaseUserId: string;
  oauthTokenId: string;
  oauthClientId: string;
  resource: string;
  audience: string;
  tokenExpiresAt: string;
  tokenRevokedAt: string | null;
}

export interface McpToolCallAuditInput {
  connectionId: string;
  supabaseUserId: string;
  toolName: string;
  state: McpToolCallState;
  riskLevel: McpToolRiskLevel;
  requiredScopes: McpScope[];
  inputSummary: string;
  outputSummary: string;
  inputRedacted: Record<string, unknown>;
  outputRedacted: Record<string, unknown>;
  deniedReason?: string | null;
}

export interface McpRepository {
  createConnection(input: CreateMcpConnectionInput): Promise<McpConnection>;
  createOAuthConnection(input: CreateOAuthConnectionInput): Promise<McpConnection>;
  listConnections(input: { supabaseUserId: string }): Promise<McpConnectionPage>;
  findConnectionForUser(input: {
    connectionId: string;
    supabaseUserId: string;
  }): Promise<McpConnection | null>;
  findConnectionByTokenHash(input: { tokenHash: string }): Promise<(McpConnection & { supabaseUserId: string }) | null>;
  findOAuthClientByClientId(input: { clientId: string }): Promise<OAuthClient | null>;
  createOAuthAuthorizationRequest(input: {
    oauthClientId: string;
    redirectUri: string;
    codeChallenge: string;
    codeChallengeMethod: "S256";
    state: string | null;
    resource: string;
    audience: string;
    roleType: McpRoleType;
    requestedScopes: McpScope[];
    expiresAt: Date;
  }): Promise<OAuthAuthorizationRequest>;
  findOAuthAuthorizationRequest(input: { requestId: string }): Promise<OAuthAuthorizationRequest | null>;
  approveOAuthAuthorizationRequest(input: {
    requestId: string;
    supabaseUserId: string;
    approvedScopes: McpScope[];
    codeHash: string;
    codeExpiresAt: Date;
    connectionExpiresAt: Date;
  }): Promise<OAuthAuthorizationCode | null>;
  denyOAuthAuthorizationRequest(input: { requestId: string; supabaseUserId: string }): Promise<OAuthAuthorizationRequest | null>;
  findOAuthAuthorizationCodeByHash(input: { codeHash: string }): Promise<OAuthAuthorizationCode | null>;
  markOAuthAuthorizationCodeUsed(input: { codeId: string }): Promise<void>;
  issueOAuthAccessToken(input: {
    codeId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<{ expiresAt: string; scopes: McpScope[] }>;
  findConnectionByOAuthAccessTokenHash(input: { tokenHash: string }): Promise<OAuthAccessTokenRecord | null>;
  revokeOAuthAccessTokenHash(input: { tokenHash: string }): Promise<void>;
  listActiveStaffRoles(input: { supabaseUserId: string }): Promise<string[]>;
  revokeConnection(input: {
    connectionId: string;
    supabaseUserId: string;
  }): Promise<McpConnection | null>;
  touchConnection(input: { connectionId: string }): Promise<void>;
  recordToolCall(input: McpToolCallAuditInput): Promise<void>;
  close?(): Promise<void>;
}
