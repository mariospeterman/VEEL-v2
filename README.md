# WeVid

Status: accepted
Scope: provider-first 18+ creator PWA/dApp platform

This repository contains the active WeVid platform implementation. It is substantial but not production-launched: provider staging evidence, recurring collection, moderation approval, deployment, observability, and final product QA remain gated by the canonical build plan.

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
- DB/Auth/Realtime: Supabase Postgres/RLS/Realtime; Supabase Auth is optional recovery/linking
- Payments: Solana Pay, native SOL devnet first, SPL/USDC capable
- Wallets: Privy noncustodial Solana embedded wallets plus intentional external Solana wallets
- Media: Bunny Stream for VOD, Livepeer for live/replay
- Safety: third-party age assurance, KYC/KYB only where needed
- Package manager: pnpm 10.0.0 through Corepack
- Runtime: Node.js 22.16.0 for local development and CI

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

## Local Toolchain Setup

Use the committed version files as the source of truth:

- Node.js: `22.16.0`
- pnpm: `10.0.0`

With `nvm`:

```sh
nvm install
nvm use
corepack enable
corepack prepare pnpm@10.0.0 --activate
pnpm install --frozen-lockfile
```

Without `nvm`, install Node.js `22.16.0`, then run the same Corepack and install commands.

The root bootstrap script performs the Corepack activation and frozen install:

```sh
pnpm bootstrap
```

Check the active local toolchain without running the full suite:

```sh
pnpm run doctor
```

## Product And Compliance Language

WeVid is an 18+ creator media, access, noncustodial settlement, and admin/compliance platform. Product docs use `Mutuals` instead of dating, `Event Access` / `Passes` instead of ticketing, and `Profile Membership` / `Join @handle` instead of creator subscriptions.

The legal/financial boundary is explicit: no custody, no WeVid-held creator balances, no internal credits, no withdrawals, no escrow, and no payment-based ranking boosts. DAC7/DAC8/VAT readiness is tracked in [dac7-dac8-vat-system.md](docs/v2-new-build/compliance/dac7-dac8-vat-system.md).

Do not start by coding random screens. Start with repo foundation, contracts, database, Fastify API skeleton, and app shell.

## Current Validation

The implementation includes the Next.js PWA, Fastify API, worker, migrations through `0091`, shared contracts/config/UI, broad domain routes, and real unit/browser/Postgres integration coverage. See the current implementation status for verified boundaries and launch blockers.

Run the local web and API processes from separate terminals:

```sh
pnpm --filter @veel/api dev
pnpm --filter @veel/web dev
```

The web app serves the PWA shell. The API serves Fastify routes, `/healthz`, `/readyz`, OpenAPI, OAuth metadata, and the remote MCP endpoint when its env gates are enabled.

The locked target is one universal WeVid account/profile and three visible onboarding steps: Account + Wallet, Minimal Profile, and Age Verification. Every user leaves Step 1 with either an external Solana wallet or a Privy embedded Solana wallet. Supabase signup is never a fourth mandatory step.

Current runtime uses backend-verified Solana signatures:

- `POST /v1/auth/wallet/challenges` creates the signed login challenge.
- `POST /v1/auth/wallet/sessions` verifies the signature and returns a WeVid bearer session.
- Supabase email/social auth remains optional recovery linking, primarily for external-wallet-only users. It must resolve to the existing WeVid user and must not create a second profile or wallet.
- Privy is the sole embedded-wallet launch runtime. The target Privy path authenticates, creates or retrieves the Solana wallet, signs the normal WeVid challenge, and creates the canonical backend session as one continuous Step 1 flow. The current UI still needs that orchestration in Slice 02.
- Embedded provider UI is gated by `NEXT_PUBLIC_PRIVY_APP_ID` and `NEXT_PUBLIC_EMBEDDED_WALLET_RUNTIME_ENABLED`; keep provider secrets server-only and fail closed until Privy staging/launch approval.
- `NEXT_PUBLIC_SOLANA_CHAIN` controls the web chain label: `solana:devnet` locally, `solana:mainnet` only when production provider and payment checks are approved.

Current executable validation:

```sh
pnpm check
```

`pnpm check` expands to:

```sh
pnpm docs:check
pnpm db:migrations:check
pnpm deploy:check
pnpm lint
pnpm typecheck
pnpm test
```

CI runs the same minimum proof explicitly:

```sh
node --version
pnpm --version
pnpm install --frozen-lockfile
node scripts/check-docs.mjs
node packages/database/scripts/check-migrations.mjs
node scripts/check-deploy-readiness.mjs
pnpm lint
pnpm typecheck
pnpm test
```

The canonical GitHub Actions proof job is `pinned-toolchain-proof` in `.github/workflows/ci.yml`. It prints `node --version` and `pnpm --version` before installation.

If local macOS rejects a native test-runner binding, do not bypass tests or broaden the Node engine. Use the pinned GitHub Actions proof job as the source of truth and repair the local Node/toolchain separately.

Remote MCP staging proof uses the checked-in scripts:

```sh
pnpm mcp:seed
pnpm mcp:oauth:pkce
pnpm mcp:smoke
```

`pnpm mcp:seed` pre-registers a local/staging OAuth client, `pnpm mcp:oauth:pkce` prints the authorization URL and token-exchange command, and `pnpm mcp:smoke` verifies OAuth metadata, `/mcp` initialization, scoped tool listing, allowed tool execution, forbidden tool denial, and optional audit rows. Full client proof steps are documented in [mcp-staging-proof.md](docs/v2-new-build/mcp-staging-proof.md).

Production remains blocked until launch-approved provider credentials, staging webhook proof for noncustodial split settlement, subscription allowance verification, remote MCP client proof, production deploy variables, backups, alert routing, and security/compliance gates are complete.
