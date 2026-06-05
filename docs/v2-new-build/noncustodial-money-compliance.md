# Veel V2 Noncustodial Money And Compliance Boundary

Status: accepted
Scope: custody boundary, subscriptions, wallet funding, compliance risk controls
Last updated: 2026-06-05
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
- Never grant access, renewal, tickets, paid-message delivery, commission, or revenue state from wallet UI success alone.
- Store only entitlements, purchases, receipts, chain transaction references, immutable ledger/audit projections, tax/compliance metadata where required, and provider reconciliation evidence.
- Creator-facing money screens must be labelled and implemented as confirmed earnings/revenue records, not withdrawable balances.

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

## AI And Agent Money Boundary

Veel may use agents to assist users, creators, and admins, but agents must not silently create financial or legal obligations.

Agent rules:

- No autonomous wallet signing, delegated allowance setup, renewal collection, refund, cancellation, Event Access issuance, paid-message send, or entitlement mutation.
- Any AI-suggested money action must require explicit user/admin confirmation and backend policy validation.
- AI tools receive redacted financial and identity data by default.
- All AI tool calls that inspect or propose money, age/KYC, moderation, or admin changes are audited.
