# Veel V2 Initial Contracts And Schema

Status: proposed v2 architecture
Scope: OpenAPI and database starting point
Last updated: 2026-06-02
Source of truth: yes for first contract/schema draft

This document explains the first concrete implementation artifacts:

- `packages/contracts/openapi.yaml`
- `packages/database/schema-blueprint.sql`

They are intentionally broad enough to cover the full platform, but not final migrations. Convert them into proper migrations and generated clients during the first implementation slices.

## Contract Principles

- OpenAPI is the API source of truth.
- Frontend imports generated clients/types from `packages/contracts`.
- API validates every request against schema.
- Backend resources are provider-sanitized.
- Payment, entitlement, referral, commission, ticket, subscription, dating, age/KYC, and admin state come from backend responses only.

## First API Domains

```text
/auth
/me
/age
/wallets
/content
/media
/live
/engagement
/messages
/payments
/referrals
/subscriptions
/events
/dating
/activity
/admin
/webhooks
```

## Schema Principles

- money/access/provider callbacks are idempotent
- all provider records include provider name, provider reference, normalized state, audit link
- all sensitive provider payloads are either omitted or stored in restricted reconciliation tables
- all admin mutations write audit events
- all adult/content/dating/event state is explicit and queryable

## Implementation Rule

Before building a slice:

1. Add or refine OpenAPI paths.
2. Add migrations based on the schema blueprint.
3. Add generated TS client/types.
4. Implement Fastify route/service/adapter.
5. Add tests and frontend smoke.
