# Veel V2 New Repo Build Plan

Status: proposed v2 architecture
Scope: greenfield implementation plan
Last updated: 2026-06-02
Source of truth: proposal

This is the detailed build plan for a clean `veel-v2` repository. It is not a migration checklist and not a code-porting plan. The current repo is only a reference for product behavior, provider lessons, validated tests, and known pitfalls.

Use this as the primary v2 starting document. `slice-workflow.md` is only the operational slice workflow. `optional/in-repo-migration-plan.md` is only for the alternative where v2 is built inside this existing monorepo.

## Build Strategy

Build v2 as a greenfield provider-first platform:

- docs and ADRs first
- contracts before UI/backend implementation
- database schema before business services
- provider adapters before custom workflows
- vertical slices before broad surfaces
- tests before polish
- admin/ops visibility before production cutover

Do not bulk-copy v1 code. Reuse only:

- product rules
- screenshots/UX lessons
- validated test cases
- provider edge cases
- fixture shape lessons
- compliance requirements

## New Repo Bootstrap

```text
veel-v2/
  AGENTS.md
  README.md
  package.json
  pnpm-workspace.yaml
  tsconfig.base.json
  .env.example
  .gitignore
  .cursorignore
  apps/
    web/
    api/
    worker/
  packages/
    contracts/
    database/
    config/
    ui/
    test-factories/
  docs/
    INDEX.md
    architecture/
    adr/
    product/
    providers/
    security/
    getting-started/
  infra/
    docker/
    deploy/
    observability/
  scripts/
```

Initial commands:

```text
mkdir veel-v2
cd veel-v2
git init
pnpm init
mkdir -p apps/{web,api,worker} packages/{contracts,database,config,ui,test-factories} docs/{architecture,adr,product,providers,security,getting-started} infra/{docker,deploy,observability} scripts
```

Use pnpm and Node.js LTS for launch. Do not switch production runtime to Bun during the auth/backend/realtime rebuild.

## Copy From Current Repo

Copy only documentation and lessons first:

```text
docs/v2-new-build/
AGENTS.md
```

Then rewrite the root `README.md` for v2 only. Do not keep stale v1 setup instructions active in the new repo.

The files in this folder already use new-repo names. You can copy them as-is or rename `docs/v2-new-build/` to `docs/architecture/` in the new repo.

Before implementation starts, verify these high-signal v2 docs are present in the new repo:

- `full-platform-blueprint.md` for the whole app/module/workflow/provider map
- `adr/0002-provider-decisions-2026.md` for launch provider defaults
- `contracts-and-schema.md`, `packages/contracts/openapi.yaml`, and `packages/database/schema-blueprint.sql` for the first contract/schema draft
- `diagrams.md` for render-safe full-platform diagrams
- `product/dating-mode.md` for explicit Dating Mode rules
- `product/events-ticketing.md` for event/ticketing rules
- `recommendation-discovery.md` for feed, hashtag, mention, and NSFW delivery rules
- `providers/provider-map.md` for provider ownership and boundary rules
- `business-monetisation.md` for the business model and split/revenue strategy
- `compliance/adult-content-compliance.md` and `compliance/age-kyc-jurisdictions.md` for adult platform obligations

## GStack Setup

Install GStack only after the v2 docs and `AGENTS.md` are in place.

```text
git clone https://github.com/garrytan/gstack.git ~/.codex/skills/gstack
cd ~/.codex/skills/gstack && ./setup --host codex
```

Use GStack for:

- planning review
- architecture critique
- design review
- QA planning
- security review
- release review

Do not let GStack replace:

- docs
- ADRs
- OpenAPI/contracts
- migrations
- tests
- provider official docs

## Renderer-Safe Architecture Diagram

This ASCII diagram is the source that renders in any Markdown preview. Mermaid versions can exist below it for GitHub or Mermaid-enabled previews.

```text
Next.js PWA
  ├─ App shell, Home, Bits, Create, Messages, Profile
  ├─ Wallet layer: embedded wallet + external wallet adapter
  ├─ TanStack Query server cache
  └─ Zustand/local UI state
        │
        ▼
Fastify API
  ├─ OpenAPI/schema validation
  ├─ Auth/session/profile policy
  ├─ Payments, referrals, entitlements
  ├─ Media/live/messages/safety/admin modules
  └─ Audit/idempotency
        │
        ├───────────────┐
        ▼               ▼
Supabase             Providers
  ├─ Auth              ├─ Solana RPC / Solana Pay
  ├─ Postgres          ├─ Embedded wallet provider
  ├─ Realtime          ├─ Helius payment evidence
  └─ RLS               ├─ Bunny Stream/CDN/TUS
                       ├─ Livepeer live/replay
                       ├─ Age/KYC providers
                       └─ Onramp provider
```

## Foundation Milestone

Deliverables:

- pnpm workspace
- TypeScript base config
- lint/format/test config
- Docker Compose for local development
- env examples with no secrets
- secret scanning
- CI skeleton
- docs index
- ADR folder

