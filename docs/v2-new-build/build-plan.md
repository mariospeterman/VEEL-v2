# WeVid Production Build Plan

Status: accepted
Scope: canonical implementation and production-completion order
Last updated: 2026-08-15
Source of truth: yes

Owns:
- implementation order, foundation gates, vertical-slice sequencing

Defers to:
- route map, contracts, schema, provider ADRs for domain detail

Does not own:
- product UX microcopy or provider SDK behavior

Launch scope:
- repo foundation through first production slices

Non-goals:
- bulk-copying historical context code

This is the detailed build plan for a clean `veel-v2` repository. It is not an in-place upgrade checklist and not a code-copy plan. Build decisions come from this docs pack, OpenAPI, schema blueprint, ADRs, tests, and official provider docs.

Use this as the primary v2 starting document. `slice-workflow.md` is the operational slice workflow. There is no in-place upgrade plan in this scaffold.

Before continuing implementation, read `current-implementation-status.md`. It records what is real, what remains fail-closed, and the P0 hardening priorities that must be handled before broad feature expansion or production-readiness claims.

## Build Strategy

Build v2 as a standalone provider-first platform:

- docs and ADRs first
- contracts before UI/backend implementation
- database schema before business services
- provider adapters before custom workflows
- vertical slices before broad surfaces
- tests before polish
- admin/ops visibility before production cutover

Do not bulk-copy external implementation code. Any outside repository is historical reference only and cannot define v2 behavior.

## Production Completion Program

The historical milestones below remain useful implementation context. New production work follows this ordered slice program one reviewed slice at a time. Only one write/integration slice may be active; after its protected merge and main-branch verification, continue to the next unblocked slice unless a defined human gate requires owner action.

| Slice | Goal | Current state |
| --- | --- | --- |
| 00 | Baseline, governance, and truth lock | Merged through PR #35 at `b441532`; required main checks passed |
| 01 | Executable contracts and platform security boundary | Merged through PR #42 at `9081bd0`; local browser/Postgres proof passed, while shared Supabase migration/advisor proof and production-like Redis/provider staging remain release blockers |
| 02 | Three-step onboarding, canonical session, optional recovery, and earnings readiness | Identity/session/recovery and the three-step onboarding foundation merged with Launch 01; earnings readiness remains incomplete and real provider acceptance evidence remains a launch gate |
| 03A | SFW media publishing and moderation | `CODE_COMPLETE_PROVIDER_BLOCKED` on PR #44; contracts, reversible migration, owner/admin workflows, real-Postgres proof, and desktop/mobile browser proof are green. Bunny staging credentials and launch-approved classifier/hash evidence remain the fail-closed provider gate |
| 04 | Core social graph and real feeds | Merged through PR #45 at `327b95d`; protected CI, isolated Postgres, review, and desktop/mobile browser proof passed |
| 05 | Realtime messages and notifications | In progress on `codex/launch-05-realtime-messages` |
| 06 | One-time monetisation and Event Access completion, including narrow Commerce Kit Solana Pay convergence and one shared checkout presentation | Not started |
| 07 | SFW live host, viewer, chat, and operational controls | Not started |
| 08 | Recurring platform subscriptions and creator memberships | Not started |
| 09 | Enterprise managed creators | Not started |
| 10 | Frontend system, accessibility, cross-browser, and PWA completion | Not started |
| 11 | Actual deployment, observability, recovery, and legal launch | Not started |
| Post-core | Expanded Mutuals, WeVid-native Product Offers plus lightweight Orders/Fulfillment, adult live, full AI/MCP, NFT/transferable passes, resale, custom contracts, and uncommitted advanced Enterprise work | Separately gated and disabled or absent; physical commerce reuses the Slice 06 payment boundary and requires seller/trader, product-safety, shipping/privacy, tax, refund, and operations approval before code |

Core SFW launch requires Slices 00–07 and 10–11. Slice 08 is required only before recurring platform plans or Profile Memberships are sold. Slice 09 is required only before Enterprise customers are onboarded. Existing safe foundations for conditional/post-core work may remain, but incomplete capabilities stay hidden, disabled, and fail-closed.

Each completed slice requires the actual UI-to-database/provider path, authorization and runtime validation, focused unit and real-Postgres integration proof, browser proof, operational recovery, canonical docs updates, and redacted provider staging evidence when a provider is involved. Mocks prove application logic only.

