# Veel V2 Liability, Compliance, And Monetisation Audit

Status: accepted
Scope: seller/agent posture, liability boundaries, compliance gaps, monetisation guardrails
Last updated: 2026-06-06
Source of truth: yes

Owns:
- cross-document audit conclusions for seller/agent posture, noncustodial money, product monetisation, compliance data, and liability-reducing product rules

Defers to:
- `business-monetisation.md`, `payments-and-monetisation.md`, `noncustodial-money-compliance.md`, `compliance/dac7-dac8-vat-system.md`, OpenAPI, schema blueprint, provider ADRs, official provider docs, and counsel/tax review where narrower

Does not own:
- legal advice, tax advice, provider account approval, final terms of service, or production launch approval

Launch scope:
- mandatory pre-implementation checklist for every money, access, social, admin, notification, and compliance slice

Non-goals:
- duplicate payment systems, custody, marketplace-operator positioning, hidden business rules, legacy terminology, or provider API invention

## Core Position

Veel is designed as a software, access-control, discovery, communication, membership, Event Access, and creator infrastructure platform. Where legally supportable, the creator or event owner is the seller of creator products and Veel provides software infrastructure, backend verification, entitlement control, compliance records, and platform services.

Veel must not describe or implement itself as a bank, payment institution, money transmitter, custodian, exchange, broker, escrow agent, payout operator, or holder of creator balances.

## Hard Social-Money Rule

```text
Money can buy access to content, events, memberships, and live streams.
Money can never buy access to people, visibility, matches, recommendations, or preferential social treatment.
```

Implementation consequences:

- Paid content, support, memberships, live passes, Event Access Passes, and platform plans may grant access entitlements or software/tooling benefits only.
- Money must not boost feed ranking, creator recommendations, Mutuals visibility, Mutual creation, profile distribution, message priority, support priority outside admin-defined support SLAs, or social reputation.
- Paid-message products can sell creator-priced message delivery/opening only; they must not guarantee a reply, relationship, Mutual, preferential treatment, or higher social ranking.
- Platform tiers can grant software features, analytics, organization tooling, fair-use allowances, and support workflows, but never pay-to-win social treatment.
- Referrals can reward eligible attribution from Veel platform commission only; they must not change recommendations, social graph, Mutuals, or creator/user rank.

## Gap Analysis

| Area | Current state | Production gap |
| --- | --- | --- |
| Seller/agent model | Docs and schema support creator seller-of-record determinations and direct settlement. | Final terms, checkout copy, refund policy, and jurisdiction review must be reconciled before launch. |
| Noncustodial payments | Payment intent, direct settlement model, compliance ledger, receipts, and admin read models exist. | Production provider evidence, SPL/USDC support, launch-approved Solana indexer, and counsel-reviewed refund/dispute copy remain. |
| Memberships | Delegated Solana subscription foundation exists with cancel/revoke state. | Launch needs official delegated subscription staging evidence, recurring collection worker, grace/expiry operations, and wallet UX. |
| Live Passes | Live room, pass intent, chat, replay, and Livepeer boundary exist. | Provider launch approval, production stream access signing, and admin/event ops workflows remain. |
| Event Access | Event/pass/check-in foundation exists. | Launch copy must avoid ticket-marketplace positioning; refund/transfer/resale remain out of launch unless separately approved. |
| Refunds/disputes | Data model allows audit/revocation/compensating transactions. | Creator-decision workflow, support/admin states, and jurisdiction-specific consumer disclosures remain. |
| Compliance ledger | DAC7/DAC8/CARF/VAT docs and admin read routes exist. | Export/filing workflows, USD snapshot provider, seller onboarding collection, and counsel/tax review remain. |
| Creator verification | Age/profile/wallet foundations exist. | Single "Become Creator" onboarding flow, identity/KYB provider approval, tax profile collection, and conversion-friendly UX remain. |
| Mutuals/Connections | Compatibility backend route family and frontend projections exist. | Rename/migration from dating tables/routes, conduct UX, and hard social-money rule tests remain. |
| Tiers | Free Verified, Veel Plus, Veel Studio, Enterprise are documented; organization member dashboards now expose software governance/readiness only. | Feature gates, admin overrides, and non-pay-to-win policy tests remain. |
| Notifications | OpenAPI routes, RLS-backed notification/preference/device tables, Fastify account routes, backend tests, and settings preference reads exist. | Worker dispatch, service-worker subscription UX, actual push delivery, Realtime subscription wiring, and notification admin visibility remain. |
| User/creator/studio/enterprise dashboards | User activity, creator monetisation dashboard, member-scoped Studio/Enterprise dashboards, and admin ops read-only panels exist. | Full admin route-map breadth, organization mutation workflows, and support/KYB workflow depth remain. |

## Risk Matrix

