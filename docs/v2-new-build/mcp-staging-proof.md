# MCP Staging Proof

Status: accepted
Scope: documentation
Last updated: 2026-06-13
Source of truth: yes

Owns:
- remote MCP local/staging proof commands
- OAuth client seed profiles for MCP staging
- external client connection runbooks

Defers to:
- `ai-mcp-use-cases.md`, `infra-decisions.md`, `route-map.md`, OpenAPI, and migrations for authoritative behavior

Does not own:
- new MCP product tools, AI/LLM platform behavior, provider credentials, or production client approvals

Launch scope:
- local and staging proof of the existing remote MCP connector

Non-goals:
- dynamic client registration, refresh tokens, new AI features, dangerous tools, or product surface expansion

## Implemented

- Remote MCP HTTP endpoint: `/mcp`
- OAuth protected resource metadata: `/.well-known/oauth-protected-resource`
- OAuth authorization server metadata: `/.well-known/oauth-authorization-server`
- OAuth authorization-code plus PKCE: `/oauth/authorize` and `/oauth/token`
- OAuth revocation: `/oauth/revoke`
- Authenticated web consent: `/oauth/consent/:requestId`
- Scoped tool listing and tool execution
- Hash-only authorization codes and access tokens
- Connection and token revocation
- Redacted MCP tool-call audit rows
- Local/staging seed and smoke scripts

## Still Requires Operational Proof

- Public HTTPS API deployment with `MCP_PUBLIC_BASE_URL=https://...`
- Pre-registered OAuth clients in `oauth_clients`
- Client-specific redirect URI configuration for each external MCP client
- Real MCP Inspector or external-client smoke against the public URL
- Revocation smoke against the same public URL
- Operator confirmation that audit rows are present after tool calls

## Seed Profiles

Use:

```bash
pnpm mcp:seed -- --profile custom-http-smoke
```

Supported profiles:

| Profile | Client type | Redirect handling | Default scopes |
| --- | --- | --- | --- |
| `mcp-inspector-local` | `custom` | local loopback defaults | `creator.profile.read` |
| `claude-code-local` | `claude_code` | operator must set `MCP_OAUTH_REDIRECT_URIS` for the active Claude Code callback | `creator.profile.read` |
| `claude-web-staging` | `claude` | operator must set the Claude connector callback URI from the active Claude setup screen | `creator.profile.read` |
| `openai-remote-staging` | `openai` | operator must set the OpenAI app/connector callback URI from the active OpenAI setup screen | `creator.profile.read` |
| `custom-http-smoke` | `custom` | local loopback defaults | `creator.profile.read` |

The seed script validates exact redirect URIs, rejects wildcard redirects, rejects unknown scopes, and stores only a credential hash when a confidential client is explicitly configured.

## Local Proof

1. Start the API and web apps:

```bash
PATH="/Users/maki/.nvm/versions/node/v22.16.0/bin:$PATH" pnpm --filter @veel/api dev
PATH="/Users/maki/.nvm/versions/node/v22.16.0/bin:$PATH" pnpm --filter @veel/web dev
```

2. Seed a local client:

```bash
DATABASE_URL=... MCP_OAUTH_SEED_PROFILE=custom-http-smoke pnpm mcp:seed
```

3. Generate a PKCE authorization URL:

```bash
MCP_PUBLIC_BASE_URL=http://localhost:4000 \
MCP_OAUTH_CLIENT_ID=veel-custom-http-smoke \
MCP_OAUTH_REDIRECT_URI=http://127.0.0.1:8787/callback \
pnpm mcp:oauth:pkce
```

4. Open the printed authorization URL in a browser with a signed-in VEEL session.

5. Approve consent. Copy the `code` query parameter from the callback URL.

6. Exchange the code using the printed curl command.

7. Run the smoke script with the returned access token:

```bash
MCP_PUBLIC_BASE_URL=http://localhost:4000 \
MCP_TEST_ACCESS_TOKEN=... \
pnpm mcp:smoke
```

8. Revoke the token:

```bash
curl -sS -X POST http://localhost:4000/oauth/revoke \
  -H 'content-type: application/json' \
  -d '{"token":"PASTE_ACCESS_TOKEN"}'
```

9. Re-run `pnpm mcp:smoke` with the revoked token and confirm it fails with HTTP 401.

## MCP Inspector Proof

Official MCP Inspector docs describe the Inspector as an interactive tool for testing and debugging MCP servers. Use it after a VEEL bearer token has been obtained through the local proof flow or through a staging OAuth flow.

