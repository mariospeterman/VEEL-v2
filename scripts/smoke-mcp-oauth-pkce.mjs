#!/usr/bin/env node
import { buildAuthorizeUrl, pkcePair } from "./mcp-proof-utils.mjs";

export function buildPkceSmokeInstructions(env = process.env) {
  const baseUrl = requiredFrom(env, "MCP_PUBLIC_BASE_URL").replace(/\/$/, "");
  const clientId = requiredFrom(env, "MCP_OAUTH_CLIENT_ID");
  const redirectUri = requiredFrom(env, "MCP_OAUTH_REDIRECT_URI");
  const scope = env.MCP_OAUTH_SCOPE ?? "creator.profile.read";
  const resource = env.MCP_OAUTH_RESOURCE ?? `${baseUrl}/mcp`;
  const state = env.MCP_OAUTH_STATE ?? `mcp-${Date.now().toString(36)}`;
  const { verifier, challenge } = pkcePair();
  const authorizationUrl = buildAuthorizeUrl({
    baseUrl,
    clientId,
    redirectUri,
    scope,
    resource,
    state,
    codeChallenge: challenge
  });

  return {
    authorizationUrl,
    codeVerifier: verifier,
    tokenEndpoint: `${baseUrl}/oauth/token`,
    mcpUrl: `${baseUrl}/mcp`,
    curl: `curl -sS -X POST ${shellQuote(`${baseUrl}/oauth/token`)} -H 'content-type: application/json' -d ${shellQuote(JSON.stringify({
      grant_type: "authorization_code",
      client_id: clientId,
      redirect_uri: redirectUri,
      code: "PASTE_CODE_FROM_CALLBACK",
      code_verifier: verifier
    }))}`
  };
}

function requiredFrom(env, name) {
  const value = env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function main() {
  const instructions = buildPkceSmokeInstructions(process.env);
  console.log("Open this authorization URL in a browser with a signed-in VEEL session:");
  console.log(instructions.authorizationUrl);
  console.log("");
  console.log("Local-only PKCE code_verifier:");
  console.log(instructions.codeVerifier);
  console.log("");
  console.log(`Token endpoint: ${instructions.tokenEndpoint}`);
  console.log(`MCP URL: ${instructions.mcpUrl}`);
  console.log("");
  console.log("After consent redirects back, exchange the code with:");
  console.log(instructions.curl);
  console.log("");
  console.log("Then run:");
  console.log("MCP_TEST_ACCESS_TOKEN=... pnpm mcp:smoke");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
