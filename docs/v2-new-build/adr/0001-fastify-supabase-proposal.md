# ADR 0003: Proposed v2 Fastify and Supabase Architecture

Status: proposed
Scope: v2 backend/platform
Last updated: 2026-06-01
Source of truth: proposal

## Context

The current Laravel backend is functional and tested, but the product depends heavily on TypeScript-first provider ecosystems: Solana Pay, wallet tooling, Livepeer examples/SDKs, realtime client integration, and modern contract generation. Long-term maintainability may improve with a TypeScript backend if the rebuild is planned carefully.

## Decision

For v2, propose:

- Fastify TypeScript as the core API.
- Supabase Postgres/Auth/Realtime as the database, identity, and realtime foundation.
- Fastify remains the business policy layer.
- Hono is reserved for isolated edge endpoints only.
- pnpm remains the package manager and Node.js LTS remains the production runtime for v2 launch.
- Bun is evaluated later only after provider SDK and infrastructure compatibility is proven.
- Current Laravel API remains until v2 reaches feature parity.

## Consequences

Positive:

- Better Solana/provider SDK ergonomics.
- One language across frontend/backend.
- Cleaner generated contract workflow.
- Less custom websocket infrastructure if Supabase Realtime is sufficient.
- Avoids adding package-manager/runtime migration risk while replacing the backend/auth/realtime stack.

Negative:

- Full auth/session migration required.
- Rebuild risk is high if contracts are not frozen.
- Supabase RLS complexity must be designed and tested.
- Admin tooling must be rebuilt or separately selected.
- Bun performance gains are deferred until the v2 dependency graph and provider SDK paths are stable.

## Non-Negotiables

- Payment/access validation cannot become weaker.
- Provider secrets remain backend-only.
- Frontend cannot own business truth.
- RLS cannot replace backend policy for money/access/admin.