The environment model is: pull request to preview preflight, merged `main` to staging, and approved release tag to production. Staging and production use independent Supabase projects, providers, secrets, wallets, storage, domains, and telemetry. The same immutable artifact digest must be promoted; build-only preflight is not deployment.

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

Use pnpm and Node.js LTS for launch. Do not switch production runtime to Bun during the auth/backend/realtime build.

## Build Source Boundary

Before implementation starts, verify these source-of-truth files are present in this scaffold:

- `full-platform-blueprint.md` for the whole app/module/workflow/provider map
- `adr/0002-provider-decisions-2026.md` for launch provider defaults
- `contracts-and-schema.md`, `packages/contracts/openapi.yaml`, and `packages/database/schema-blueprint.sql` for the first contract/schema draft
- `diagrams.md` for render-safe full-platform diagrams
- `product/mutuals.md` and `product/event-access.md` for Mutuals and Event Access
- `recommendation-discovery.md`, `profile-activity-ranking.md`, and `engagement-strategy.md` for growth and social mechanics
- `providers/provider-map.md`, `business-monetisation.md`, and compliance docs for provider and business boundaries

Do not copy external implementation files. Recreate behavior through contracts, schema, tests, and vertical slices.

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
- `pnpm-lock.yaml`
- TypeScript base config
- real lint/format/test config for apps and packages
- Docker Compose for local development
- env examples with no secrets
- secret scanning and dependency review
- CI/CD skeleton: `ci`, `security`, `preview`, `deploy-staging`, `deploy-production`, `db-migrations`
- CODEOWNERS and Dependabot
- docs index
- ADR folder

Definition of done:

- `pnpm docs:check` validates the current scaffold
- `pnpm lint`, `pnpm typecheck`, and `pnpm test` must not pretend to validate app code before real app tooling exists
- after apps are created, `pnpm lint`, `pnpm typecheck`, and `pnpm test` must run real app/package checks
- `.env.example` documents public vs server-only values
- `.cursorignore` excludes build artifacts, secrets, generated output, vendor caches, and historical context imports

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
- Event Access/Passes
- Mutuals opt-in/interests/matches
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

1. landing login/onboarding
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
6. Content unlock entitlement.
7. Tip/support settlement without access grant.
8. Referral attribution and commission.
9. Bunny VOD upload/status/playback.
10. Livepeer room/pass/chat/replay.
11. Messages and paid messages.
12. User activity and wallet transactions.
13. Creator profile and creator monetisation dashboard.
14. Admin payments/unlocks/provider ops.
15. Event Access/Passes.
16. Mutuals mode.
17. AI/MCP scoped assistant.
18. Notifications foundation.
19. Studio/Enterprise organization dashboards.
20. Notification admin health and delivery observability.
21. Notification delivery queue and worker boundary.
22. Browser notification enrollment and service-worker boundary.
23. Web Push VAPID send-provider boundary.
24. Supabase Realtime projection publication and browser cache invalidation boundary.
25. Creator onboarding readiness checklist.
26. Studio/Enterprise RBAC permission projection.
27. Admin organization KYB mutation workflow.
28. Admin organization member mutation workflow and support policy surface.

Each slice must include:

- contract
- migration
- backend tests
- frontend smoke/E2E
- provider boundary test
- admin/ops visibility if relevant
- docs update
- explicit check that money buys only access/software entitlements and never people, visibility, matches, recommendations, or preferential social treatment when the slice touches money, recommendations, Mutuals, profiles, messages, notifications, tiers, or admin policy

## First 10 Implementation Tickets

1. Create repo, workspace, CI, docs, env examples.
2. Add contracts package and API error model.
3. Add Supabase project/local setup and first migrations.
4. Add Fastify API skeleton with auth plugin and `/v1/session`.
5. Add Next app shell with generated client wiring.
6. Add embedded-wallet provider ADR and adapter interface.
7. Add external wallet challenge/link flow.
8. Add age provider adapter interface and provider waterfall stub.
9. Add Home read model API and one production-quality media card.
10. Add Playwright desktop/mobile smoke for app shell and Home.

## Historical Reference Protocol

If a developer reviews any historical material for context, the process is:

1. Extract the lesson into the relevant v2 doc, OpenAPI contract, schema blueprint, or test plan.
2. Treat the v2 artifact as the only implementation source.
3. Do not copy files, CSS, controllers, services, provider adapters, or abstractions.
4. Do not infer missing behavior from historical code.

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
