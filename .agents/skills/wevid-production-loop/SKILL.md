---
name: wevid-production-loop
description: Operate WeVid's protected autonomous production loop one vertical slice at a time. Use when continuing production work, resuming an active slice or PR, selecting the next unblocked slice, validating and landing a slice, or advancing after a provider-blocked merge.
---

# WeVid Production Loop

## Route The Run

1. Read `AGENTS.md` completely.
2. Read `docs/v2-new-build/current-implementation-status.md`.
3. Read the production completion program in `docs/v2-new-build/build-plan.md`.
4. Read `docs/v2-new-build/slice-workflow.md`.
5. Fetch protected `main`; inspect its latest CI and every open pull request.
6. If a pull request carries `wevid-active-slice`, resume it. Do not start another write slice.
7. Otherwise choose the first unfinished unblocked slice recorded by the canonical docs.

Do not treat this skill as architecture. Contracts, migrations, canonical docs, and official
provider documentation remain the authorities.

## Build One Vertical Pull Request

1. Confirm the worktree is clean and branch from the newest green `origin/main`.
2. Update the single active-state block to `ACTIVE`, including branch, pull request, and blockers.
3. Establish product behavior, API contract, migration, provider boundary, tests, UI journey, and
   admin/ops visibility before implementation. Reuse existing owners; never add a duplicate system.
4. Re-check current official documentation before changing provider behavior. Do not invent APIs,
   payloads, environment variables, events, or security settings.
5. Implement the coherent UI-to-database/provider path. Keep payments, access, safety, identity,
   compliance, and ranking truth on the backend.
6. Keep provider-dependent production behavior fail-closed until exact staging evidence exists.
7. Update canonical docs with implemented behavior, gaps, environment needs, tests, operations,
   and release gates.

Use the state machine from `slice-workflow.md`. When credentials are unavailable, complete the
adapter, official fixtures, deterministic tests, diagnostics, and staging proof commands; record
`CODE_COMPLETE_PROVIDER_BLOCKED`; merge only if production remains fail-closed; then continue.

## Prove And Land

1. Run `pnpm docs:check` before and after contract, schema, route, ADR, provider-decision, or docs
   changes. Run the slice's focused tests plus the repository doctor, database checks, lint,
   typecheck, unit suite, production build, desktop/mobile browser proof, provider boundary tests,
   and real PostgreSQL integration where relevant.
2. Review architecture, security/privacy, UX/accessibility, and test/recovery risks. GStack may
   supply review lenses but is optional and never a source of truth or dependency.
3. Push one branch, open one draft pull request, and add the `wevid-active-slice` mutex label.
4. Record exact evidence and blockers. Resolve evidence-backed review findings and rerun affected
   checks at the reviewed head SHA.
5. Mark `MERGE_READY` only after required CI and review gates are green. Merge through protected
   `main`; never bypass protection or create permanent environment branches.
6. Fetch the squash merge, verify main-branch CI at the merge SHA, delete the merged branch, and
   update the single active-state block for the next slice.
7. Continue with the next unblocked slice until a defined human gate requires owner action.

## Stop Only At Human Gates

Stop and request owner action only for secrets or provider dashboards, ambiguous destructive remote
migrations, mainnet wallet approval, production DNS/hosting/deploy approval, unsettled price/tax/legal
decisions, adult enablement, irreversible deletion, a P0 security issue, material provider terms, or
a materially different unsettled product decision. Record the gate precisely before stopping.
