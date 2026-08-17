# WeVid V2 Business And Monetisation Architecture

Status: accepted
Scope: business model, monetisation, noncustodial money movement
Last updated: 2026-08-15
Source of truth: yes

Owns:
- business monetisation decisions for its named domain

Defers to:
- INDEX.md, route-map.md, OpenAPI, schema blueprint, and ADRs where narrower

Does not own:
- unrelated domains, implementation shortcuts, provider secrets, or hidden source-of-truth rules

Launch scope:
- accepted v2 launch or phased behavior stated in this document

Non-goals:
- historical-context inference, duplicate systems, and unapproved provider/product expansion

This document defines the full Veel v2 monetisation and business model. It extends `payments-and-monetisation.md`, which owns payment verification mechanics, `noncustodial-money-compliance.md`, which owns the custody boundary, and `compliance/dac7-dac8-vat-system.md`, which owns DAC7/DAC8/VAT readiness. The rule is unchanged: the frontend can display and request actions, creators choose prices where product policy allows, and the backend enforces admin/env pricing guardrails, splits, settlement, compliance ledger writes, receipts, entitlements, commissions, memberships, refunds, audit records, and operational reporting.

## Hard Social-Money Rule

```text
Money can buy access to content, events, memberships, and live streams.
Money can never buy access to people, visibility, matches, recommendations, or preferential social treatment.
```

This is a hard architectural rule. It applies to Mutuals/Connections, creator monetisation, platform tiers, referrals, notifications, ranking, messaging, AI tools, and admin policy. Any slice that touches money, recommendations, Mutuals, profiles, messaging, notifications, or platform tiers must preserve this rule in contracts, backend policy, tests, and user-facing copy.

## Source-Of-Truth Ownership Rule

```text
The blockchain is the source of payment truth.
The entitlement system is the source of access truth.
The compliance ledger is the source of reporting truth.
The accounting integration is the source of bookkeeping truth.
The platform must never create a second competing source of truth for the same responsibility.
```

Operational tables, caches, notifications, admin projections, receipts, exports, and dashboard aggregates must derive from those systems of record. They can improve supportability and UX, but they must not override settlement evidence, entitlement state, compliance-ledger entries, or accounting-system books.

## Business Model Summary

Veel earns through:

- platform fee on content unlocks, paid messages, paid live events, Event Access Passes, and support
- Profile Membership platform fee
- platform plans: Free, Plus, Ultra, Studio, and Enterprise
- optional referral commission sourced only from Veel platform commission net of refunds and tax
- optional wallet-funding referral revenue only if legal/provider review approves it and it is never product checkout revenue

Creators earn through:

- paid clips, premium posts, VOD, and replay content unlocks
- support
- paid messages
- Profile Memberships
- paid live events
- Event Access Passes
- referral earnings where product rules allow creator-as-referrer flows

## Noncustodial Split Transfer Model

Veel should prefer noncustodial wallet-approved split transfers wherever product and provider constraints allow.

```mermaid
flowchart LR
  User["User wallet"] --> Tx["Wallet-approved Solana transaction"]
  Tx --> Creator["Creator recipient wallet"]
  Tx --> Platform["Platform treasury wallet"]
  Tx --> Referral["Optional referral wallet"]
  Tx --> Chain["Confirmed chain record"]
  Chain --> API["Backend settlement verification"]
  API --> Ledger["Compliance ledger + receipt"]
  API --> Entitlement["Unlock/membership/pass if applicable"]
```

Backend responsibilities:

- select product type, validated creator price, asset, recipient wallets, split recipients, reference, memo, expiry, and entitlement target
- compose or serve the Solana Pay transaction request
- verify confirmed chain facts before final settlement
- write immutable settlement, compliance ledger, receipt/invoice, split, and audit records
- derive creator earnings, platform revenue, referral commission, and user activity from confirmed settlement

Frontend responsibilities:

- show backend-derived price and recipient summary
- request payment intent and transaction request
- open wallet approval
- show submitted/pending/final states from backend
- never calculate final fee, referral amount, entitlement, or creator earning truth

The direct split model means creator/platform/referral financial records are confirmed settlement projections, not custodial wallet balances held by Veel.

Embedded wallets do not change this model. They reduce onboarding friction by giving mainstream users a user-controlled wallet after social/email/passkey signup, but payment still happens through wallet-approved transactions and backend-verified settlement.

Hard custody rules:

- never route product funds as `user wallet -> Veel wallet -> creator wallet`
- never store credits, internal balances, creator balances, pending payouts, or withdrawal requests
- never implement creator withdrawals or a platform-controlled payout queue; creator recipients receive directly from the buyer transaction where a creator share exists
- never treat funding/onramp completion as product payment proof
- keep records as receipts, invoices/statements, entitlements, confirmed earnings/revenue projections, tax/compliance metadata, and immutable audit evidence

## Creator Pricing With Admin Guardrails

Creators own monetisation pricing for creator products:

- content unlocks
- paid messages
- support presets where creator offers presets
- one paid-event price and replay window for a paid live room
- Event Access Passes
- Profile Memberships

Admin/env owns guardrails:

- minimum price per product type
- maximum price per product type where required for abuse/compliance
- allowed assets/currencies
- platform fee bps
- referral share bps and eligibility
- paid-live-event minimums and replay-window limits
- event capacity/date limits
- refund/revocation policy

Environment variables provide safe launch defaults. Admin configuration can override env defaults and every override is audited. The frontend never calculates final splits or final payable price.

Implemented one-time payment policy stores one constrained override per product and asset. The effective policy is resolved inside the same PostgreSQL transaction that creates the intent and its exact floor, fee rates, source, revision, quote time, and expiry are snapshotted onto that intent. Admin changes affect only future quotes; they never rewrite an existing intent or settled payment. Exact admin retries return the original revision and changed-input key reuse conflicts.

Examples:

- Admin sets minimum paid message price to `0.01 SOL` or USDC equivalent.
- Creator sets a paid message price above that minimum.
- Admin sets the paid-live-event minimum and replay-window limits.
- Creator sets one event price and a disclosed replay window within those guardrails.
- Admin sets minimum Event Access price; creator sets actual pass price and capacity within policy.

## Money Movement Modes

| Mode | Use | Access effect | Required confirmation |
| --- | --- | --- | --- |
| Native SOL split transfer | Devnet testing, low-friction support/tips, possible SOL products | Optional depending product | Signature, reference, payer, lamports, recipients, finality |
| SPL/USDC split transfer | Production stablecoin products if selected | Optional depending product | Signature, reference, payer, mint, token program, token amounts, recipients, finality |
| Solana delegated subscription | Profile Memberships and platform recurring plans | Membership/platform entitlement only after verified authorization and recurring collection | Authority PDA, subscription/delegation PDA, payer token account, mint/program, recipients, amount/period, collection signature, finality |
| Manual Solana Pay recovery | Emergency fallback for failed delegated setup/collection only | Renewal entitlement only after confirmed payment intent | Signature, reference, payer, amount, recipients, finality |
| Wallet funding/onramp | User adds SOL/USDC to their own wallet | No access effect | Funding status only for UX/support |
| Free approval | Free Event Access/Passes | Entitlement only | Backend approval/audit, no wallet settlement |

Onramp sessions are funding flows, not payment settlement flows. A card/onramp provider may help the user add SOL/USDC to their wallet, but Veel product purchases still require the normal payment intent, transaction request or subscription collection, and backend confirmation path. Veel must not use an onramp provider as merchant checkout for content, messages, Event Access, support, or memberships.

Implemented wallet funding boundary:

- `POST /v1/wallets/onramp-sessions` creates a provider funding session only for a wallet owned by the authenticated user.
- The provider launch URL may be returned to the user, but no access, entitlement, paid-message delivery, ticket, subscription, commission, or revenue state changes from that response.
- Coinbase CDP is the current provider boundary when configured. It is used only for destination-wallet funding; Solana Pay/payment-intent settlement remains the product payment path.

Native SOL and SPL token modes must share a common intent/split/settlement model. Do not create separate payment systems.

## Product Catalogue

