# ADR 0001: Fastify and Supabase Architecture

Status: accepted v2 direction
Scope: v2 backend/platform
Last updated: 2026-06-01
Source of truth: proposal

## Context

Veel v2 depends heavily on TypeScript-first provider ecosystems: Solana Pay, embedded wallet tooling, Livepeer examples/SDKs, Supabase Realtime client integration, OpenAPI generation, and provider-first frontend components. The greenfield build should use one TypeScript runtime boundary for API, workers, contracts, and provider adapters.

## Decision

For v2:

- Fastify TypeScript as the core API.
- Supabase Postgres/Auth/Realtime as the database, identity, and realtime foundation.
- Fastify remains the business policy layer.
- Hono is reserved for isolated edge endpoints only.
- pnpm remains the package manager and Node.js LTS remains the production runtime for v2 launch.
- Bun is evaluated later only after provider SDK and infrastructure compatibility is proven.
- The previous prototype remains reference-only until v2 reaches feature parity.

## Consequences

Positive:

- Better Solana/provider SDK ergonomics.
- One language across frontend/backend.
- Cleaner generated contract workflow.
- Less custom websocket infrastructure if Supabase Realtime is sufficient.
- Avoids adding package-manager/runtime migration risk while replacing the backend/auth/realtime stack.

Negative:

- Auth/session architecture must be designed before app implementation.
- Rebuild risk is high if contracts are not frozen.
- Supabase RLS complexity must be designed and tested.
- Admin tooling must be rebuilt or separately selected.
- Bun performance gains are deferred until the v2 dependency graph and provider SDK paths are stable.

## Non-Negotiables

- Payment/access validation cannot become weaker.
- Provider secrets remain backend-only.
- Frontend cannot own business truth.
- RLS cannot replace backend policy for money/access/admin.
