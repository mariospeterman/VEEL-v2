# Veel V2 Rebuild Workflow

Status: proposed v2 architecture
Scope: rebuild process, repo strategy, gstack usage
Last updated: 2026-06-01
Source of truth: proposal

This document defines how to start a clean Veel v2 rebuild without dragging current repo debt into the new platform. The current repo remains the implementation reference and production fallback until v2 reaches tested parity.

For the detailed greenfield repo plan, use `build-plan.md`. This document is the operational workflow and slice order; the build-plan document is the step-by-step new repo implementation plan.

## Recommendation

If the decision is a full rebuild, create a clean `veel-v2` repository and keep this repo as read-only reference.

Use this repo for:

- product behavior reference
- tests and fixtures worth preserving
- provider lessons
- launch blockers
- screenshots and UX findings
- current docs and ADRs

Do not bulk-copy current application code. Port behavior through contracts, tests, and vertical slices.

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
- do not let it auto-port old code wholesale
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

## Vertical Slice Order

1. Auth, session, age gate, app shell.
2. Embedded wallet/external wallet onboarding and primary wallet selection.
3. Home feed read model with real media cards.
4. Media viewer and access-state projection.
5. Native SOL devnet payment intent, transaction request, confirmation, settlement.
6. Paid unlock entitlement.
7. Tip/support settlement without access grant.
8. Referral attribution and commission.
9. Bunny VOD upload/status/playback.
10. Livepeer live room/pass/chat/replay.
11. Messages and paid messages.
12. User activity and wallet transactions.
13. Creator profile and creator monetisation dashboard.
14. Admin payments/unlocks/provider ops dashboard.
15. Events/tickets.
16. Dating mode.
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

Stop or pause the rebuild if:

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
