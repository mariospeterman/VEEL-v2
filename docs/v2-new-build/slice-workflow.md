# Veel V2 Build Workflow

Status: accepted
Scope: build process, repo strategy, gstack usage
Last updated: 2026-08-22
Source of truth: yes

Owns:
- slice workflow decisions for its named domain

Defers to:
- INDEX.md, route-map.md, OpenAPI, schema blueprint, and ADRs where narrower

Does not own:
- unrelated domains, implementation shortcuts, provider secrets, or hidden source-of-truth rules

Launch scope:
- accepted v2 launch or phased behavior stated in this document

Non-goals:
- historical-context inference, duplicate systems, and unapproved provider/product expansion

This document defines how to start the clean Veel v2 build without importing historical implementation debt. Historical repositories are context only after their lessons are captured in v2 docs, contracts, schema, and tests.

For the detailed standalone repo plan, use `build-plan.md`. This document is the operational workflow and slice order; the build-plan document is the step-by-step new repo implementation plan.

## Recommendation

Use this scaffold as the clean `veel-v2` starting point and keep the older repository as read-only reference.

Use this repo for:

- product behavior reference
- tests and fixtures worth preserving
- provider lessons
- launch blockers
- screenshots and UX findings
- current docs and ADRs

Do not bulk-copy historical context application code. recreate behavior through contracts, tests, and vertical slices.

## New Repo Shape

```text
veel-v2/
  apps/
    web/
    api/
    worker/
  packages/
    contracts/
    config/
    database/
    ui/
    test-factories/
  infra/
    docker/
    deploy/
    observability/
  docs/
    architecture/
    adr/
    product/
    providers/
    security/
    getting-started/
  scripts/
```

## Initial Setup Order

1. Create clean repo.
2. Copy only canonical v2 docs, ADRs, product docs, provider docs, and security rules.
3. Add `AGENTS.md`/agent rules for the new stack.
4. Add `.cursorignore`, `.gitignore`, `.dockerignore`, and secret scanning before code.
5. Scaffold pnpm workspace.
6. Scaffold packages/contracts first.
7. Scaffold Fastify API and worker.
8. Scaffold Next.js app shell and design tokens.
9. Add Supabase migrations and local/dev setup.
10. Implement one vertical slice at a time.

## GStack Usage

GStack can help as workflow tooling, not architecture. The official README describes it as a set of specialist slash-command workflows for planning, engineering review, design review, QA, security, and release work, with optional shared/team setup and gbrain memory tooling.

Recommended use:

- install after the v2 repo has docs and repo rules
- keep gstack optional at first
- use it for office-hours/planning, design review, QA, security review, release review
- do not let it copy historical context code wholesale
- do not let gstack memory override source-of-truth docs, OpenAPI, migrations, or tests
- keep telemetry/privacy choices explicit

Suggested command from the public README for Codex-compatible setup:

```text
git clone https://github.com/garrytan/gstack.git ~/.codex/skills/gstack
cd ~/.codex/skills/gstack && ./setup --host codex
```

Team mode should be added only after the repo owner decides whether gstack is optional or required.

## Contract-First Rule

Every v2 slice starts with:

- product behavior doc
- API contract
- database migration
- provider boundary
- tests
- UI route/screen contract

Then code.

## Autonomous Production Loop

The project-local `$wevid-production-loop` skill operates this workflow. It does not own
architecture or product requirements; it routes each run through `AGENTS.md`,
`current-implementation-status.md`, `build-plan.md`, and this document.

Only one write/integration slice may be active. Before creating a branch, fetch protected
`main` and query open pull requests carrying `wevid-active-slice`. Exactly one means resume that
pull request and validate its branch against the planned-slice contract. Zero means select the next
planned slice from `production-status.json`. More than one is status corruption: stop all writes
until the mutex is repaired. Dependency or security analysis may run separately only when it does
not modify the active branch or lockfile.

A bounded post-review repair may temporarily hold the same mutex on a branch named
`codex/converge-NN-<scope>-repair` or `codex/converge-NN-<scope>-repairs`. It must target the latest
merged slice, contain only the reviewed repair and its evidence, and merge before the planned next
slice is activated. The stable next-slice record does not move backward for that temporary branch.

Track the active slice with this state machine:

```text
PLANNED -> ACTIVE -> CODE_COMPLETE -> LOCAL_GREEN -> CI_GREEN
        -> PROVIDER_PROVEN -> REVIEW_GREEN -> MERGE_READY -> MERGED
        -> CODE_COMPLETE_PROVIDER_BLOCKED -> REVIEW_GREEN -> MERGE_READY -> MERGED
```

Provider fixtures and mocks prove application behavior, not provider acceptance. When
credentials are unavailable, finish the adapter and state machine, add official fixtures,
deterministic tests, missing-environment diagnostics, and staging proof commands, keep the
production capability fail-closed, record `CODE_COMPLETE_PROVIDER_BLOCKED`, and continue
with the next independent slice after merge.

