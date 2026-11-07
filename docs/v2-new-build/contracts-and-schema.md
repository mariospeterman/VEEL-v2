# WeVid V2 Initial Contracts And Schema

Status: accepted
Scope: OpenAPI and database starting point
Last updated: 2026-11-05
Source of truth: API contract guide; database authority is the immutable migration chain

Owns:
- contracts and schema decisions for its named domain

Defers to:
- INDEX.md, route-map.md, OpenAPI, immutable database migrations, and ADRs where narrower

Does not own:
- unrelated domains, implementation shortcuts, provider secrets, or hidden source-of-truth rules

Launch scope:
- accepted v2 launch or phased behavior stated in this document

Non-goals:
- historical-context inference, duplicate systems, and unapproved provider/product expansion

This document explains the contract and database authority boundaries:

- `packages/contracts/openapi.yaml`
- ordered SQL in `packages/database/migrations/`

`packages/contracts/openapi.yaml` is canonical for HTTP shape and generates the TypeScript contract artifact. The ordered migration chain is canonical for database shape. `packages/database/schema-blueprint.sql` is retained as non-authoritative planning history and must not be used to infer a current column, constraint, policy, or table.

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
- Payment, entitlement, referral, commission, Event Access Pass, subscription, Mutuals, age/KYC, and admin state come from backend responses only.

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

## Canonical Policy And Content Eligibility

- `recipient_monetisation_policies` owns global KYC mode plus deterministic product, jurisdiction, and risk-threshold triggers.
- `recipient_monetisation_risk_assessments` stores normalized, expiring risk evidence and reason/source/policy provenance; RLS permits staff reads and browser roles cannot execute the private resolver.
- `private.resolve_recipient_monetisation_policy(...)` is the single per-product KYC decision. `private.resolve_creator_kyc_state(...)` projects that decision for creator onboarding, dashboard, and verification capabilities. Payment and membership paths consume the same resolver through `private.assert_recipient_monetisation_ready(...)`.
- `payment_intents`, creator `subscription_plans`, and `subscription_collections` retain the effective recipient-KYC requirement, mode, version, and reason for audit. Recurring collection rechecks the resolver and suspends before submission when newly required KYC evidence is absent.
- `private.eligible_content(...)` is the viewer-relative content authority used by feed, detail, Discover, profiles, shares, unlocks, and engagement. It applies age/release/moderation/profile state, public/follower/member visibility, active entitlement where applicable, the independent `both | sfw | nsfw` content preference, hidden creators/topics, blocks, and the viewer's own reports. Anonymous reads are public-visibility and Safe-only.
- `viewer_feed_preferences.default_feed_mode` stores only the chronological scope (`latest | following`). Content preference remains separate and cannot be encoded as a feed mode. A deprecated `recommended` request may normalize to `latest` during compatibility migration but must not be persisted by new writes.
- Home/Bits read models order only by `published_at DESC, id DESC`, capture a first-page upper bound, and carry that bound plus the last key and request scope in the opaque cursor. No scoring table or bounded candidate session is a feed authority.

## Canonical Media Scope

- New `CreateContentRequest` writes admit photo/image, carousel, and video media only. Text and poll
  discriminators remain in read resources solely for authorized historical compatibility.
- Fresh create, update, publish, scheduled-publish, and poll-vote requests for `text` or `poll`
  return the normalized `content_format_retired` response. A completed exact idempotent replay may
  return its stored response without performing a new mutation.
- A single video's provider-confirmed duration classifies it as `bit` when duration is at most 60
  seconds and `vod` when it is longer. Browser-supplied format or duration is not publication truth.
- Moment is contextual lifecycle metadata over canonical media, not a separate composer choice or
  new content authority.
- Historical text/poll rows retain detail, owner, admin, moderation, export, and retention
  obligations but are excluded from primary feed/discovery/profile grids.
- Live room contracts keep host credentials out of viewer resources. The owner-only recent-auth
  reveal remains the narrow no-store capability used in component memory by browser broadcast or
  OBS Advanced setup; it does not create a second ingest endpoint.

## Canonical Identity And Session Tables

- `users` is the sole WeVid person/account identity.
- `user_provider_identities` maps a verified recovery provider plus immutable provider subject to exactly one user. Launch stores Supabase recovery subjects only; Privy embedded-wallet access is proven by the wallet challenge and does not create a second provider-subject authority. Email is never a join key.
- `app_sessions` stores only token hashes, authentication method/time, expiry, revocation, and rotation lineage. Session verification is SELECT-only.
- `recovery_link_intents` stores only hashed, expiring, one-use intent tokens bound to a recent application session.
- `profiles` enforces lowercase reserved-name-safe handles with database uniqueness and defaults to private. Age verification owns the transition from provisional/private to active/public.
- `users.supabase_user_id` remains a nullable compatibility lookup for older repositories during migration and contains the canonical `users.id`, never a recovery-provider subject. It is not an authentication authority or provider mapping source.
- The compatibility parameter name `supabaseUserId` remains at older repository adapters and as a deprecated `VerifiedApplicationSession` alias whose value is the canonical `users.id`; it never carries a recovery-provider subject. Removal owner: API domain-identity normalization; removal slice: Launch 02 canonical repository parameter migration. New wallet-auth security mutations accept `userId`, and provider subjects stop at the recovery verifier/repository boundary.

## Implementation Rule

Before building a slice:

1. Add or refine OpenAPI paths.
2. Add a new ordered migration against the final schema produced by the existing immutable chain; never rewrite applied history or derive a change from the historical blueprint alone.
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
event_access_pass
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
