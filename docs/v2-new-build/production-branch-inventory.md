# Production Branch Inventory

Status: accepted
Scope: branch consolidation evidence and integration decisions
Last updated: 2026-08-10
Source of truth: yes

Owns:
- remote branch inventory for the production-hardening integration cycle
- branch-level integrate, reapply, supersede, or reject decisions
- validation required before remote branch cleanup

Defers to:
- `current-implementation-status.md` for the production-hardening backlog
- Git history and GitHub checks for commit and CI evidence
- official dependency release notes for upgrade behavior

Does not own:
- product behavior, provider payloads, API contracts, database shape, or dependency versions

Launch scope:
- consolidation of the 2026-08-10 remote branch set into one reviewed production baseline

Non-goals:
- blind branch merging, stale lockfile reuse, or parallel implementation retention

## Baseline Decision

`origin/codex/frontend-wallet-onboarding` is the integration baseline. It is 26 commits ahead of `origin/main`, with no unique `main` commits. It contains the canonical wallet-first onboarding, app shell, provider boundaries, contracts, migrations through `0071`, and the security-scan remediation missing from `main`.

The integration branch is `codex/production-hardening`, created directly from commit `130bac0`. Existing verified logout hardening remains in that worktree and belongs to the first integration commit.

## Remote Branch Evidence

| Branch | Merge base | Unique commits relative to baseline | Unique functional value | Decision | Validation |
| --- | --- | ---: | --- | --- | --- |
| `main` | `53e6740` | 0 | Older merge target. Its scheduled security scan fails on three historical test/document examples already allowlisted on the baseline. | Superseded as implementation baseline; retain as merge target until reviewed integration completes. | Full local gate and green pull-request checks before merge. |
| `codex/frontend-wallet-onboarding` | `130bac0` | Baseline | Canonical implementation across onboarding, wallet auth, provider verification, app shell, payments, MCP, contracts, and migrations. | Integrate through `codex/production-hardening`; do not recreate or merge a second copy. | Preserve existing tests, close current hardening gaps, then merge through review. |
| `dependabot/github_actions/actions/checkout-7` | `53e6740` | 1 | Updates checkout action only, but was generated from old `main`. | Reapply the supported major on the baseline after official release review; do not merge the branch. | Run all workflow gates and secret scan on the integration branch. |
| `dependabot/github_actions/actions/setup-node-7` | `53e6740` | 1 | Updates setup-node action only, but was generated from old `main`. | Reapply the supported major on the baseline after official release review; do not merge the branch. | Run the pinned Node/Corepack CI proof and deployment workflow validation. |
| `dependabot/npm_and_yarn/fastify/rate-limit-11.0.0` | `53e6740` | 1 | Rate-limit major upgrade plus stale lockfile. | Reapply independently only after Fastify compatibility and breaking-change review. | API unit/integration tests, rate-limit assertions, typecheck, and build. |
| `dependabot/npm_and_yarn/globals-17.6.0` | `53e6740` | 1 | ESLint globals major upgrade plus stale lockfile. | Reapply independently after runtime support review. | Lint, typecheck, tests, and build. |
| `dependabot/npm_and_yarn/supabase/ssr-0.12.0` | `53e6740` | 1 | Supabase SSR minor upgrade plus stale lockfile. | Reapply independently after Supabase changelog and SSR auth-cookie review. | Auth unit tests, desktop/mobile auth smoke, logout cookie proof, and build. |
| `dependabot/npm_and_yarn/tailwindcss-4.3.1` | `53e6740` | 1 | Tailwind upgrade plus stale lockfile; baseline currently resolves a different v4 line. | Resolve against the current registry and official release notes instead of copying the old branch version. | CSS build, responsive smoke, no-overflow checks, and visual review. |
| `dependabot/npm_and_yarn/vitest-4.1.9` | `53e6740` | 1 | Vitest patch upgrade plus stale lockfile. | Reapply independently if still current and compatible. | Complete unit/integration test suite. |

## Consolidation Rules

- Never merge a dependency branch lockfile created from `main` into the baseline.
- Apply dependency changes one package at a time and regenerate `pnpm-lock.yaml` from the baseline.
- Integrate useful behavior into the existing owner; remove the obsolete path in the same slice.
- Do not delete a remote branch until its useful value is integrated or explicitly rejected, its pull request is closed or merged, and the production integration is green.
- `main` becomes the clean baseline only through a reviewed, green pull request. Direct history rewriting and force pushes are excluded.

## Remote Cleanup Gate

Remote branches may be deleted after all of the following are true:

1. `codex/production-hardening` is pushed and reviewed against `main`.
2. CI, migration, preview, and security workflows are green.
3. The integration pull request is merged without bypassing branch protection.
4. Each dependency pull request is either superseded by an integrated upgrade or explicitly closed as obsolete.
5. `main` is fetched locally and matches `origin/main` exactly.
6. Only merged/superseded feature and dependency branches are removed; protected and active branches remain.
