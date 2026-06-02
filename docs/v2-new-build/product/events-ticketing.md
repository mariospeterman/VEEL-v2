# Veel V2 Events And Ticketing Architecture

Status: proposed v2 architecture
Scope: events, tickets, Solana payment, QR/check-in, admin ops
Last updated: 2026-06-03
Source of truth: yes for v2 Events and Ticketing

Events are content-attached conversion flows. They are not root navigation by default, and ticket purchase/join always requires explicit confirmation.

## Product Position

- Creator can attach an event to media.
- Event can be online or location-based.
- Event can be public sale, free, paid, or private request-to-join/apply.
- Paid tickets use noncustodial Solana-compatible payment intents.
- Backend creates ticket entitlement and QR/receipt only after verified payment or approval.
- Future NFT/token tickets are separate ADRs, not the launch default.

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
- ticket pricing
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
  ├─ location_type: online | physical
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
  └─ state: active | checked_in | refunded | revoked | expired
```

## Paid Ticket Flow

```text
1. User opens event ticket sheet
2. API returns event availability and backend-owned price
3. User confirms ticket intent
4. API creates payment intent with ticket product type
5. Wallet approves noncustodial split transaction
6. Helius/RPC payment evidence reaches backend
7. Backend verifies signature, reference, payer, amount, recipient, finality, splits
8. Backend grants ticket entitlement idempotently
9. Backend creates QR/receipt record
10. Frontend refreshes My Tickets from backend state
```

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

## Location UX

Launch location flow:

1. Creator chooses `online` or `physical`.
2. For physical events, UI offers:
   - use current location after browser permission
   - search street/place manually
   - edit display label before publishing
3. Backend stores normalized display label, coarse coordinates if needed for map display, and provider/place reference.
4. Exact user/device location is never shared unless the creator explicitly publishes it as the event location.

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

## Ticketing Provider Decision

Launch with backend ticket entitlements plus Solana Pay settlement:

- fastest path
- lowest provider dependency
- QR/check-in works without custom smart contracts
- platform commission works through split transaction
- supports free, paid, and approval/precheck events

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
- refunded/revoked ticket cannot check in
- QR check-in is idempotent
- frontend never sees raw payment/provider secrets
