# Veel V2 Events And Ticketing Architecture

Status: accepted
Scope: events, tickets, Solana payment, QR/check-in, admin ops
Last updated: 2026-06-03
Source of truth: yes for v2 Events and Ticketing

Owns:
- events ticketing decisions for its named domain

Defers to:
- INDEX.md, route-map.md, OpenAPI, schema blueprint, and ADRs where narrower

Does not own:
- unrelated domains, implementation shortcuts, provider secrets, or hidden source-of-truth rules

Launch scope:
- accepted v2 launch or phased behavior stated in this document

Non-goals:
- historical-context inference, duplicate systems, and unapproved provider/product expansion

Events are content-attached conversion flows. They are not root navigation by default, and ticket purchase/join always requires explicit confirmation.

## Product Position

- Creator can attach an event to media.
- Event type is either `digital_live_stream` or `physical`.
- Event can be public sale, free, paid, or private request-to-join/apply.
- Paid tickets use noncustodial Solana-compatible payment intents.
- Backend creates ticket entitlement and QR/receipt only after verified payment or approval.
- Launch does not need a separate Solana ticketing provider. Use backend QR/ticket entitlements plus Solana Pay settlement.
- Future NFT/token tickets, collectible tickets, transferable tickets, or third-party Solana ticketing providers are separate ADRs, not the launch default.

Noncustodial boundary:

- Ticket payment is a wallet-approved transaction between buyer wallet and configured creator/event owner/platform/referral recipients.
- Veel does not custody ticket purchase funds.
- Veel backend creates the transaction request, verifies confirmed chain settlement, records the ticket entitlement, and issues QR/check-in state.
- The QR/ticket record is an access entitlement and operational receipt, not a custodial balance.
- Refunds/reversals require explicit noncustodial refund transaction or audited compensating policy; they are not hidden internal balance edits.

## Routes

```text
/app/events                  planned secondary surface
/app/events/:id              planned
/app/events/:id/tickets      planned ticket sheet/page
/app/tickets                 planned My Tickets
/app/tickets/:id             planned ticket detail / QR
/admin/events                planned admin ops
```

## Backend Ownership

Fastify owns:

- event creation/update validation
- inventory and capacity
- creator-selected ticket pricing validated against admin/env guardrails
- payment intent
- payment verification
- ticket entitlement
- QR/receipt generation
- check-in state
- refund/revocation policy
- audit events

Frontend owns:

- event card/sheet UI
- ticket purchase/review UI
- wallet approval presentation
- My Tickets display
- QR presentation after backend entitlement

Frontend never creates ticket access from wallet redirect or optimistic state.

## Data Relations

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
  ├─ price
  ├─ currency
  ├─ access_rule: public_sale | private_apply
  └─ state: draft | published | sold_out | cancelled | completed

ticket_types
  ├─ event_id
  ├─ label
  ├─ price
  ├─ capacity
  └─ sale_window

ticket_entitlements
  ├─ event_id
  ├─ ticket_type_id
  ├─ holder_user_id
  ├─ payment_intent_id
  ├─ qr_token_hash
  └─ state: active | checked_in | revoked | expired

refunds_and_disputes
  ├─ ticket_entitlement_id
  ├─ payment_intent_id
  ├─ state: requested | approved | rejected | processed | failed
  └─ reason/audit metadata
```

## Paid Ticket Flow

```text
1. User opens event ticket sheet
2. API returns event availability and creator-selected price validated by backend policy
3. User confirms ticket intent
4. API creates payment intent with ticket product type
5. Wallet approves noncustodial split transaction
6. Helius/RPC payment evidence reaches backend
7. Backend verifies signature, reference, payer, amount, recipient, finality, splits
8. Backend grants ticket entitlement idempotently
9. Backend creates QR/receipt record
10. Frontend refreshes My Tickets from backend state
```

## Ticketing Provider Decision

Launch default:

- backend-owned event/ticket inventory
- backend-owned ticket entitlement and QR/receipt
- noncustodial Solana Pay payment settlement
- backend check-in state and audit log
- creator-owned ticket price within admin/env minimums and policy limits

This is the fastest secure path for Veel because it supports public tickets, private request-to-join events, refunds/revocation policy, admin check-in, and referral/split settlement without premature custom smart contracts.

Do not build a custom Solana ticketing protocol for launch.

Evaluate later only if the business needs:

- transferable tickets
- collectible NFT tickets
- resale/secondary-market rules
- token-gated external venue integrations
- partner ticketing integrations

Candidates for a later ADR include Crossmint/NFT APIs or a dedicated Solana ticketing provider, but only after proving QR entitlements are insufficient.

## Production Ticketing Details

Launch ticketing must support:

- ticket types with label, price, currency, capacity, and sale window
- all-in price display before wallet confirmation
- inventory reservation with short expiry during payment intent
- per-user ticket limits
- cancellation and refund policy shown before purchase
- request-to-join approval/rejection state for private events
- QR token rotation or reissue after support/admin action
- check-in staff role and admin audit log
- offline-friendly check-in fallback where venue connectivity is weak
- duplicate/replay-safe payment and check-in handling
- digital event access mapping to live-room entitlement
- physical event check-in separate from payment settlement

Anti-scalping launch rule:

- no transferable/resale tickets at launch
- no NFT ticket transfer at launch
- every transfer/resale feature requires a dedicated ADR, legal review, fraud controls, and user support plan

## Free Or Request-To-Join Flow

```text
Free ticket:
  user requests ticket
  API checks inventory/policy
  API grants ticket entitlement and audit record

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
- maximum ticket capacity
- ticket sale window
- private request-to-join approval window
- cancellation/refund cutoff
- check-in grace period
- per-user ticket limits

Environment values provide safe defaults. Admin policy can override them for business operations without a deploy, and every override is audited.

## Location UX

Launch location flow:

1. Creator chooses `digital_live_stream` or `physical`.
2. Digital live stream events attach to a live-room/ticket flow and do not require a street location.
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
  left / button = interested or open ticket sheet
  right / button = not interested
  final ticket purchase = explicit confirm button only
```

## Provider Dependencies

- Solana Pay / Solana RPC for wallet-approved paid tickets.
- Helius scoped to confirmed ticket payment evidence.
- Embedded wallet/onramp providers for conversion support.
- Email/push provider for optional receipt reminders.
- No provider grants ticket access directly.

Evaluate later:

- Crossmint compressed NFT/SFT minting for collectible or transferable event tickets
- Unlock Protocol for membership-like event access if EVM/membership strategy becomes relevant
- dedicated Solana ticketing vendors only after production API/security/vendor due diligence

Do not make NFT ticketing launch-critical. QR ticket entitlement plus noncustodial Solana settlement is enough for the first production version.

## Admin/Ops Requirements

Admin can inspect:

- event state
- ticket inventory
- payment intent
- transaction/signature
- ticket entitlement
- QR/check-in state
- refund/revocation decision
- audit log

Admin mutations require role policy, confirmation, and audit event.

## Tests

- creator creates event draft
- event publish validates capacity/date/price
- free ticket grants entitlement idempotently
- paid ticket grants entitlement only after backend verification
- duplicate payment event does not duplicate ticket
- sold-out inventory blocks new tickets
- tickets with processed refund/dispute records normally revoke the ticket entitlement
- revoked ticket cannot check in
- QR check-in is idempotent
- frontend never sees raw payment/provider secrets