| Risk | Severity | Mitigation |
| --- | --- | --- |
| Veel appears to be seller/merchant of record for creator products | High | Use creator-as-seller copy, seller-of-record determinations, direct settlement, creator refund policy, and compliance ledger evidence. |
| Custody or payout-operator characteristics | High | Ban balances, credits, escrow, withdrawals, payout queues, and Veel-held creator funds in docs, schema, API, and UX. |
| Crypto/direct settlement assumed to remove VAT/tax duties | High | Store jurisdiction-agnostic tax/compliance data, DAC7/CARF/VAT readiness records, and avoid legal conclusions. |
| Money influences social access or ranking | High | Enforce the hard social-money rule in docs, tests, recommendation logic, Mutuals, platform tiers, and admin policy. |
| Provider production path ships while ADR state is candidate | High | Keep provider-dependent paths gated until exact use case is staging-approved or launch-approved. |
| Notifications create misleading business truth | Medium | Notifications are projections only; they must never grant access, confirm payment, or override backend state. |
| Admin dashboards expose sensitive payloads | Medium | Return sanitized projections only; keep raw provider payloads, identity data, keys, and service-role credentials server-only. |

## Documentation Corrections

- Use "Membership" for creator-owned recurring access in user-facing copy; retain `subscription` only where legacy contract compatibility requires it.
- Use "Event Access Pass" and "Access Pass"; avoid "ticket marketplace" for launch.
- Use "confirmed earnings/revenue records"; never "creator balance", "pending payout", or "withdrawal".
- Use "wallet funding" for onramp sessions; never product checkout or payment proof.
- Keep "Mutuals" and "Connections" independent from monetisation; avoid "pay-to-match", "boost", "priority interest", or "dating marketplace".
- Keep "platform plans" separate from creator Memberships and avoid implying platform plans unlock creator premium content unless a specific bundled product is approved.

## Architecture Corrections

- New money, access, Mutuals, recommendations, messaging, notification, admin, and AI slices must declare whether they touch the hard social-money rule.
- Every monetised product must resolve price, recipients, fees, entitlement, tax/compliance metadata, and audit state server-side.
- Notification events must be backend-derived from existing business state; browser push is delivery only.
- Studio and Enterprise dashboards must be organization-scoped software/admin surfaces, not financial custody or payout surfaces.
- Refund workflows must be modeled as request, creator/admin review, optional creator-initiated refund transaction, entitlement revocation/replacement where policy allows, and audit evidence.

## Compliance Improvements

- Store compliance facts required for reporting readiness: transaction signature/reference, product type, timestamp, gross amount, creator amount, platform fee, token/mint, fiat snapshot, buyer/seller jurisdiction hints, sender wallet, recipient wallet, verification state, seller-of-record determination, receipt/invoice identifiers, and immutable audit linkage.
- Do not state that crypto, direct settlement, or noncustodial architecture eliminates VAT, platform reporting, consumer protection, age/KYC, sanctions, or recordkeeping duties.
- Treat DAC7, CARF/DAC8, and VAT/MWST as data/readiness systems until counsel/tax review approves filing/export behavior.

## UX Improvements

- Creator onboarding should present one "Become Creator" flow that internally checks email/session, wallet, age, identity/KYB where required, tax profile, and payout recipient readiness.
- Settings must read real notification preferences from the API; mutation controls and browser push enrollment must remain server-owned and provider-gated.
- Activity must show backend-derived receipts, passes, wallet transaction references, Membership state, safety actions, and relevant account issues.
- Admin must show system health, provider health, money/access state, compliance readiness, notifications delivery health, and organization/studio governance without exposing secrets or raw provider payloads.

## Provider Optimization Recommendations

- Prefer official provider capabilities before custom infrastructure: Supabase Auth/Postgres/RLS/Realtime, Bunny Stream/CDN/Shield, Livepeer live/replay, Solana Pay/transaction requests, official Solana delegated subscription tooling, embedded-wallet provider SDKs, and official age/KYC provider APIs.
- Every provider-dependent production path must cite latest official docs in the relevant ADR/provider doc and be at least `staging-approved` for the exact use case before launch.
- Provider callbacks must be idempotent, authenticated, logged with redaction, and converted into sanitized internal events before frontend/admin display.

## Final Source-Of-Truth Structure

| Topic | Source of truth |
| --- | --- |
| Cross-cutting liability/compliance audit | This document |
| Money model and product monetisation | `business-monetisation.md` |
| Payment mechanics and settlement verification | `payments-and-monetisation.md` |
| Custody boundary | `noncustodial-money-compliance.md` |
| Tax/DAC7/CARF/VAT readiness | `compliance/dac7-dac8-vat-system.md` |
| Mutuals/Connections | `product/mutuals.md` |
| Event Access | `product/event-access.md` |
| Notifications/activity/messages | `realtime-messages-activity.md` |
| Admin/ops | `admin-operations-dashboard.md` |
| Contracts | `packages/contracts/openapi.yaml` |
| Database | `packages/database/schema-blueprint.sql` and migrations |

## Implementation Priority Order

1. Keep hard social-money rule in contracts, docs, tests, ranking, Mutuals, platform tier gates, and admin policy.
2. Complete notification delivery: worker/event dispatch, service-worker subscription UX, Realtime account wiring, and admin delivery-health visibility.
3. Complete single creator onboarding/readiness flow and creator/studio dashboard expansion.
4. Complete Studio/Enterprise organization dashboards and RBAC policy surfaces.
5. Complete refund/dispute request workflow without custody or platform payout obligations.
6. Complete provider launch approvals and staging fixtures for Solana settlement, delegated Membership renewals, Bunny, Livepeer, age/KYC, and embedded wallets.
7. Complete compliance export/readiness workflows only after counsel/tax review.
