# Veel V2 Event Access Architecture

Status: accepted
Scope: events, Event Access Passes, Solana payment, QR/check-in, admin ops
Last updated: 2026-06-05
Source of truth: yes for v2 Event Access

Owns:
- Event Access decisions for its named domain

Defers to:
- INDEX.md, route-map.md, OpenAPI, schema blueprint, and ADRs where narrower

Does not own:
- unrelated domains, implementation shortcuts, provider secrets, legal advice, or hidden source-of-truth rules

Launch scope:
- accepted v2 launch or phased behavior stated in this document

Non-goals:
- ticket marketplace positioning, resale, escrow, historical-context inference, duplicate systems, and unapproved provider/product expansion

Events are content-attached access flows. They are not a secondary ticket marketplace, not root navigation by default, and paid access always requires explicit confirmation.

Use legal/backend language:

- Event Access
- Event Access Pass
- Access Pass
- access entitlement
- check-in entitlement
- access receipt

Use UI language:

- Pass
- Passes
- Get Access
- Reserve Access

Avoid launch-facing language:

- ticket marketplace
- resale
- creator ticket balance
- escrowed ticket proceeds

## Current Implementation State

- `POST /v1/events`, `GET /v1/events/{eventId}`, and `PATCH /v1/events/{eventId}` provide profile/age-gated event creation and owner updates.
- `POST /v1/events/{eventId}/tickets/intents` is the implemented compatibility path for Event Access payment or approval intents.
- Confirmed `event_ticket` compatibility settlement grants a backend Event Access Pass and QR record in the settlement transaction. Wallet approval or frontend redirect never grants access.
- `GET /v1/activity/tickets` is the implemented compatibility activity path for current user Event Access records.
- `POST /v1/tickets/{ticketId}/check-in` validates the backend-issued QR token server-side and idempotently moves an active pass to `checked_in`.
- `/app/events/:id` and `/app/tickets` have smoke-covered frontend projections for pass sheet and QR display.
- Target route names are `/event-access` and `/passes`; compatibility ticket route names must be migrated before launch copy ships.

## Product Position

- Creator can attach an event to media.
- Event type is either `digital_live_stream` or `physical`.
- Event can be public sale, free, paid, or private request-to-join/apply.
- Paid Event Access uses noncustodial Solana-compatible payment intents.
- Backend creates access entitlement, QR, receipt, and compliance ledger entry only after verified payment or approval.
- Launch does not need a separate Solana ticketing provider. Use backend Event Access Pass entitlements plus Solana settlement.
- Future NFT/token passes, collectible passes, transferable passes, or third-party ticketing providers are separate ADRs, not the launch default.

Noncustodial boundary:

- Pass payment is a wallet-approved transaction between buyer wallet and configured creator/event owner/platform/referral recipients.
- Veel does not custody Event Access funds.
- Veel backend creates the transaction request, verifies confirmed chain settlement, records the access entitlement, writes compliance/receipt state, and issues QR/check-in state.
- The QR/pass record is an access entitlement and operational receipt, not a custodial balance.
- Refunds/reversals require explicit noncustodial refund transaction or audited compensating policy; they are not hidden internal balance edits.

## Routes

```text
/event-access                  planned secondary surface
/event-access/:id              planned
/event-access/:id/passes       planned access sheet/page
/passes                        planned My Passes
/passes/:id                    planned pass detail / QR
/admin/events                  planned admin ops
/admin/event-access            planned admin access ops

/app/events/:id                compatibility frontend path
/app/tickets                   compatibility frontend path
/v1/events/{eventId}/tickets/intents compatibility API path
/v1/tickets/:id/check-in       compatibility API path
```

## Backend Ownership

Fastify owns:

- event creation/update validation
- inventory and capacity
- creator-selected pass pricing validated against admin/env guardrails
- payment intent
- payment verification
- Event Access Pass entitlement
- QR/receipt generation
- compliance ledger write
- check-in state
- refund/revocation policy
- audit events

Frontend owns:

- event card/sheet UI
- pass purchase/review UI
- wallet approval presentation
- My Passes display
- QR presentation after backend entitlement

Frontend never creates access from wallet redirect or optimistic state.

## Data Relations

Target names:

```text
users
  └─ created_events

content_items
  └─ attached_event_id

events
  ├─ creator_user_id
  ├─ content_item_id
  ├─ title, description
  ├─ starts_at, ends_at
  ├─ event_type: digital_live_stream | physical
  ├─ location_type: digital_live_stream | physical
  ├─ location_label, location_lat, location_lng, place_provider_ref
  ├─ capacity
  ├─ access_price
  ├─ currency
  ├─ access_rule: public_sale | private_apply
  └─ state: draft | published | sold_out | cancelled | completed

event_access_pass_types
  ├─ event_id
  ├─ label
  ├─ price
  ├─ capacity
  └─ sale_window

event_access_passes
  ├─ event_id
  ├─ pass_type_id
  ├─ holder_user_id
  ├─ payment_intent_id
  ├─ receipt_id
  ├─ qr_token_hash
  └─ state: active | checked_in | revoked | expired

refunds_and_disputes
  ├─ event_access_pass_id
  ├─ payment_intent_id
  ├─ state: requested | approved | rejected | processed | failed
  └─ reason/audit metadata
```

Compatibility names until migration:

```text
ticket_types        -> event_access_pass_types
ticket_entitlements -> event_access_passes
ticket_reservations -> event_access_reservations
ticket receipt      -> access receipt
```