Every slice starts from the newest green `main`, uses one short-lived branch and one pull
request, and merges only through protected `main`. After squash merge, verify main-branch
CI, delete the branch, advance the stable merged-status fragment and next planned slice, and continue. Local and pull-request
preview evidence may merge fail-closed work; production receives only an explicitly approved
immutable artifact already proven in staging. Staging and production are environments, not
permanent branches.

### Five-Minute Walk Test

A fresh agent with no conversation memory must be able to identify all of the following
from repository files alone:

1. Mission and hard boundaries from `AGENTS.md`.
2. Canonical architecture owners from `AGENTS.md` and `app-architecture.md`.
3. Exact merged baseline, latest merged slice/migration/evidence, blockers, and next planned slice
   from `current-implementation-status.md` and `production-status.json`.
4. Live active branch, pull request, head SHA, CI, and review state from GitHub's single
   `wevid-active-slice` label; repository docs never mirror this transient truth.
5. Required contract, migration, backend, browser, provider-boundary, ops, docs, and
   security evidence from `AGENTS.md` and this workflow.
6. Human/provider release gates from `current-implementation-status.md`.

`pnpm docs:check` executes structural and drift assertions for this router, stable status fragment,
migration tree, canonical next-slice agreement, and—when GitHub credentials are available—the mutex.

## Real API Integration Gate

Mock API/browser smoke remains useful for fast UX regression checks, but money/access/readiness slices also need a real API/test-DB path before production-readiness claims.

For the authenticated onboarding and access path, run:

```text
VEEL_ALLOW_REMOTE_API_INTEGRATION_TESTS=1 pnpm test:integration:api
```

This command loads root `.env`, requires `VEEL_ENABLE_REAL_API_INTEGRATION_TESTS`, and runs only against the configured non-production Postgres/Supabase database. The current coverage links an external Solana wallet with a real Ed25519 signature, starts and completes age verification through a signed Sumsub-style webhook, completes profile readiness, creates content through the API, seeds only the prerequisite paid creator content, published paid Event Access offer, direct conversation, live room, subscription plan, and provider replay request, creates backend-priced content unlock, Event Access Pass, structured-creator-request, live-pass, and subscription authorization intents, submits confirmed backend settlement evidence through the payment route, verifies the content access projection becomes entitlement-backed `unlocked`, verifies the already-unlocked response, verifies Event Access Pass activity, verifies creator acceptance precedes payment, verified settlement activates the delivery workspace, and no paid chat message is created, verifies live-pass signed playback and chat projections, verifies subscription activation, worker collection, and provider replay outcomes, checks persisted wallet/payment/settlement/entitlement/Event Access/creator-request/live-pass/subscription/replay rows, then runs the Analytics Core worker against canonical impression/playback/engagement facts, proves minimum-cohort release, API parity, late-fact convergence, and deterministic cleanup.

Do not run this gate against production. For remote databases, the explicit `VEEL_ALLOW_REMOTE_API_INTEGRATION_TESTS=1` acknowledgement is required so accidental writes to the wrong project fail closed.

## Vertical Slice Order

1. Auth, session, age gate, app shell.
2. Embedded wallet/external wallet onboarding and primary wallet selection.
3. Home feed read model with real media cards.
4. Media viewer and access-state projection.
5. Native SOL devnet payment intent, transaction request, confirmation, settlement.
6. Content unlock entitlement.
7. Tip/support settlement without access grant.
8. Referral attribution and commission.
9. Bunny VOD upload/status/playback.
10. Livepeer live room/pass/chat/replay.
11. Messages, creator media offers, and two-phase structured creator requests.
12. User activity and wallet transactions.
13. Creator profile and creator monetisation dashboard.
14. Admin payments/unlocks/provider ops dashboard.
15. Event Access/Passes.
16. Mutuals mode.
17. AI/MCP assistant with scoped tools.

Each slice must ship with tests and docs before the next slice starts.

## Parity Gate

V2 can replace v1 only after:

- auth/session works
- age/access gate works
- embedded and external wallet paths work
- Home/media viewer work on desktop/mobile
- paid unlock works with backend verification
- tips/support settle correctly
- referral commission is backend-owned
- Bunny/Livepeer provider boundaries are proven
- messages persist
- admin can inspect money/access/provider state
- security/audit/observability gates pass
- visual QA passes

## Kill Criteria

Stop or pause the build if:

- v2 starts duplicating the same provider/payment systems as v1
- backend business truth leaks to frontend
- Supabase direct client access bypasses Fastify policy for money/access/safety
- docs fall behind implementation
- vertical slices start shipping without tests
- the new repo accumulates unexplained global CSS or duplicate app shells

## Current Repo Reference Checklist

Before implementing each v2 slice, inspect current repo for:

- behavior already validated in tests
- bugs found during RC/polish
- provider edge cases
- UI/UX screenshots and constraints
- data model lessons
- docs that supersede old plans

Port the lesson, not the code shape.
