# Veel V2 AI/MCP Practical Use Cases

Status: accepted
Scope: AI assistant, MCP tools, admin ops, creator/user utility
Last updated: 2026-06-02
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

Launch AI/MCP as a permissioned tool layer for three narrow jobs:

1. Creator productivity.
2. User self-service.
3. Admin/platform operations.

Do not let AI spend money, unlock content, issue tickets, publish content, message users, change safety/admin decisions, access private content/messages, or call provider APIs unless the user/admin explicitly confirms and backend policy allows the tool call.

## Real Pain Solvers

### Creator Assistant

Useful because creators need lower-friction publishing, better captions, and faster content organization.

Allowed tools:

- draft caption from creator-provided prompt/media metadata
- suggest hashtags and mentions
- summarize own creator activity
- prepare metadata for a scheduled post/live/event
- suggest a teaser title and thumbnail checklist
- explain monetisation options using backend config
- suggest event copy/ticket labels from creator-entered event details

Not allowed:

- publish without confirmation
- change price/splits without confirmation
- create misleading adult/safety labels
- bypass moderation
- fabricate stats

### User Self-Service Assistant

Useful because payments, wallets, unlocks, tickets, and age verification create support load.

Allowed tools:

- explain wallet/top-up state
- find own purchases/unlocks/tickets
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

Allowed tools:

- summarize provider health
- detect stuck payment intents or webhook lag
- cluster reports by content/user/risk
- summarize creator revenue and retention cohorts
- identify high-churn funnels
- explain failed media processing states
- draft support response from safe ticket context
- prepare moderation decision summary
- prepare refund/revocation recommendation with evidence
- produce launch-readiness checklist from current metrics

Not allowed:

- ban users without admin confirmation
- refund/revoke without admin confirmation
- override KYC/age decisions
- expose secrets/raw provider payloads
- access private messages unless a documented moderation/legal workflow grants break-glass access

## MCP Architecture

```text
AI client/session
  -> AI gateway
  -> policy engine
  -> tool registry
  -> MCP/internal tool adapter
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

## Tool Scope Matrix

| Tool | User | Creator | Admin | Confirmation |
| --- | --- | --- | --- | --- |
| `explain_app_state` | yes | yes | yes | no |
| `summarize_own_activity` | yes | yes | no | no |
| `find_own_purchases` | yes | yes | no | no |
| `draft_caption` | no | yes | no | no |
| `suggest_hashtags` | no | yes | no | no |
| `prepare_event_copy` | no | yes | no | no |
| `summarize_creator_metrics` | no | own only | yes | no |
| `payment_lookup` | own only | own revenue only | yes | no |
| `provider_health_summary` | no | no | yes | no |
| `moderation_queue_summary` | no | no | yes | no |
| `draft_support_reply` | no | no | yes | yes before send |
| `prepare_refund_decision` | no | no | yes | yes |
| `prepare_ban_or_restriction` | no | no | yes | yes |

## LLM Provider Strategy

- Keep the AI gateway provider-agnostic.
- Start with one OpenAI-compatible adapter and one model config.
- Store prompts, tool schemas, and eval fixtures in versioned files.
- Do not let the LLM provider call internal tools directly.
- Backend tool gateway remains the policy boundary.

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
- event ticket sales/check-ins
- dating active-match health
- AI tool audit events

## References

- OpenAI Agents guide: https://platform.openai.com/docs/guides/agents
- OpenAI Agents SDK tools: https://openai.github.io/openai-agents-js/guides/tools/
- MCP authorization: https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization
- MCP enterprise managed authorization: https://modelcontextprotocol.io/extensions/auth/enterprise-managed-authorization