Definition of done:

- `pnpm lint`, `pnpm typecheck`, and `pnpm test` run even if apps are empty
- `.env.example` documents public vs server-only values
- `.cursorignore` excludes build artifacts, secrets, generated output, vendor caches, and old repo imports

## Contracts Milestone

Deliverables:

- `packages/contracts`
- shared error model
- OpenAPI generation path
- generated frontend client strategy
- API versioning rule
- request/response schema conventions

Definition of done:

- contract generation is deterministic
- frontend cannot call raw `fetch`
- every backend route is schema-validated
- every API change updates contracts and generated types

## Database Milestone

Deliverables:

- `packages/database`
- Supabase migrations
- seed strategy
- RLS policy plan
- audit/event tables
- test factories

Core tables:

- users/profiles
- wallets
- age checks
- content/media assets
- engagements/social graph
- payment intents/splits/settlements
- entitlements/access grants
- referral tokens/attributions/commissions
- messages/conversations
- live rooms/passes/replays
- subscriptions
- events/tickets
- dating opt-in/swipes/matches
- admin audit/events
- AI sessions/tool calls

Definition of done:

- migrations are reversible where practical
- RLS exists only for client-visible realtime/read models
- business mutations go through Fastify
- audit tables exist before money/safety/admin flows

## Backend Milestone

Deliverables:

- `apps/api`
- `apps/worker`
- Fastify plugins for auth, DB, logging, OpenAPI, rate limit, errors
- module convention: `routes`, `schemas`, `service`, `repository`, `policy`, `events`, tests
- provider adapter convention
- idempotency/audit utilities

First modules:

1. auth/session
2. wallets
3. age/access
4. content read model
5. payments
6. entitlements
7. referrals
8. media providers
9. live
10. messages
11. admin

Definition of done:

- no direct provider calls in route handlers
- no money/access writes outside transactions
- no raw provider payload in frontend resources
- webhook handlers verify signatures and replay windows

## Frontend Milestone

Deliverables:

- `apps/web`
- Next.js PWA
- design tokens
- shared UI primitives
- generated API client
- app shell
- protected route gate
- mobile/desktop layout contracts
- Playwright smoke harness

First surfaces:

1. landing/enter
2. auth/access gate
3. Home
4. media viewer
5. creator profile
6. payment sheet
7. messages
8. live room
9. create/upload
10. admin shell

Definition of done:

- desktop and mobile are first-class layouts
- no duplicate app shells or media viewers
- gestures are shortcuts, never critical-only controls
- no browser-exposed secrets
- all server state flows through generated API client/TanStack Query

## Vertical Slice Build Order

Build each slice end-to-end before starting the next:

1. Auth, session, app shell, age gate stub/provider contract.
2. Embedded wallet and external wallet onboarding.
3. Home feed read model with real cards.
4. Media viewer with access-state projection.
5. Native SOL devnet payment intent and settlement.
6. Paid unlock entitlement.
7. Tip/support settlement without access grant.
8. Referral attribution and commission.
9. Bunny VOD upload/status/playback.
10. Livepeer room/pass/chat/replay.
11. Messages and paid messages.
12. User activity and wallet transactions.
13. Creator profile and creator monetisation dashboard.
14. Admin payments/unlocks/provider ops.
15. Events/tickets.
16. Dating mode.
17. AI/MCP scoped assistant.

Each slice must include:

- contract
- migration
- backend tests
- frontend smoke/E2E
- provider boundary test
- admin/ops visibility if relevant
- docs update

## First 10 Implementation Tickets

1. Create repo, workspace, CI, docs, env examples.
2. Add contracts package and API error model.
3. Add Supabase project/local setup and first migrations.
4. Add Fastify API skeleton with auth plugin and `/v2/session`.
5. Add Next app shell with generated client wiring.
6. Add embedded-wallet provider ADR and adapter interface.
7. Add external wallet challenge/link flow.
8. Add age provider adapter interface and provider waterfall stub.
9. Add Home read model API and one production-quality media card.
10. Add Playwright desktop/mobile smoke for app shell and Home.

## Reference Repo Usage Protocol

For each slice:

1. Read v1 docs and tests.
2. Inspect v1 code only to understand behavior or edge cases.
3. Write v2 contract and tests.
4. Implement clean v2 code.
5. Compare v2 behavior against v1 E2E expectations.
6. Do not copy large files, CSS, controllers, services, or old abstractions.

## Production Gate

V2 is not production-ready until:

- adult compliance and age assurance are implemented
- embedded and external wallet flows work
- noncustodial split payments verify through backend settlement
- Helius/payment evidence is pinned and tested
- Bunny/Livepeer provider boundaries are proven
- admin can inspect money/access/provider state
- audit logs cover money, safety, provider, admin, AI
- staging provider smoke passes
- frontend desktop/mobile QA passes
- security review passes
