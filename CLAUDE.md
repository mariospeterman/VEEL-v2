# CLAUDE.md

## Purpose

This file mirrors the core agent rules from `AGENTS.md` for Claude-style tooling. `AGENTS.md` remains the canonical cross-agent instruction file.

## Read First

1. `AGENTS.md`
2. `docs/v2-new-build/INDEX.md`
3. `docs/v2-new-build/build-plan.md`
4. `docs/v2-new-build/app-architecture.md`
5. `docs/v2-new-build/stack-decision.md`

## Operating Mode

Build Veel v2 as a clean greenfield platform. The old repo is reference only. Do not bulk-copy old code.

Use this order for every meaningful change:

1. Identify the owning domain and source-of-truth doc.
2. Update or confirm the contract/schema.
3. Update or add migrations if data shape changes.
4. Implement the smallest vertical slice.
5. Add tests.
6. Update docs.
7. Run relevant checks.

## Non-Negotiables

- No duplicate app shells, media viewers, payment systems, provider adapters, realtime systems, API clients, or CSS systems.
- No frontend-owned business truth for payments, access, referrals, commissions, tickets, subscriptions, age/KYC, moderation, admin, or provider state.
- No provider secrets, private keys, stream keys, signed URLs, service-role keys, webhook secrets, or raw PII in client code or logs.
- No wallet approval treated as payment proof.
- No custom provider infrastructure when official provider APIs solve the job.
- No hidden obsolete UI. Delete, dev-gate, or implement real collapsed state.
- No broad refactors without a slice goal and tests.

## Provider-First Rules

- Solana Pay: backend composes transaction request and verifies settlement before business effects.
- Helius/payment evidence: scoped to money/access evidence, not a broad firehose.
- Embedded wallets: noncustodial/user-controlled only.
- Bunny: VOD, TUS/upload, CDN/playback provider.
- Livepeer: live/replay provider.
- Age/KYC: provider sessions/webhooks/results; store minimal state only.
- Supabase: Auth/Postgres/Realtime platform, not business policy replacement.

## Required Output For Work

When completing work, report:

- files changed
- checks run
- tests added/updated
- risks or blockers
- next exact action

