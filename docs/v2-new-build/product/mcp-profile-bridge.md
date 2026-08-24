# WeVid Remote MCP Profile Bridge

Status: accepted
Scope: Convergence 07 remote MCP profile, analytics, and private-draft behavior
Last updated: 2026-08-24
Source of truth: yes for this bounded product slice

Owns:
- the user-visible and tool behavior of the optional remote MCP profile bridge

Defers to:
- `ai-mcp-use-cases.md` for AI/MCP policy
- OpenAPI and the MCP tool registry for schemas
- Analytics Core for every metric definition and privacy decision
- the content and media authorities for draft, upload, moderation, and publication state
- the provider ADR and official MCP/OpenAI documentation for protocol behavior

Does not own:
- an LLM, model keys, publication, payments, wallet signing, moderation decisions, entitlements,
  provider configuration, or admin actions

## Product contract

The bridge is optional, disabled by default, separately authorized, least-privilege scoped, and
audited. External clients bring their own model. WeVid exposes only these creator capabilities:

1. Read a minimized current profile and readiness projection.
2. Query the same authorized Analytics Core metric objects used by WeVid surfaces.
3. List bounded metadata for the creator's own private drafts.
4. Inspect backend-derived readiness for one owned private draft.
5. Create an idempotent SFW private draft that cannot publish or contact a provider.

The bridge never re-computes analytics. It calls the Analytics Core query service with the current
creator identity, preserves metric definition versions, cohort suppression, currency separation,
freshness, and data-through timestamps, and removes internal actor identifiers from the external
result.

Private-draft creation forces `visibility=private`, `nsfwLabel=none`, and a non-publishing lifecycle.
The creator must review and continue through the normal WeVid composer. A durable origin row links
the draft to its scoped MCP connection using only a request hash and tool version; prompts, model
keys, provider payloads, auth tokens, private messages, and raw personal data are forbidden.

## Protocol and trust boundary

- Stable MCP protocol target: `2025-11-25`; the July 2026 release candidate is observed but not
  adopted before finalization and supported-client proof.
- OAuth authorization-code plus S256 PKCE, exact redirect matching, audience/resource binding,
  short-lived hash-only bearer tokens, revocation, and per-request authorization remain mandatory.
- Streamable HTTP requests with an `Origin` header are accepted only from configured WeVid origins;
  invalid Origins fail with HTTP 403.
- Tool results use standard text content plus `structuredContent` that matches the declared output
  schema. Read-only, destructive, idempotent, and open-world annotations must match real behavior.
- Profile and tool results expose no session IDs, internal user IDs, wallet addresses, tokens,
  provider IDs, signed URLs, private messages, raw logs, or debug payloads.
- Retrieved creator text is data, never an instruction to execute. No tool can call another tool,
  provider, wallet, payment, moderation, entitlement, messaging, or admin action.

## Failure and operations behavior

- Unknown, revoked, expired, incorrectly scoped, wrong-audience, or role-ineligible connections fail
  closed and are audited where authentication permits.
- Invalid tool input is a bounded tool execution error; internal repository/provider details are
  never returned.
- Draft retries are idempotent. A retry may repair a missing origin link but cannot create a second
  draft for the same logical operation.
- Analytics privacy suppression and stale/unavailable freshness are returned honestly; the bridge
  cannot infer or fill suppressed values.
- Connection revocation remains available in WeVid settings. Operator health uses existing MCP audit,
  OAuth, rate-limit, and staging-proof surfaces; no second operations console is introduced.

## Automated proof

The slice must prove typed tool schemas and annotations, structured results, scope filtering,
cross-user denial, Origin rejection, OAuth audience/revocation behavior, exact Analytics Core reuse,
private-only idempotent draft creation, durable origin audit, minimized output, migrated real-Postgres
behavior, rollback/reapply, and authenticated desktop/mobile browser visibility.
