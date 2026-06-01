# Veel Shoot Own Shine

Status: new v2 repo scaffold
Scope: greenfield Veel rebuild

This repo is the clean starting point for the Veel v2 rebuild. The old repo at `/Users/maki/Downloads/veel` is reference only. Do not bulk-copy old app code into this repo.

## Start Here

Read these first:

1. [V2 new-build documentation index](docs/v2-new-build/INDEX.md)
2. [Build plan](docs/v2-new-build/build-plan.md)
3. [App architecture](docs/v2-new-build/app-architecture.md)
4. [Stack decision](docs/v2-new-build/stack-decision.md)

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

## First Implementation Tickets

Use the first 10 tickets in [build-plan.md](docs/v2-new-build/build-plan.md#first-10-implementation-tickets).

Do not start by coding random screens. Start with repo foundation, contracts, database, Fastify API skeleton, and app shell.

## Current Validation

This scaffold intentionally contains docs and empty app/package folders only. Real validation starts after the first implementation ticket creates workspace tooling.

