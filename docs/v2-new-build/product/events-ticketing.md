# Veel V2 Events And Ticketing Architecture

Status: proposed v2 architecture
Scope: events, tickets, Solana payment, QR/check-in, admin ops
Last updated: 2026-06-02
Source of truth: yes for v2 Events and Ticketing

Events are content-attached conversion flows. They are not root navigation by default, and ticket purchase/join always requires explicit confirmation.

## Product Position

- Creator can attach an event to media.
- Event can be online or location-based.
- Event can be free, request-to-join, or paid.
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
  ├─ capacity
  ├─ price
  ├─ currency
  ├─ access_rule
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
