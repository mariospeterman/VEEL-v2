#!/usr/bin/env node
import postgres from "postgres";
import { redactToken } from "./mcp-proof-utils.mjs";

export async function runMcpRemoteSmoke({
  baseUrl,
  accessToken,
  expectedTool = "creator_get_profile",
  forbiddenTool = "admin_list_payment_intents",
  connectionId = null,
  databaseUrl = null,
  fetchImpl = fetch,
  logger = console
}) {
  if (!baseUrl) throw new Error("MCP_PUBLIC_BASE_URL is required.");
  if (!accessToken) throw new Error("MCP_TEST_ACCESS_TOKEN is required.");

  const normalizedBaseUrl = baseUrl.replace(/\/$/, "");
  const protectedResource = await getJson(fetchImpl, `${normalizedBaseUrl}/.well-known/oauth-protected-resource`);
  assertEqual(protectedResource.resource, `${normalizedBaseUrl}/mcp`, "protected resource metadata resource");
  assertArrayIncludes(protectedResource.authorization_servers, normalizedBaseUrl, "authorization server metadata link");

  const authorizationServer = await getJson(fetchImpl, `${normalizedBaseUrl}/.well-known/oauth-authorization-server`);
  assertEqual(authorizationServer.issuer, normalizedBaseUrl, "authorization server issuer");
  assertArrayIncludes(authorizationServer.grant_types_supported, "authorization_code", "authorization code grant");

  const initialize = await postMcp(fetchImpl, normalizedBaseUrl, accessToken, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-11-25" }
  });
  if (initialize.result?.serverInfo?.name !== "wevid") {
    throw new Error("MCP initialize did not return expected serverInfo.name.");
  }
  assertEqual(initialize.result?.protocolVersion, "2025-11-25", "MCP protocol version");

  const toolsList = await postMcp(fetchImpl, normalizedBaseUrl, accessToken, {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
    params: {}
  }, "2025-11-25");
  const toolNames = toolsList.result?.tools?.map((tool) => tool.name) ?? [];
  assertArrayIncludes(toolNames, expectedTool, `expected allowed tool ${expectedTool}`);
  if (toolNames.includes(forbiddenTool)) {
    throw new Error(`Forbidden tool was present in tools/list: ${forbiddenTool}`);
  }

  const allowedCall = await postMcp(fetchImpl, normalizedBaseUrl, accessToken, {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: expectedTool, arguments: {} }
  }, "2025-11-25");
  if (allowedCall.error) {
    throw new Error(`Allowed MCP tool call failed: ${allowedCall.error.message ?? "unknown error"}`);
  }
  if (allowedCall.result?.content?.[0]?.type !== "text" || !allowedCall.result?.structuredContent) {
    throw new Error("Allowed MCP tool call did not return standard text and structured content.");
  }

  const forbiddenCall = await postMcp(fetchImpl, normalizedBaseUrl, accessToken, {
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: { name: forbiddenTool, arguments: {} }
  }, "2025-11-25");
  if (!forbiddenCall.error) {
    throw new Error(`Forbidden MCP tool call unexpectedly succeeded: ${forbiddenTool}`);
  }

  let auditRows = null;
  if (databaseUrl && connectionId) {
    auditRows = await countAuditRows(databaseUrl, connectionId);
    if (auditRows < 2) {
      throw new Error(`Expected at least 2 MCP audit rows for connection ${connectionId}, found ${auditRows}.`);
    }
  }

  logger.log("MCP remote smoke passed.");
  logger.log(`base_url: ${normalizedBaseUrl}`);
  logger.log(`token: ${redactToken(accessToken)}`);
  logger.log(`expected_tool: ${expectedTool}`);
  logger.log(`forbidden_tool: ${forbiddenTool}`);
  if (auditRows !== null) logger.log(`audit_rows: ${auditRows}`);

  return { ok: true, tools: toolNames, auditRows };
}

async function getJson(fetchImpl, url) {
  const response = await fetchImpl(url, { headers: { accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}.`);
  }
  return response.json();
}

async function postMcp(fetchImpl, baseUrl, accessToken, body, protocolVersion) {
  const response = await fetchImpl(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      ...(protocolVersion ? { "mcp-protocol-version": protocolVersion } : {})
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw new Error(`/mcp returned HTTP ${response.status}.`);
  }
  return response.json();
}

async function countAuditRows(databaseUrl, connectionId) {
  const sql = postgres(databaseUrl, { max: 1, idle_timeout: 5, prepare: false });
  try {
    const rows = await sql`
      select count(*)::int as count
      from mcp_tool_calls
      where connection_id = ${connectionId}
    `;
    return Number(rows[0]?.count ?? 0);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} mismatch. Expected ${expected}, got ${actual}.`);
  }
}

function assertArrayIncludes(values, expected, label) {
  if (!Array.isArray(values) || !values.includes(expected)) {
    throw new Error(`${label} missing ${expected}.`);
  }
}

async function main() {
  await runMcpRemoteSmoke({
    baseUrl: process.env.MCP_PUBLIC_BASE_URL,
    accessToken: process.env.MCP_TEST_ACCESS_TOKEN,
    expectedTool: process.env.MCP_TEST_EXPECTED_TOOL,
    forbiddenTool: process.env.MCP_TEST_FORBIDDEN_TOOL,
    connectionId: process.env.MCP_TEST_CONNECTION_ID,
    databaseUrl: process.env.DATABASE_URL
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
