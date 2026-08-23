# Veel V2 Noncustodial Money And Compliance Boundary

Status: accepted
Scope: custody boundary, subscriptions, wallet funding, compliance risk controls
Last updated: 2026-06-12
Source of truth: yes

Owns:
- noncustodial money movement and compliance boundaries for monetised Veel flows

Defers to:
- OpenAPI, migrations, provider ADRs, tax/legal policy, and official provider docs where narrower

Does not own:
- tax advice, legal advice, provider terms acceptance, or production account approval

Launch scope:
- all paid products, subscriptions, creator earnings records, wallet funding, refunds, and AI/agent money tools

Non-goals:
- custody, escrow, internal credits, creator withdrawal systems, merchant checkout billing, or stored user balances

Veel reduces custody and payment-processor dependency by using user-approved Solana payments and direct recipient settlement. That does not remove adult-platform compliance, consumer-protection duties, tax recordkeeping, moderation duties, or platform liability. Product, backend, admin, and AI-agent features must assume regulators evaluate what Veel operates and benefits from, not only which wallet holds funds.

## Hard Custody Rules

- Never route product funds as `user wallet -> Veel wallet -> creator wallet`.
- Use direct settlement: `user wallet -> creator wallet` and `user wallet -> Veel fee wallet` in the same backend-composed transaction where a split is required.
- Never create `Veel Credits`, `Veel Balance`, `Creator Balance`, `Pending Payouts`, or withdrawal-request flows.
- Never grant access, renewal, tickets, creator-request activation, commission, or revenue state from wallet UI success alone.
- Store only entitlements, purchases, receipts, chain transaction references, immutable ledger/audit projections, tax/compliance metadata where required, and provider reconciliation evidence.
- Creator-facing money screens must be labelled and implemented as confirmed earnings/revenue records, not withdrawable balances.

## Hard Social-Money Rule

Money can buy access to content, events, memberships, and live streams. Money can never buy access to people, visibility, matches, recommendations, or preferential social treatment.

This rule reduces custody, consumer-protection, marketplace, and social-risk ambiguity. Paid products grant access entitlements or software tooling only. They must not create a claim to another person, a relationship, a response, a Mutual, a ranking position, a recommendation slot, or higher social priority.

## Subscriptions Boundary

Target native recurring billing is Solana Subscriptions and Allowances through the official Solana Subscription Delegation Program. Users delegate a bounded allowance or subscription authority from their own wallet, recurring collection runs until cancellation/revocation, and users must be able to revoke it.

Manual renewal through ordinary Solana Pay payment intents is only a recovery fallback for failed delegated setup or collection. The fallback is not merchant checkout, card billing, custodial billing, or any provider-operated product subscription.

Subscription implementation rules:

- Backend owns plan, entitlement, renewal, grace, cancellation, suspension, and audit state.
- On-chain delegated authority or confirmed renewal collection is evidence, not final business truth by itself.
- Backend verifies the subscription authority, token mint/program, allowance, period, payer, recipient splits, collection signature, and finality before changing access.
- Creator Memberships settle directly to creator and platform fee recipients.
- Platform plans settle directly to the platform fee wallet.
- Users can cancel in Veel and revoke delegated authority in wallet/provider UX.
- Failed or revoked renewals must move through grace/cancel/expire states without creating debt or internal receivables.
- Cancellation must be easy to find from the subscription surface, stop future collections, and keep cancellation/revocation audit state. It must not rely on hidden support contact, dark-pattern retention, or browser-only state.

## Wallet Funding And Onramp Boundary

Wallet funding is not product checkout. Any onramp or embedded-wallet funding UI may only help a user add SOL/USDC to the user-controlled wallet.

Funding-session rules:

- Funding completion does not unlock content, Event Access, passes, messages, memberships, platform plans, or commissions.
- Veel must not act as merchant of record for product purchases through a wallet funding provider.
- Browser code may receive only publishable funding config and provider session URLs.
- Provider callbacks may update funding status for UX/support only.
- Product purchase always returns to a backend-created payment intent or delegated collection path.

## Compliance Still Required

Noncustodial money movement does not remove launch obligations:

- age verification before protected app access
- creator verification and tax/compliance onboarding where required
- consent verification and illegal-content removal process
- moderation, reports, blocks, safety escalation, and law-enforcement workflow
- clear membership/platform plan cancellation, refund, dispute, and support policy
- immutable records for purchase receipts, refunds, revocations, commissions, tax exports, and admin actions
- region/product restrictions when legal, provider, or bank policy requires them

## Refund And Consumer-Remedy Boundary

Veel can make noncustodial crypto purchases commercially final after immediate access is delivered, but only as a default rule with explicit exceptions. A blanket "no refunds under any circumstances" policy is not launch-approved because consumer law, subscription rules, and platform-failure facts can still require a remedy.

Allowed launch copy and behavior:

- "Final sale after immediate access starts, except where required by law or where access was not delivered" is allowed after counsel review.
- "No refunds ever" is not allowed.
- Users must see seller/responsible-party identity, price, token/currency, renewal period if any, access start, cancellation path, and refund/dispute exception summary before signing.
- For EU/EEA users, the checkout must require explicit immediate-access consent and explicit acknowledgement that withdrawal rights are lost once access begins. The platform must retain versioned terms/waiver evidence and send durable confirmation, normally email/receipt.
- Direct crypto settlement is irreversible at the protocol layer; remedy workflows are support/legal workflows backed by audit, seller-funded refund evidence, replacement access, entitlement revocation where policy allows, or platform-funded remedy only when Veel is responsible.
- Refund/dispute records must be idempotent and audited. Retried requests must not create duplicate refund obligations.
- Refund/reversal decisions must not create balances, custody, receivables, debt collection, payout queues, escrow, or frontend-derived payment truth.
- Referral commissions and platform-fee reporting must be netted or corrected only from backend compliance/accounting records after approved refund/reversal evidence.
- Creator-sold product refunds should not create platform loss by default. Veel refunds platform commission only when policy/legal review requires it or Veel is responsible; creator share refunds are seller-funded noncustodial transactions where legally supportable.
- Switzerland is more provider-friendly for ordinary online withdrawal rights, but EU/EEA rules still matter for EU/EEA consumers. The launch default must therefore implement the stricter EU-style waiver/evidence path and allow country policy overrides only after counsel review.

## AI And Agent Money Boundary

Veel may use agents to assist users, creators, and admins, but agents must not silently create financial or legal obligations.

Agent rules:

- No autonomous wallet signing, delegated allowance setup, renewal collection, refund, cancellation, Event Access issuance, creator-request activation, or entitlement mutation.
- Any AI-suggested money action must require explicit user/admin confirmation and backend policy validation.
- AI tools receive redacted financial and identity data by default.
- All AI tool calls that inspect or propose money, age/KYC, moderation, or admin changes are audited.
