import { createHash, randomBytes } from "node:crypto";

export const mcpScopes = [
  "creator.profile.read",
  "creator.profile.draft",
  "creator.metrics.read",
  "creator.drafts.read",
  "creator.drafts.write",
  "creator.events.read",
  "creator.events.draft",
  "creator.media.read",
  "creator.media.label",
  "creator.publish.request",
  "admin.health.read",
  "admin.support.read",
  "admin.support.draft",
  "admin.moderation.read",
  "admin.moderation.draft",
  "admin.payments.read",
  "admin.tasks.create"
];

export const mcpSeedProfiles = {
  "mcp-inspector-local": {
    clientName: "MCP Inspector local",
    clientType: "custom",
    clientId: "veel-mcp-inspector-local",
    redirectUris: ["http://127.0.0.1:6274/oauth/callback", "http://localhost:6274/oauth/callback"],
    allowedScopes: ["creator.profile.read"]
  },
  "claude-code-local": {
    clientName: "Claude Code local",
    clientType: "claude_code",
    clientId: "veel-claude-code-local",
    redirectUris: [],
    allowedScopes: ["creator.profile.read"]
  },
  "claude-web-staging": {
    clientName: "Claude web staging",
    clientType: "claude",
    clientId: "veel-claude-web-staging",
    redirectUris: [],
    allowedScopes: ["creator.profile.read"]
  },
  "openai-remote-staging": {
    clientName: "OpenAI remote MCP staging",
    clientType: "openai",
    clientId: "veel-openai-remote-staging",
    redirectUris: [],
    allowedScopes: ["creator.profile.read"]
  },
  "custom-http-smoke": {
    clientName: "Custom HTTP smoke client",
    clientType: "custom",
    clientId: "veel-custom-http-smoke",
    redirectUris: ["http://127.0.0.1:8787/callback", "http://localhost:8787/callback"],
    allowedScopes: ["creator.profile.read"]
  }
};

const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
const clientTypes = new Set(["claude", "claude_code", "cursor", "openai", "custom", "internal"]);
const scopeSet = new Set(mcpScopes);

export function parseCsv(value) {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function redactToken(value) {
  if (!value) return "";
  const token = String(value);
  if (token.length <= 10) return "[redacted]";
  return `${token.slice(0, 6)}...[redacted]...${token.slice(-4)}`;
}

export function validateMcpScopes(scopes) {
  const unknown = scopes.filter((scope) => !scopeSet.has(scope));
  if (unknown.length > 0) {
    throw new Error(`Unknown MCP scope(s): ${unknown.join(", ")}`);
  }
  if (scopes.length === 0) {
    throw new Error("At least one MCP scope is required.");
  }
}

export function validateClientType(clientType) {
  if (!clientTypes.has(clientType)) {
    throw new Error(`Unsupported MCP client type: ${clientType}`);
  }
}

export function validateRedirectUris(redirectUris, { production = false } = {}) {
  if (redirectUris.length === 0) {
    throw new Error("At least one exact redirect URI is required.");
  }

  for (const redirectUri of redirectUris) {
    if (redirectUri.includes("*")) {
      throw new Error(`Wildcard redirect URI is not allowed: ${redirectUri}`);
    }

    let url;
    try {
      url = new URL(redirectUri);
    } catch {
      throw new Error(`Invalid redirect URI: ${redirectUri}`);
    }

    const isLoopback = loopbackHosts.has(url.hostname) || loopbackHosts.has(url.host);
    if (production) {
      if (url.protocol !== "https:") {
        throw new Error(`Production redirect URI must use https: ${redirectUri}`);
      }
      if (isLoopback) {
        throw new Error(`Production redirect URI cannot use loopback host: ${redirectUri}`);
      }
    } else if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback)) {
      throw new Error(`Redirect URI must be https or local loopback http: ${redirectUri}`);
    }
  }
}

export function profileConfig(profileName, env = process.env) {
  const profile = mcpSeedProfiles[profileName];
  if (!profile) {
    throw new Error(`Unknown MCP OAuth seed profile: ${profileName}`);
  }

  const redirectUris = parseCsv(env.MCP_OAUTH_REDIRECT_URIS);
  const allowedScopes = parseCsv(env.MCP_OAUTH_ALLOWED_SCOPES);
  const clientType = env.MCP_OAUTH_CLIENT_TYPE ?? profile.clientType;

  return {
    profileName,
    clientName: env.MCP_OAUTH_CLIENT_NAME ?? profile.clientName,
    clientType,
    clientId: env.MCP_OAUTH_CLIENT_ID ?? profile.clientId,
    redirectUris: redirectUris.length > 0 ? redirectUris : profile.redirectUris,
    allowedScopes: allowedScopes.length > 0 ? allowedScopes : profile.allowedScopes,
    publicClient: env.MCP_OAUTH_PUBLIC_CLIENT !== "false",
    clientCredential: env.MCP_OAUTH_CLIENT_SECRET ?? null
  };
}

export function validateSeedConfig(config, { production = false } = {}) {
  if (!config.clientName || !config.clientId) {
    throw new Error("MCP OAuth client name and client id are required.");
  }
  validateClientType(config.clientType);
  validateRedirectUris(config.redirectUris, { production });
  validateMcpScopes(config.allowedScopes);
  if (!config.publicClient && !config.clientCredential) {
    throw new Error("Confidential MCP OAuth clients require MCP_OAUTH_CLIENT_SECRET.");
  }
}

export function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function pkcePair() {
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge, method: "S256" };
}

export function buildAuthorizeUrl({ baseUrl, clientId, redirectUri, scope, resource, state, codeChallenge }) {
  const url = new URL("/oauth/authorize", baseUrl);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("resource", resource ?? new URL("/mcp", baseUrl).toString());
  url.searchParams.set("scope", scope);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  if (state) url.searchParams.set("state", state);
  return url.toString();
}