| Product | Buyer pays | Creator earns | Platform earns | Entitlement |
| --- | --- | --- | --- | --- |
| Content unlock | One-time price | Creator share | Platform fee | Content access grant |
| Support | Preset/custom amount or campaign amount | Creator share | Platform fee | No access grant unless explicitly attached |
| Paid message | Message price | Creator share | Platform fee | Message delivery/open entitlement |
| Profile Membership | Recurring plan price | Creator share | Platform fee | Creator-specific access plan |
| Plus | 8.99 USDC/month | No creator share unless bundled | Platform revenue | Regular-user platform entitlement |
| Ultra | 17.99 USDC/month | No creator share unless bundled | Platform revenue | High-usage viewing entitlement |
| Studio | 29 USDC/month | No creator share unless bundled | Platform revenue | Creator business/tool entitlement |
| Enterprise | Custom, from 199 USDC/month equivalent | No creator share unless contracted | Platform revenue | Organization/agency/venue entitlement |
| Live pass | Duration/pass price | Creator share | Platform fee | Live playback/chat access |
| Event Access Pass | Pass price | Creator/event owner share | Platform fee | Access entitlement/QR |
| Referral commission | From Veel platform commission net of refunds/tax | Referrer/partner earns | Platform share reduced | Attribution/commission record |

Launch product type enum:

```text
support
content_unlock
paid_message
live_pass
event_access_pass
creator_subscription
platform_subscription
```

`tip` is a legacy-read settlement value only. New contracts, intents, UI copy, and provider requests use `support`; do not create a second tip flow.

Future products such as physical product orders, drops, resale, NFT pass/ticketing, bundles, gifts, or premium-room variants require their owning post-core decision and must not appear in launch contracts or schema until approved. The physical-commerce slice may add a product-specific payment type such as `physical_product_order`; it is not part of the launch enum above.

Target product language for new docs/UI:

```text
support
unlock
paid_message
live_pass
event_access_pass
membership
platform_plus
platform_studio
enterprise
platform_fee
referral_commission
```

OpenAPI and new payment intents use `event_access_pass` for Event Access. Deprecated `event_ticket` database rows are normalized by the `0050_event_access_payment_product_type` migration and remain readable only as a legacy settlement compatibility value. Frontend copy must use the target product language.

## Default Split Policy

Default launch recommendation:

- platform fee: `1000 bps` on eligible paid products
- creator share: gross price minus platform fee and configured taxes/fees where applicable
- referral share: paid only from Veel platform commission net of refunds and tax
- creator share is never reduced by referral
- self-referral is always rejected
- duplicate commission is always rejected

Example for a 1.00 SOL content unlock with 10% platform fee and 20% referral share of platform fee:

```text
Gross:             1.000 SOL
Creator share:     0.900 SOL
Platform gross:    0.100 SOL
Referral share:    0.020 SOL
Platform net:      0.080 SOL
```

The backend stores the exact integer unit amounts used in the transaction request. Display decimals are presentation only.

## Platform Plans vs Profile Membership

Platform plans:

- belongs to Veel, not a specific creator
- can grant platform-level benefits such as membership badge, higher fair-use watch allowance, creator business tooling, organization tooling, or future app-level features
- must not unlock creator premium content unless a bundled product explicitly says so
- is managed by platform billing policy and admin operations
- must not grant paid access to people, visibility, matches, recommendations, message priority, social ranking, or preferential social treatment

Recommended platform tiers for first pricing tests are backend policy rows, not browser constants:

| Tier | Suggested price | Position |
| --- | --- | --- |
| Free | Free | Full social account, Bits, previews, SFW publishing, public live, purchases, support, and about 20 hours/month of free public long-form/live use. |
| Plus | 8.99 USDC/month | About 100 hours/month, collections, notification/privacy controls, and profile enhancements. No feed/Mutuals boost. |
| Ultra | 17.99 USDC/month | About 250 hours/month, highest available playback quality, and advanced playback convenience. No feed/Mutuals boost. |
| Studio | 29 USDC/month | Includes the Ultra allowance plus professional individual analytics, scheduling, pricing, live-conversion, and AI-assistance capabilities where enabled. Profile Membership eligibility is separate. |
| Enterprise | Custom, from 199 USDC/month equivalent | Organization, agency, venue, and partner tier with RBAC, consolidated reporting, business support, and contract review. KYB is required for organization use but never grants Enterprise without an active contract, subscription, or waiver. |

Only free public long-form VOD and public live viewing consumes the platform allowance. Bits, previews, individually unlocked content, joined-profile membership media, paid Event Access, the user's own media, and promotional excerpts never consume it. Reaching the allowance must not revoke purchased or membership access.

The canonical accounting path is server-owned:

1. The backend decides whether a requested content item or live room qualifies before it issues full playback.
2. The browser starts one idempotent playback session only after provider playback starts.
3. Visible, actively playing time is reported in ordered, idempotent heartbeats of at most 30 seconds.
4. PostgreSQL serializes the current usage window, caps credited time by server-observed elapsed time and remaining allowance, and records the session, heartbeat, and usage update atomically.
5. Exhaustion blocks only otherwise-free public VOD/live playback. Paid, membership, event, preview, Bits, promotional, and owner playback remain governed by their normal entitlement/access policies.

