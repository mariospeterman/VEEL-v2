# Veel Shoot Own Shine

Status: new v2 repo scaffold
Scope: greenfield Veel rebuild

This repo is the clean starting point for the Veel v2 greenfield build. The previous prototype is reference only for validated lessons and tests. Do not bulk-copy prototype app code into this repo.

## Start Here

Read these first:

1. [Agent rules](AGENTS.md)
2. [Claude-compatible rules](CLAUDE.md)
3. [V2 new-build documentation index](docs/v2-new-build/INDEX.md)
4. [Build plan](docs/v2-new-build/build-plan.md)
5. [App architecture](docs/v2-new-build/app-architecture.md)
6. [Stack decision](docs/v2-new-build/stack-decision.md)
7. [AI tooling rules](docs/ai-tooling/agent-operating-rules.md)

## Intended Stack

- Web: Next.js PWA, TypeScript, Tailwind v4, TanStack Query, Zustand
- API: Fastify TypeScript
- Worker: TypeScript worker runtime
- DB/Auth/Realtime: Supabase Postgres/Auth/Realtime
- Payments: Solana Pay, native SOL devnet first, SPL/USDC capable
- Wallets: embedded noncustodial wallet provider plus external Solana wallets
- Media: Bunny Stream for VOD, Livepeer for live/replay
- Safety: third-party age assurance, KYC/KYB only where needed
- Package manager: pnpm
- Runtime: Node.js LTS for launch

## Repo Shape

```text
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
  v2-new-build/
infra/
  docker/
  deploy/
  observability/
scripts/
```

## GStack Setup

Install GStack only after reviewing the docs and this repo's rules:

```sh
git clone https://github.com/garrytan/gstack.git ~/.codex/skills/gstack
cd ~/.codex/skills/gstack && ./setup --host codex
```

Use GStack for planning, design review, QA review, security review, and release review. Do not let it override the docs, ADRs, contracts, migrations, provider docs, or tests.

Cursor will automatically pick up `.cursor/rules/veel-v2.mdc`. Claude-style tools should read `CLAUDE.md`. Codex and other agents should read `AGENTS.md`.

## First Implementation Tickets

Use the first 10 tickets in [build-plan.md](docs/v2-new-build/build-plan.md#first-10-implementation-tickets).

Do not start by coding random screens. Start with repo foundation, contracts, database, Fastify API skeleton, and app shell.

## Current Validation

This scaffold intentionally contains docs and empty app/package folders only. Real validation starts after the first implementation ticket creates workspace tooling.
