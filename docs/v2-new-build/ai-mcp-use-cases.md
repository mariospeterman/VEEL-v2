# Veel V2 AI/MCP Practical Use Cases

Status: accepted
Scope: AI assistant, MCP tools, admin ops, creator/user utility
Last updated: 2026-06-13
Source of truth: yes for v2 AI/MCP scope

Owns:
- ai mcp use cases decisions for its named domain

Defers to:
- INDEX.md, route-map.md, OpenAPI, schema blueprint, and ADRs where narrower

Does not own:
- unrelated domains, implementation shortcuts, provider secrets, or hidden source-of-truth rules

Launch scope:
- accepted v2 launch or phased behavior stated in this document

Non-goals:
- historical-context inference, duplicate systems, and unapproved provider/product expansion

AI/MCP must solve real operational or user pain. It must not become a chatbot gimmick, unsafe automation layer, or expensive feature with no measurable benefit.

## Core Decision

Launch AI/MCP as a lightweight, permissioned MCP connection layer first.
External AI clients and LLMs provide the reasoning layer; Veel provides
authenticated data, scopes, safe tools, policy checks, rate limits, and audit.

The launch jobs are:

1. Creator productivity through read tools and draft tools.
2. User self-service through own-account read tools.
3. Admin/platform operations through read tools and draft/recommendation tools.

Do not let AI spend money, unlock content, issue Event Access Passes, publish content, message users, change safety/admin decisions, access private content/messages, or call provider APIs unless the user/admin explicitly confirms and backend policy allows the tool call.

The current external MCP slice is production-auth-capable but still requires operational staging proof before external connector compatibility is claimed:

- protected-resource and authorization-server metadata for remote MCP clients
- OAuth authorization-code plus PKCE for production remote connectors
- connection records, hash-only scoped tokens for dev/staging, hash-only OAuth access tokens, tool allowlists, rate limits, revocation, and audit
- small safe tool set that reads backend projections or creates creator drafts only
- AI-generated/AI-edited content label fields where content policy requires it
- staging proof helpers documented in `mcp-staging-proof.md`: `pnpm mcp:seed`, `pnpm mcp:oauth:pkce`, and `pnpm mcp:smoke`
- optional BYO in-app assistant later, after provider ADR, prompt/eval fixtures,
  budget controls, and UX evidence are approved

Production private-data connectors for Claude, Cowork-style clients, OpenAI, or similar MCP clients use pre-registered OAuth clients, authorization-code plus PKCE, resource-bound bearer access tokens, scope grants, and revocation. Scoped tokens are explicitly limited to local development and staging environments.
MCP Inspector, Claude Code, Claude custom connectors, and OpenAI-compatible clients must be proven against a public HTTPS staging URL before Veel claims compatibility with those external clients.

Do not build a broad AI platform, custom model layer, casino-like assistant
dashboard, or provider-calling autonomous agent for MVP.

## Real Pain Solvers

### Creator Assistant

Useful because creators need lower-friction publishing, better captions, and faster content organization.

Desired MCP tools:

- `get_my_profile`
- `get_my_creator_settings`
- `list_my_media`
- `get_my_media_detail`
- `get_my_metrics_summary`
- `list_my_drafts`
- `list_my_events`
- `create_profile_update_draft`
- `create_post_draft`
- `create_event_draft`
- `create_message_reply_draft`
- `create_media_metadata_draft`
- `request_publish_review`
- `request_profile_update_review`
- `mark_media_as_ai_generated`

Not allowed:

- publish without confirmation
- change price/splits without confirmation
- create misleading adult/safety labels
- bypass moderation
- fabricate stats

### User Self-Service Assistant

Useful because payments, wallets, unlocks, Access Passes, and age verification create support load.

Allowed tools:

- explain wallet/top-up state
- find own purchases/unlocks/Access Passes
- summarize own activity
- explain why access is pending
- help retry failed payment or age session
- guide user to report/block

Not allowed:

- grant access
- refund
- message another user
- reveal private creator/admin data

### Admin Operations Assistant

This is the highest ROI use case. Alibaba-style agentic commerce patterns point toward controlled operational agents, not open-ended chat. For Veel, admin AI should triage and explain operational state, then prepare actions for human confirmation.

Desired MCP tools:

- `get_platform_health_summary`
- `list_open_support_cases`
- `get_support_case_summary`
- `list_moderation_queue`
- `get_moderation_case_summary`
- `list_payment_issues`
- `get_creator_account_summary`
- `draft_support_reply`
- `draft_moderation_decision_note`
- `draft_creator_warning`
- `draft_refund_recommendation`
- `create_internal_task`

Not allowed:

- ban users without admin confirmation
- refund/revoke without admin confirmation
- override KYC/age decisions
- expose secrets/raw provider payloads
- access private messages unless a documented moderation/legal workflow grants break-glass access

## MCP Architecture

```text
External AI client or optional in-app assistant
  -> Veel MCP server
  -> policy engine
  -> tool registry
  -> backend service/query
  -> draft/review request when mutation-like
  -> redacted structured result
  -> audited tool-call record
```

In-app assistant architecture, if later enabled:

```text
Veel UI
  -> AI gateway
  -> provider adapter / BYO key boundary
  -> same Veel MCP server or internal tool gateway
  -> backend service/query
  -> audited result
```

Tool calls require:

- authenticated user
- role/scope check
- resource-level policy check
- tool allowlist
- rate limit
- prompt/tool input validation
- output redaction
- audit event
- human confirmation for irreversible actions

Launch implementation rules:

- `GET /v1/ai/capabilities` exposes backend-derived scopes and tool allowlists without creating a session or executing a tool.
- `POST /v1/ai/sessions` creates an expiring scoped session with backend-derived allowed tools.
- `POST /v1/ai/sessions/:id/tool-calls` accepts only enumed tool names from OpenAPI.
- `GET /v1/mcp/tools`, `GET /v1/mcp/connections`, `POST /v1/mcp/connections`, `GET /v1/mcp/connections/:id`, and `POST /v1/mcp/connections/:id/revoke` manage external MCP client connections without exposing stored tokens.
- `POST /mcp` supports the current foundation methods `initialize`, `tools/list`, and `tools/call`.
- `GET /.well-known/oauth-protected-resource`, `GET /.well-known/oauth-authorization-server`, `GET /oauth/authorize`, `POST /oauth/token`, `POST /oauth/revoke`, and the authenticated `/oauth/consent/:requestId` approval routes implement production MCP OAuth for private-data connectors.
- OAuth client registration is pre-provisioned in `oauth_clients`; dynamic client registration and refresh tokens are not advertised.
- Remote MCP tools must expose typed input and output schemas; clients may use
  tool filtering and approval requests where supported.
- Admin tools require an active staff membership check before execution.
- Confirmation-required tools can only prepare a decision or draft in this slice; they cannot send, refund, ban, revoke, publish, or mutate safety state.
- Stored input and output are redacted summaries plus safe JSON results, never raw prompts, provider payloads, secrets, or private messages.
- External MCP transports must follow the current MCP authorization spec before launch: OAuth 2.1, PKCE where applicable, bearer tokens on every HTTP request, resource/audience validation, HTTPS except localhost development redirect URIs, exact redirect URI validation, no tokens in query strings, no token passthrough to downstream services, and least-privilege scopes.
- Tool outputs must treat user/profile/content text as untrusted data. Prompt-injection defenses include strict schemas, no instruction-following from retrieved content, resource-scoped authorization after every tool call, output redaction, and human confirmation before risky actions.
- Rate limits are per connection, user, organization, tool, and risk class.
- `/app/assistant` exists only when backend capability allows it, is not a
  primary mobile nav item, and cannot publish, spend, message, moderate, call
  providers, change admin state, or mutate user data without explicit
  confirmation.

## Current External MCP Tool Scope Matrix

| Tool | User | Creator | Admin | Confirmation |
| --- | --- | --- | --- | --- |
| `creator_get_profile` | no | own only | no | no |
| `creator_get_metrics_summary` | no | own only | no | no |
| `creator_create_content_draft` | no | own only | no | review before publish |
| `admin_get_platform_health_summary` | no | no | yes | no |
| `admin_list_support_cases` | no | no | yes | no |
| `admin_list_payment_intents` | no | no | yes | no |

No `admin.full_access` scope is allowed. Scopes must be human-readable and
specific, for example `creator.profile.read`, `creator.drafts.write`,
`admin.support.read`, or `admin.moderation.drafts.write`.

## AI Content Labels

- AI-generated or AI-edited media/audio requires visible user-facing labeling.
- Likeness, deepfake, or voice-clone workflows require visible labeling plus
  consent verification before publication.
- Caption-only assistance is stored as internal `ai_assisted` provenance and
  does not need a visible media label unless policy changes.

## LLM Provider Strategy

- External MCP clients bring their own LLM/provider by default.
- Keep any future in-app assistant provider-agnostic, with BYO key or
  environment-scoped provider credentials server-only.
- Store prompts, tool schemas, approval copy, and eval fixtures in versioned
  files before provider-backed generation ships.
- Do not let an LLM provider call internal tools directly; the Veel MCP/tool
  gateway remains the policy boundary.
- Do not ship provider-backed generation until official provider docs have been
  checked and eval fixtures cover unsafe money, messaging, publishing,
  age/KYC, prompt injection, and admin requests.

## Admin Metrics AI Should Use

- payment intent state
- webhook lag
- provider callback error rate
- failed media jobs
- live stream status
- age/KYC queue status
- report clusters
- creator activation funnel
- user conversion funnel
- churn indicators
- Event Access Pass sales/check-ins
- Mutuals active-mutual health
- AI tool audit events

## References

- OpenAI Agents guide: https://developers.openai.com/api/docs/guides/agents
- OpenAI MCP/connectors tools: https://developers.openai.com/api/docs/guides/tools-connectors-mcp
- OpenAI remote MCP server guide: https://developers.openai.com/api/docs/mcp
- MCP authorization: https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization
- MCP security best practices: https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices
- MCP enterprise managed authorization: https://modelcontextprotocol.io/extensions/auth/enterprise-managed-authorization