## Paid Event Access Flow

```text
1. User opens Event Access sheet
2. API returns event availability and creator-selected price validated by backend policy
3. User confirms access intent
4. API creates payment intent with event_access_pass product type
5. Wallet approves noncustodial split transaction
6. Helius/RPC payment evidence reaches backend
7. Backend verifies signature, reference, payer, amount, recipient, finality, splits
8. Backend writes compliance ledger and receipt records
9. Backend grants Event Access Pass idempotently
10. Backend creates QR/check-in record
11. Frontend refreshes My Passes from backend state
```

Payment flow ordering:

```text
chain settlement evidence
  -> compliance ledger entry
  -> receipt/invoice determination
  -> entitlement grant
  -> activity/admin projection
```

## Provider Decision

Launch default:

- backend-owned event/pass inventory
- backend-owned Event Access Pass entitlement and QR/access receipt
- noncustodial Solana payment settlement
- backend check-in state and audit log
- creator-owned pass price within admin/env minimums and policy limits

This is the fastest secure path for Veel because it supports public access, private request-to-join events, refunds/revocation policy, admin check-in, compliance reporting, and referral/split settlement without premature custom smart contracts.

Do not build a custom Solana ticketing protocol for launch.

Evaluate later only if the business needs:

- transferable passes
- collectible NFT passes
- resale/secondary-market rules
- token-gated external venue integrations
- partner ticketing integrations

Candidates for a later ADR include Crossmint/NFT APIs or a dedicated Solana ticketing provider, but only after proving QR entitlements are insufficient.

## Production Details

Launch Event Access must support:

- pass types with label, price, currency, capacity, and sale window
- all-in price display before wallet confirmation
- inventory reservation with short expiry during payment intent
- per-user pass limits
- cancellation and refund policy shown before purchase
- request-to-join approval/rejection state for private events
- QR token rotation or reissue after support/admin action
- check-in staff role and admin audit log
- offline-friendly check-in fallback where venue connectivity is weak
- duplicate/replay-safe payment and check-in handling
- digital event access mapping to live-room entitlement
- physical event check-in separate from payment settlement

Anti-scalping launch rule:

- no transferable/resale passes at launch
- no NFT pass transfer at launch
- every transfer/resale feature requires a dedicated ADR, legal review, fraud controls, and user support plan

## Free Or Request-To-Join Flow

```text
Free access:
  user requests access
  API checks inventory/policy
  API writes compliance/audit records
  API grants Event Access Pass entitlement

Request-to-join:
  user requests access
  creator/admin approves or rejects
  API grants or denies entitlement
  all decisions are audited
```

## Configurable Limits

Environment defaults and admin overrides must cover:

- maximum event duration
- minimum lead time before event start
- maximum pass capacity
- sale window
- private request-to-join approval window
- cancellation/refund cutoff
- check-in grace period
- per-user pass limits

Environment values provide safe defaults. Admin policy can override them for business operations without a deploy, and every override is audited.

## Location UX

Launch location flow:

1. Creator chooses `digital_live_stream` or `physical`.
2. Digital live stream events attach to a live-room/pass flow and do not require a street location.
3. For physical events, UI offers:
   - use current location after browser permission
   - search street/place manually
   - edit display label before publishing
4. Backend stores normalized display label, coarse coordinates if needed for map display, and provider/place reference.
5. Exact user/device location is never shared unless the creator explicitly publishes it as the event location.

Provider rule:

- Use OpenStreetMap-based geocoding for cost-efficient launch UX.
- The public Nominatim service is acceptable only for light development/testing and must follow its published usage policy: low request rate, identifying app/referrer, and attribution.
- Production should use a hosted OSM geocoder, self-hosted Nominatim/Photon, or another low-cost geocoder with caching and clear attribution.
- Autocomplete/reverse geocoding must be rate-limited and cached server-side.

Reference: OSMF Nominatim usage policy, https://operations.osmfoundation.org/policies/nominatim/

## Gesture Model

```text
Event mode:
  explicit button = interested or open Event Access sheet
  explicit button = not interested
  final paid access = explicit confirm button only
```

## Provider Dependencies

- Solana Pay / Solana RPC for wallet-approved paid access.
- Helius scoped to confirmed payment evidence.
- Embedded wallet and user-wallet funding path for conversion support.
- Email/push provider for optional receipt reminders.
- No provider grants Event Access directly.

Evaluate later:

- Crossmint compressed NFT/SFT minting for collectible or transferable passes.
- Unlock Protocol for membership-like event access if EVM/membership strategy becomes relevant.
- Dedicated Solana ticketing vendors only after production API/security/vendor due diligence.

Do not make NFT pass/ticketing launch-critical. QR access entitlement plus noncustodial Solana settlement is enough for the first production version.

## Admin/Ops Requirements

Admin can inspect:

- event state
- pass inventory
- payment intent
- transaction/signature
- Event Access Pass entitlement
- compliance ledger/receipt/invoice state
- QR/check-in state
- refund/revocation decision
- audit log

Admin mutations require role policy, confirmation, and audit event.

## Tests

- creator creates event draft
- event publish validates capacity/date/price
- free access grants entitlement idempotently
- paid access grants entitlement only after backend verification
- duplicate payment event does not duplicate pass
- sold-out inventory blocks new passes
- passes with processed refund/dispute records normally revoke the access entitlement
- revoked pass cannot check in
- QR check-in is idempotent
- compliance ledger and receipt records exist before entitlement grant
- frontend never sees raw payment/provider secrets