Bunny iframe state is observed through the official [Bunny Stream Player.js playback API](https://docs.bunny.net/stream/playback-api). Livepeer playback uses the official [`@livepeer/react` player](https://docs.livepeer.org/sdks/react/Player) and native media lifecycle events. Client events initiate usage reports but never own allowance truth.

Tier rules:

- platform plans must not hide core safety, basic publishing, Mutuals access, or creator discovery behind a paywall
- platform plans must not boost paid content ranking, Mutuals ranking, or message priority
- creator content purchases still happen separately unless a specific bundle is implemented and documented
- creator-facing productivity value should live in Studio, not in a viewer-only upsell
- Profile Membership creation is gated by earning/compliance readiness, not ownership of Studio
- organization KYB establishes business identity; Enterprise authority additionally requires an active Enterprise subscription, contract waiver, or equivalent backend-owned commercial entitlement
- Mutuals/Event Access/AI limits can be configured by admin, but the free tier must remain usable enough for real network effects

Pricing, allowance limits, Mutual/Event Access limits, paid-live-event guardrails, and platform feature gates must live in backend/admin configuration. Environment variables provide safe defaults; admin configuration can override them without a deploy.

Profile Membership:

- belongs to a profile and has one active offer per profile at launch
- grants creator-specific benefits such as subscriber-only media, premium posts, live access tiers, or message privileges
- has renewal state, grace period, cancellation, and failed-renewal recovery
- must be auditable per creator, subscriber, plan, billing event, entitlement, and settlement

Platform plans and Profile Memberships use the same recurring authorization/collection state machine but different entitlement scopes. Recurring sales remain disabled until the official Solana recurring-delegation path proves setup, collection, renewal, cancellation/revocation, failure, reconciliation, idempotency, and entitlement changes in staging; no custom subscription contract is permitted.

Recipient monetisation readiness has one backend authority. “Enable Earnings” is the contextual entry point from any product that needs a recipient; it resolves age, tax acceptance, configured recipient wallet, product enablement, and KYC mode (`disabled`, `risk-based`, or `required`) without creating a second creator account. SFW publishing does not require creator KYC. Adult publishing, performer evidence, KYC, and KYB remain separate purpose capabilities. Support starts at 0.50 USDC by default and may be offered as micro-Support on media, messages, live, or chat only where that product surface is explicitly enabled; it never buys attention or access to a person.

## Deferred Physical Commerce Boundary

Physical goods remain post-core. The locked direction is WeVid-native Product Offers plus deliberately small Orders/Fulfillment over the existing identity, profile, wallet, recipient-readiness, payment-intent, exact-split, settlement-verification, receipt, refund/dispute, notification, moderation, and audit authorities. No full commerce engine is part of the canonical dependency graph. This architecture lock does not add commerce routes, tables, SDKs, inventory, checkout, order, or fulfillment runtime to the current launch slice.

The initial physical-commerce scope is one seller and one product per checkout, optional quantity, simple variants only when necessary, seller-configured fixed shipping zones/rates, simple stock reservation, seller fulfillment, tracking, and the existing refund/dispute workflow. Cross-seller carts, promotions, warehouses, label generation, escrow, resale, and automatic platform-funded refunds are excluded. A future same-seller cart requires measured demand.

Physical purchase reuses the canonical `PaymentIntent` system but adds a product-specific type only when its slice is implemented. The backend reserves stock, creates the immutable order and shipping-price snapshot, then creates the intent. Confirmed settlement marks exactly one order paid; it does not create a digital entitlement. Duplicate settlement cannot create another order or reduce stock twice. Product price, shipping amount, seller wallet, platform/referral/managed-creator allocation, stock, and paid state are never browser-owned.

The minimum new domain concepts are Product Offer, content/profile/live attachment, shipping profile, Order, stock reservation, and Fulfillment. They must not duplicate user, profile, wallet, verification, payment, settlement, receipt, dispute, notification, or audit records. Shipping data is sensitive: collect only fulfillment fields, protect them through the approved encryption/key-version boundary, never log or place them on-chain or in Solana Pay data, expose them to the seller only after confirmed payment, audit staff access, and apply retention/deletion policy.

Commerce activation is independently policy-gated. Seller/trader identity, lawful seller disclosures, shipping/return policy, prohibited-product screening, product safety/traceability, recall handling, jurisdiction, tax readiness, and EU DSA/GPSR obligations require legal and operational approval. Noncustodial direct settlement does not remove marketplace responsibilities. Launch, when approved, begins with lawful low-risk creator merchandise.

Profile-native UX is canonical: content is the advertisement, the creator profile is the storefront, the wallet is the payment account, selected Commerce Kit primitives are invisible payment interoperability, and WeVid owns the social experience and business rules. A Product Offer may attach to a profile, Post, Bit, or live stream, with at most one explicit contextual `View product` or `Buy product` action. Products do not enter the five primary navigation items, open checkout automatically, alter feed ranking, or grant access to people.

## Subscription State Machine

```mermaid
stateDiagram-v2
  [*] --> none
  none --> intent_created
  intent_created --> active: confirmed first payment
  active --> renewal_pending
  renewal_pending --> active: confirmed renewal
  renewal_pending --> grace_period: renewal failed
  grace_period --> active: recovered
  grace_period --> cancelled: not recovered
  active --> cancelled: user/creator/platform cancellation
  active --> suspended: safety/payment/admin action
  suspended --> active: reinstated
  cancelled --> expired
```

Required records:

- subscription plan
- subscriber
- creator or platform owner
- current status
- renewal anchor
- Solana subscription authority, delegation/subscription PDA, token account, collection schedule, and collection signature references
- entitlement scope
- audit events for every transition

Recurring subscription policy:

- Target provider path is Solana Subscriptions and Allowances through the official Subscription Delegation Program.
- Subscription products are modeled as auto-renewing delegated subscriptions until the user cancels in Veel and/or revokes the delegation in wallet/provider UX.
- The delegated subscription production switch remains gated until devnet/staging authority setup, revoke, collection, wallet UX, event, and reconciliation fixtures pass.
- Manual Solana Pay renewal is recovery fallback only; do not use merchant checkout, card billing, custodial subscription balances, or provider-operated product subscriptions.
- Users must be able to cancel in Veel and revoke delegated allowance in wallet/provider UX.
- Backend subscription status mirrors verified payment/collection evidence and internal entitlement policy; it is not a stored debt or receivable.
- Renewal checkout and settings must disclose amount, period, token/mint, cancellation path, delegated authority, and that cancellation stops future collection rather than automatically refunding the current started period unless law or platform/provider failure requires it.
- EU/EEA platform subscription checkout must collect immediate digital service consent and withdrawal-loss acknowledgement before the first access period starts, then send durable confirmation with plan, wallet, authorization/delegation evidence, terms version, and cancellation path.

## Referral And Commission Lifecycle

```mermaid
stateDiagram-v2
  [*] --> none
  none --> link_created
  link_created --> clicked
  clicked --> attributed
  attributed --> paid_action_seen
  paid_action_seen --> eligible
  eligible --> pending
  pending --> paid: confirmed settlement
  pending --> rejected: invalid/self/duplicate/expired
  attributed --> expired
```

Rules:

- external referral links can create attribution
- internal Veel DM share does not create commission by default
- attribution can survive signup, login, wallet link, and payment
- commission links to referrer, referred user, content/product, payment intent, settlement signature, and product type
- replayed chain events cannot create duplicate commission
- client-supplied recipient or financial-truth payloads are rejected

## Creator Earnings, Tax Records, And Financial Risk

Even with direct split transfers, Veel still needs backend-derived earning records for:

- creator dashboard reporting
- tax/compliance exports where required
- KYC/KYB earning eligibility where required
- dispute/refund/revocation decisions
- admin and support investigation

Earning-record rules:

- KYC/KYB is required for creator earning features where required by legal/provider policy
- KYC/KYB should use reusable or low-cost provider paths before paid heavy documentary sessions
- age gate is separate from creator earning KYC/KYB
- creator earnings visible in dashboard must be based on confirmed settlement
- `creator_monetisation_settings` stores readiness/product configuration only; it does not create balances, custody, payout queues, escrow, or receivables
- Creator-recipient readiness and wallet selection are enforced atomically by `private.assert_recipient_monetisation_ready(...)`; product routes must not duplicate this policy or accept a browser-owned recipient. Creator KYC is required only when the effective earning policy requires it.
- Enterprise management allocation is a versioned, creator-accepted relationship. It is calculated from creator-side proceeds after the gross platform fee. Referral commission remains a separate allocation from the platform fee.
- Launch creator settlement is individual-only. Organization recipients fail closed until a separate KYB, beneficial-owner, tax, signing-authority, and organization-wallet policy ships; KYB or Enterprise entitlement alone never authorizes settlement.
- creator earnings are records and tax/compliance inputs, not a withdrawable Veel balance
- no pending payout or creator withdrawal queue exists in the launch model
- pending wallet submissions are not revenue
- failed, expired, rejected, or mismatched transactions are not revenue

## Refunds, Revocation, And Disputes

Launch policy can defer automated refunds, but the data model must support:

- refund request
- admin review
- revoked entitlement
- replacement entitlement
- creator content versioning after purchase
- dispute audit trail
- settlement reversal or compensating transaction if noncustodial refund is executed

Do not remove buyer access to already purchased content without a documented policy and audit reason.

Commercial default:

- Creator-sold products are final once immediate access is delivered, except mandatory legal rights, duplicate settlement, fraud/unauthorized access, misdescription, provider/platform failure, or seller non-delivery.
- Veel-sold platform plans are final once the current access period starts, except mandatory legal rights, duplicate collection, fraud/unauthorized access, platform failure, or failure to provide the software feature.
- Creator-sold refunds should be seller-funded noncustodial transactions. Veel must not promise to absorb creator refund exposure from platform treasury unless counsel approves a goodwill or platform-fault exception.
- Referral commissions come only from Veel platform commission net of refunds and tax; approved refunds/reversals must correct commission eligibility through backend records.
- If a creator-sold refund is approved, creator share refund responsibility remains with the seller where legally supportable. Veel only refunds/reverses its commission when required by law, policy, or Veel fault, and referral commissions must be clawed back or marked ineligible from backend records rather than by creating a negative user balance.
- Payment/refund review records must preserve `payment_confirmed`, `access_granted_at`, `withdrawal_waiver_accepted_at`, `withdrawal_waiver_version`, `terms_version`, `refund_eligible_reason`, `refund_status`, `refund_wallet`, and `refund_value_basis` either directly or through linked payment, entitlement, refund/dispute, receipt, and audit rows.
- Confirmed settlement must also preserve durable confirmation evidence through backend receipt, compliance-ledger, notification, and confirmation-delivery rows. In-app delivery may be marked sent when the backend notification exists; email delivery is leased by the worker and must stay queued/provider-not-configured/failed until a launch-approved transactional email provider confirms delivery.
- If transactional email is not enabled, the in-app confirmation remains the user-visible fallback and support evidence, but launch compliance should not rely on in-app-only waiver confirmation for EU/EEA distance-sale flows unless counsel approves that durable-medium interpretation for the exact user interface and retention model.

## Admin And Business Reporting Requirements

The admin dashboard must expose safe, role-gated views for:

- gross merchandise volume
- platform revenue
- creator earnings
- referral commission
- subscription MRR/ARR/churn
- content unlock conversion rate
- payment failure reasons
- webhook lag/failure rate
- top creators/products
- refunds/disputes/revocations
- KYC/KYB earning readiness
- Event Access Pass sales and check-ins

Financial dashboards must link to immutable settlement records and audit events, not frontend counters.

## Config Shape

Each monetised product should resolve through a backend config object:

```text
product_type
price_min_minor
price_max_minor
asset_mode: native_sol | spl_token | subscription_allowance | free
currency_symbol
mint_address
token_program
platform_fee_bps
creator_share_bps
referral_share_bps
max_referral_bps
recipient_policy
eligibility_rule
entitlement_scope
access_duration
renewal_rule
refund_rule
earning_compliance_requirement
audit_required
```

## Tests Required Before V2 Launch

- native SOL split payment
- SPL/USDC split payment
- wrong payer/amount/recipient/mint/program rejection
- duplicate signature rejection
- tip settlement without access grant
- content unlock settlement with access grant
- paid message settlement with message entitlement
- paid-live-event settlement with room and replay-window access
- Event Access Pass settlement with backend Access Pass entitlement
- creator subscription create/renew/cancel/fail/recover
- platform subscription create/renew/cancel/fail/recover
- referral attribution and commission
- self-referral rejection
- duplicate commission rejection
- refund/revocation audit state
