# Production Branch Inventory

Status: accepted
Scope: branch consolidation evidence and cleanup decisions
Last updated: 2026-08-16
Source of truth: yes

Owns:
- branch-level integrate, supersede, retain, or delete decisions
- evidence required before remote cleanup

Defers to:
- `current-implementation-status.md` for product readiness
- Git and GitHub for current branch, pull-request, and check evidence

## Current Baseline

Launch 00 was based on current `origin/main` at `9ef4a0dca3b61dfa811c928223d4f3497f11fe8e`, the squash merge of PR #34. The implementation branch is `codex/launch-00-baseline-governance`; old feature branches are not valid bases.

Before Launch 00, `main` had no protection or ruleset. Launch 00 enabled strict required checks, pull-request flow, admin enforcement, conversation resolution, linear history, no force push, no deletion, squash-only merge, automatic merged-branch cleanup, secret scanning, push protection, and Dependabot security updates. Open dependency PRs were #26 through #33. All were inspected against current `main`; none may be merged with a stale lockfile.

The prior table is the audited decision record for PRs #26–#33, not a claim that no later bot branches exist. At the 2026-08-14 Slice 00 refresh, the only product branch in scope is `codex/launch-00-baseline-governance`. Fresh Dependabot branches for pnpm/action-setup, eslint, fastify-raw-body, @fastify/rate-limit, globals, and rolldown's Darwin binding are unrelated to Slice 00 and are neither merged nor normalized here. Each must be reviewed independently from current `main`; Slice 00 deletes only its own branch after protected squash merge.

The later queue was resolved individually from fresh `main`: pnpm/action-setup v6 merged in PR #36, ESLint 10 in PR #37, `@fastify/rate-limit` 11 in PR #38, `fastify-raw-body` 6 in PR #39, and `globals` 17 in PR #40. Each passed its domain-specific local proof plus protected CI, isolated Postgres, security, preview, build, and browser gates. PR #41 was closed rather than merged because `rolldown@1.0.3` officially pins every native binding to 1.0.3, while the PR changed only the root Darwin arm64 fallback to 1.2.4. Standalone Darwin-binding Dependabot proposals are now ignored and dependency policy enforces coordinated runtime/binding versions.

Because `mariospeterman` is the only qualified repository administrator, the required approval count is zero; all automated checks and administrator enforcement still apply. Emergency recovery requires a documented incident, temporary explicit protection change by the owner, an audited pull request or corrective commit, and immediate restoration of these settings. There is no ordinary administrator bypass.

## Branch Evidence And Decision

| Branch / PR | Evidence against current `main` | Decision |
| --- | --- | --- |
| `codex/frontend-wallet-onboarding` | `git diff --stat main...origin/codex/frontend-wallet-onboarding` was empty. Its commits appeared different only because PR #34 was squash-merged; there was no remaining tree change or open PR. | Local and remote branches deleted after recording evidence. |
| PR #33 `actions/setup-node-7` | Current action-major update only. Launch 00 reapplies it with the complete workflow truth/security change. | Closed as superseded; remote branch deleted. |
| PR #31 `actions/checkout-7` | Action-major update generated from an older base. Launch 00 reapplies it across every canonical workflow. | Closed as superseded; remote branch deleted. |
| PR #30 `vitest-4.1.9` | Stale lockfile; current baseline already resolves Vitest `4.1.10`. | Closed as obsolete; remote branch deleted. |
| PR #29 `tailwindcss-4.3.1` | Stale lockfile and broad frontend impact unrelated to Launch 00. | Closed and branch deleted; recreate from current `main` only after frontend build/visual review is scheduled. |
| PR #28 `globals-17.6.0` | Stale lockfile and major lint-runtime update unrelated to Launch 00. | Closed and branch deleted; recreate from current `main` with lint/type/build proof. |
| PR #27 `@fastify/rate-limit-11` | Stale lockfile and major API/security update. Launch 00 deliberately keeps compatible v10 while wiring existing presets. | Closed and branch deleted; reconsider in Slice 01 after official breaking-change review. |
| PR #26 `@supabase/ssr-0.12` | Stale lockfile and auth-cookie impact. | Closed and branch deleted; recreate from current `main` only with Supabase changelog, auth, logout, and browser proof. |

## Cleanup Rules

- Never merge dependency lockfiles generated from an obsolete base.
- Delete only branches with no open required PR and no unique required tree change.
- Recreate dependency updates individually from current `main` and run domain-specific gates.
- Keep protected `main`, active slice branches, release branches, and recovery branches.
- Prefer squash merge for coherent slices, then delete merged short-lived branches.

## Evidence Commands

```sh
git diff --stat main...origin/<branch>
git cherry -v main origin/<branch>
git log --left-right --cherry-pick --oneline main...origin/<branch>
gh pr list --state open
```

Launch 00 replacement changes were pushed before branch cleanup. All listed stale PRs were explicitly closed with a supersession audit comment before their remote branches were deleted.
