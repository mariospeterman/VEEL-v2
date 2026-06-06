# Veel V2 Initial Contracts And Schema

Status: accepted
Scope: OpenAPI and database starting point
Last updated: 2026-06-02
Source of truth: yes

Owns:
- contracts and schema decisions for its named domain

Defers to:
- INDEX.md, route-map.md, OpenAPI, schema blueprint, and ADRs where narrower

Does not own:
- unrelated domains, implementation shortcuts, provider secrets, or hidden source-of-truth rules

Launch scope:
- accepted v2 launch or phased behavior stated in this document

Non-goals:
- historical-context inference, duplicate systems, and unapproved provider/product expansion

This document explains the first concrete implementation artifacts:

- `packages/contracts/openapi.yaml`
- `packages/database/schema-blueprint.sql`

They are intentionally broad enough to cover the full platform, but not final migrations. Convert them into proper migrations and generated clients during the first implementation slices.

## Contract Principles

- OpenAPI is the API source of truth.
- Every OpenAPI path must be present in `route-map.md`.
- Every operation must have a stable `operationId`.
- State-changing operations must declare request bodies and idempotency expectations.
- Webhook operations must declare signature headers and idempotency/replay expectations.
- Shared typed errors are mandatory; do not return provider-native error payloads.
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
/mutuals
/activity
/admin
/webhooks
```

The first contract skeleton is in `packages/contracts/openapi.yaml`. It intentionally includes Mutuals, events, payments, live, media, engagement, and webhook paths so the first implementation is contract-led.

## Schema Principles

- money/access/provider callbacks are idempotent
- all provider records include provider name, provider reference, normalized state, audit link
- all sensitive provider payloads are either omitted or stored in restricted reconciliation tables
- all admin mutations write audit events
- all adult/content/Mutuals/event state is explicit and queryable

## Implementation Rule

Before building a slice:

1. Add or refine OpenAPI paths.
2. Add migrations based on the schema blueprint.
3. Add generated TS client/types.
4. Implement Fastify route/service/adapter.
5. Add tests and frontend smoke.

## Launch Product Enum

The launch payment product enum is:

```text
tip
support
content_unlock
paid_message
live_pass
event_ticket
creator_subscription
platform_subscription
```

Do not add drops, resale, NFT tickets, bundles, gifts, or premium-room variants to contracts or schema without a new ADR.

## Drift Checks

Before implementation and in CI:

- parse `packages/contracts/openapi.yaml`
- compare OpenAPI paths with `docs/v2-new-build/route-map.md`
- fail if any OpenAPI operation is missing `operationId`
- fail if `unlock` appears as a payment product type instead of `content_unlock`
- fail if active docs describe the older repository as an implementation dependency
