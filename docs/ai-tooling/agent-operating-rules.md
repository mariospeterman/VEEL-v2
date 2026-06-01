# Agent Operating Rules

Status: current
Scope: Codex, Claude, Cursor, GStack

This repo is prepared for multiple AI coding tools, but the source of truth is the repo, not any tool memory.

## Tool Order

1. Read `AGENTS.md`.
2. Read tool-specific file if present: `CLAUDE.md`, `.cursor/rules/veel-v2.mdc`.
3. Read `docs/v2-new-build/INDEX.md`.
4. Work from `docs/v2-new-build/build-plan.md`.

## GStack

GStack can be installed after the docs and rules exist.

Use it for:

- planning review
- architecture review
- design review
- QA planning
- security review
- release review

Do not use it to:

- auto-port old code
- replace contracts
- replace migrations
- replace tests
- override provider official docs
- bypass security rules

## Codex / Claude / Cursor Expectations

- Keep changes small and slice-bound.
- Prefer official provider SDKs/APIs.
- Preserve provider boundaries.
- Add tests before risky behavior changes.
- Update docs when contracts, routes, schemas, envs, or provider behavior changes.
- Run relevant checks before reporting done.

