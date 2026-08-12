#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import {
  mcpSeedProfiles,
  profileConfig,
  redactToken,
  sha256Hex,
  validateSeedConfig
} from "./mcp-proof-utils.mjs";

function usage() {
  console.log(`Usage: node scripts/seed-mcp-oauth-client.mjs --profile <name>

Profiles:
${Object.keys(mcpSeedProfiles).map((profile) => `- ${profile}`).join("\n")}

Env:
DATABASE_URL required
MCP_OAUTH_CLIENT_NAME optional
MCP_OAUTH_CLIENT_TYPE optional
MCP_OAUTH_CLIENT_ID optional
MCP_OAUTH_REDIRECT_URIS comma-separated
MCP_OAUTH_ALLOWED_SCOPES comma-separated
MCP_OAUTH_PUBLIC_CLIENT=true|false
MCP_OAUTH_CLIENT_SECRET required only when MCP_OAUTH_PUBLIC_CLIENT=false`);
}

function arg(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] ?? null;
}

export async function seedMcpOAuthClient({
  databaseUrl,
  config,
  production = false
}) {
  validateSeedConfig(config, { production });
  const sql = postgres(databaseUrl, { max: 1, idle_timeout: 5, prepare: false });
  const credentialHash = config.publicClient ? null : sha256Hex(config.clientCredential);

  try {
    const rows = await sql`
      insert into oauth_clients (
        id,
        client_id,
        client_name,
        client_type,
        client_mode,
        client_credential_hash,
        allowed_redirect_uris,
        allowed_scopes,
        status
      )
      values (
        ${randomUUID()},
        ${config.clientId},
        ${config.clientName},
        ${config.clientType},
        ${config.publicClient ? "public" : "confidential"},
        ${credentialHash},
        ${config.redirectUris},
        ${config.allowedScopes},
        'active'
      )
      on conflict (client_id) do update
      set
        client_name = excluded.client_name,
        client_type = excluded.client_type,
        client_mode = excluded.client_mode,
        client_credential_hash = excluded.client_credential_hash,
        allowed_redirect_uris = excluded.allowed_redirect_uris,
        allowed_scopes = excluded.allowed_scopes,
        status = 'active',
        updated_at = now()
      returning client_id, client_name, client_type, client_mode, allowed_redirect_uris, allowed_scopes, status
    `;

    return rows[0];
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    usage();
    return;
  }

  const profileName = arg("--profile") ?? process.env.MCP_OAUTH_SEED_PROFILE ?? "custom-http-smoke";
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to seed MCP OAuth clients.");
  }

  const production = process.env.NODE_ENV === "production" || process.env.DEPLOY_ENV === "production";
  const config = profileConfig(profileName);
  const client = await seedMcpOAuthClient({ databaseUrl, config, production });

  console.log("MCP OAuth client seeded.");
  console.log(`profile: ${profileName}`);
  console.log(`client_id: ${client.client_id}`);
  console.log(`client_name: ${client.client_name}`);
  console.log(`client_type: ${client.client_type}`);
  console.log(`client_mode: ${client.client_mode}`);
  console.log(`redirect_uris: ${client.allowed_redirect_uris.join(", ")}`);
  console.log(`allowed_scopes: ${client.allowed_scopes.join(" ")}`);
  if (config.clientCredential) {
    console.log(`client_credential: ${redactToken(config.clientCredential)}`);
  }
  console.log("Next: run scripts/smoke-mcp-oauth-pkce.mjs with this client_id and redirect URI.");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