1. Start Inspector:

```bash
npx @modelcontextprotocol/inspector
```

2. Configure the remote server URL:

```text
https://YOUR-STAGING-API.example/mcp
```

3. Add `Authorization: Bearer <access-token>` in Inspector’s auth/header controls when testing with a manually exchanged token.

4. Run:

- `initialize`
- `tools/list`
- `tools/call` for `creator_get_profile`
- `tools/call` for `admin_list_payment_intents` and confirm denial

5. Verify the connection row and MCP audit rows in staging database/admin tooling.

## Claude Code And Claude-Style Proof

Claude Code supports OAuth for remote MCP servers and marks a server as requiring authentication after 401 or 403 responses. VEEL returns a `WWW-Authenticate` challenge with `resource_metadata` from `/mcp`.

For Claude Code/local:

1. Determine the exact callback URI used by the active Claude Code setup.
2. Seed `claude-code-local` with that URI:

```bash
DATABASE_URL=... \
MCP_OAUTH_SEED_PROFILE=claude-code-local \
MCP_OAUTH_REDIRECT_URIS=... \
pnpm mcp:seed
```

3. Add the remote HTTP MCP server in Claude Code using the staging `/mcp` URL.
4. Complete the OAuth flow when Claude Code prompts.
5. Run `tools/list`, `creator_get_profile`, forbidden-tool denial, and revocation checks.

For Claude web/custom connectors:

- The server must be reachable from Anthropic’s cloud over public HTTPS.
- Configure the exact callback URI shown by Claude’s connector setup.
- Do not claim client compatibility until a real connector has completed OAuth, listed tools, executed the safe read tool, denied the forbidden tool, and failed after revocation.

## OpenAI-Compatible Remote MCP Proof

OpenAI remote MCP guidance supports a remote `server_url` and, where required, an OAuth authorization/access token. For API-side testing:

1. Seed `openai-remote-staging` with the exact callback URI from the OpenAI app/connector setup.
2. Complete OAuth and obtain an access token.
3. Configure the remote MCP server URL as:

```text
https://YOUR-STAGING-API.example/mcp
```

4. Provide the OAuth access token through the OpenAI client’s supported authorization field.
5. Verify `tools/list`, `creator_get_profile`, forbidden-tool denial, audit rows, and revocation.

Do not claim ChatGPT/OpenAI app compatibility until the real public connector flow is run.

## Custom HTTP Smoke Client

`pnpm mcp:smoke` performs:

1. `GET /.well-known/oauth-protected-resource`
2. `GET /.well-known/oauth-authorization-server`
3. `POST /mcp` `initialize`
4. `POST /mcp` `tools/list`
5. Assertion that `MCP_TEST_EXPECTED_TOOL` is present
6. Assertion that `MCP_TEST_FORBIDDEN_TOOL` is absent
7. Safe read `tools/call` for the expected tool
8. Forbidden `tools/call` and denial assertion
9. Optional audit-row count when `DATABASE_URL` and `MCP_TEST_CONNECTION_ID` are provided

The script redacts bearer tokens in output.

## Staging Deploy Checklist

- `MCP_ENABLED=true`
- `MCP_AUTH_MODE=oauth`
- `MCP_REQUIRE_OAUTH=true`
- `MCP_ALLOW_STATIC_TOKENS_DEV=false`
- `MCP_PUBLIC_BASE_URL=https://...`
- `MCP_PUBLIC_BASE_URL` is not localhost
- OAuth client rows are seeded
- Exact allowed redirect URIs are configured
- TLS is active
- CORS is configured only where needed
- Rate limits are enabled
- Audit retention is configured
- Provider credentials are server-only and not logged

Remote MCP is production-auth-capable only after public HTTPS deployment, OAuth client registration, smoke script pass, client-specific integration pass, and revocation pass.

## References

- MCP Inspector: `https://modelcontextprotocol.io/docs/tools/inspector`
- MCP Authorization: `https://modelcontextprotocol.io/docs/tutorials/security/authorization`
- MCP Streamable HTTP transport: `https://modelcontextprotocol.io/specification/2025-03-26/basic/transports`
- Claude Code MCP: `https://docs.anthropic.com/en/docs/claude-code/mcp`
- Claude custom connectors: `https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp`
- OpenAI MCP/connectors: `https://developers.openai.com/api/docs/guides/tools-connectors-mcp`
- OpenAI MCP apps: `https://developers.openai.com/api/docs/mcp`
