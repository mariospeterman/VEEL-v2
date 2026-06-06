# Veel V2 Realtime, Messages, And Activity

Status: accepted
Scope: realtime, messages, notifications, activity
Last updated: 2026-06-06
Source of truth: yes

Owns:
- realtime messages activity decisions for its named domain

Defers to:
- INDEX.md, route-map.md, OpenAPI, schema blueprint, and ADRs where narrower

Does not own:
- unrelated domains, implementation shortcuts, provider secrets, or hidden source-of-truth rules

Launch scope:
- accepted v2 launch or phased behavior stated in this document

Non-goals:
- historical-context inference, duplicate systems, and unapproved provider/product expansion

## Realtime Decision

Use Supabase Realtime selectively. Do not build a custom websocket server unless Supabase cannot satisfy a specific requirement.

## Realtime Channels

| Use case | Mechanism | Notes |
| --- | --- | --- |
| Direct messages | Postgres Changes or Broadcast after backend write | Participants only through RLS. |
| Typing indicators | Presence/Broadcast | Ephemeral, no DB write required. |
| Online state | Presence | No business truth. |
| Notifications | Postgres Changes on notification projection | User-owned rows only. |
| Live viewer count | Presence plus backend heartbeat aggregate | Avoid precise billing from presence alone. |
| Live room status | Backend write + realtime projection | Backend remains source. |
| Payment status | Backend event to user channel or polling | Do not expose internal settlements directly. |
| Activity | Projection rows | Backend-derived. |

## Current Notification Implementation State

- The notification foundation includes OpenAPI routes, the notifications migration, RLS-protected notification/preference/device tables, a Fastify notification module, backend tests, and settings-page preference reads.
- Web push device registration stores endpoint/key material as server-side hashes and returns only sanitized device projections.
- Worker dispatch jobs, browser service-worker subscription UX, actual push delivery, Realtime subscription wiring, and admin delivery-health views remain planned production gaps.
- Until the push-delivery slice lands, user-facing notification copy may show server-owned preferences and account notification projections, but must not imply active browser push delivery.

## Message Flow

```mermaid
sequenceDiagram
  participant WebA
  participant API
  participant DB
  participant Realtime
  participant WebB

  WebA->>API: POST message
  API->>DB: Insert message + audit
  DB->>Realtime: Authorized change
  Realtime-->>WebB: New message event
  WebB->>API: Mark read
  API->>DB: Update participant state
```

## Paid Message Flow

Paid messages require:

- payment intent
- wallet approval
- confirmed settlement
- message delivery after backend confirmation
- idempotent delivery

Frontend may draft the body, but backend decides when the paid message becomes visible.

Current implementation slice:

- `GET /v1/messages/conversations` lists participant conversations through the API.
- `GET /v1/messages/conversations/:id/messages` returns participant-visible message rows.
- `POST /v1/messages/conversations/:id/messages` writes normal messages through Fastify.
- `POST /v1/messages/conversations/:id/paid-message-intents` stores the paid-message body server-side and creates a server-priced `paid_message` payment intent.
- Confirmed backend settlement inserts the paid message and audit event transactionally.
- New public message tables have RLS enabled. Baseline read policies are participant-scoped before direct Postgres Changes exposure.
- `/messages` reads the participant inbox and selected conversation through the typed web API helper. It does not render local conversation or paid-message fixtures.

## Activity Model

Activity is backend-derived:

- likes
- saves
- comments
- shares
- unlocks/purchases
- tips/support
- subscriptions
- live passes
- event tickets
- referral shares
- commissions
- wallet transactions
- reports/safety actions if user-visible
- badges and verification status changes
- ranking changes if user-visible

No fake counters.

Current implementation slice:

- `GET /v1/activity` returns a backend-derived activity feed composed from payment and wallet transaction records.
- `GET /v1/activity/payments` returns normalized payment-intent activity for the authenticated, age-verified user.
- `GET /v1/activity/wallet-transactions` returns backend-observed wallet transaction records created during payment submission/settlement handling.
- `GET /v1/activity/referrals` is the activity route-map alias for the same backend-derived referral activity returned by `GET /v1/referrals/activity`.
- `/activity` reads payment activity and wallet transactions through the typed web API helper and does not render local payment or wallet transaction fixtures.
- Wallet transaction records carry submission and confirmation references for user accountability, but do not grant access or revenue by themselves.

## Profile And Ranking Activity

Own activity may show:

- age verified
- wallet linked
- badge earned
- badge revoked
- creator rank changed
- event hosted/attended
- subscriber milestone
- support/tip milestone

Public ranking projections must be sanitized and opt-out aware where product policy allows.

## RLS Requirements

Baseline:

- `0017_rls_policy_baseline.sql` enables RLS on current public-schema tables that were created before explicit realtime policy work.
- Direct Supabase reads are authenticated only and read-only for browser roles.
- Business mutations still go through Fastify.

Messages:

- sender and recipient can read.
- blocked users obey backend block state.
- admin/moderator access goes through backend/admin tools, not broad client RLS.

Notifications:

- are backend-derived projections from existing business events
- may inform the user about engagement, messages, paid-message delivery, access/pass state, Membership renewal/cancel/grace state, wallet action required, age/KYC action required, creator/studio setup tasks, safety/admin decisions, provider incidents, and account issues
- never grant access, confirm payment, create revenue, change settlement state, create Mutuals, raise ranking, or override backend access truth
- must be user-owned rows under RLS before direct Realtime exposure
- must support explicit preference controls and device revocation
- direct client-facing resources must not include raw web-push endpoints, browser auth keys, provider secrets, raw provider payloads, or service-role data

- user can read own notifications.

Activity:

- user can read own private activity.
- public creator activity is a separate sanitized projection.

## Anti-Abuse

- rate limit messages
- rate limit paid message attempts
- report/block visible everywhere
- media attachments virus/moderation scan
- paid message refund/reversal policy documented before scale
