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

## Source-Of-Truth Ownership Rule

```text
The blockchain is the source of payment truth.
The entitlement system is the source of access truth.
The compliance ledger is the source of reporting truth.
The accounting integration is the source of bookkeeping truth.
The platform must never create a second competing source of truth for the same responsibility.
```

Veel records evidence, state transitions, reporting facts, exports, and accounting handoff status. It must not treat wallet approval, redirect state, frontend cache, notification delivery, dashboard aggregates, or support notes as a competing source of payment, access, reporting, or bookkeeping truth.

## Gap Analysis

| Area | Current state | Production gap |
| --- | --- | --- |
| Seller/agent model | Docs and schema support creator seller-of-record determinations and direct settlement. | Final terms, checkout copy, refund policy, and jurisdiction review must be reconciled before launch. |
| Noncustodial payments | Payment intent, direct settlement model, compliance ledger, receipts, and admin read models exist. | Production provider evidence, SPL/USDC support, launch-approved Solana indexer, and counsel-reviewed refund/dispute copy remain. |
| Memberships | Delegated Solana subscription foundation exists with cancel/revoke state. | Launch needs official delegated subscription staging evidence, recurring collection worker, grace/expiry operations, and wallet UX. |
| Live Passes | Live room, pass intent, chat, replay, and Livepeer boundary exist. | Provider launch approval, production stream access signing, and admin/event ops workflows remain. |
| Event Access | Event/pass/check-in foundation, read-only admin Event Access ops projections, and audited provider-event replay enqueue/worker boundary exist. | Launch copy must avoid ticket-marketplace positioning; admin Event Access mutations, provider-specific replay adapters, refund/transfer/resale remain out of launch unless separately approved. |
| Refunds/disputes | User request routes, admin review routes, RLS-backed request table, sanitized projections, idempotency-required mutations, and audit events exist. | Creator-initiated noncustodial refund transaction evidence, policy-approved entitlement revocation/replacement execution, provider/counsel-reviewed copy, and jurisdiction-specific consumer disclosures remain. |
| Compliance ledger | DAC7/VAT docs and admin read routes exist; DAC8/CARF report reads are backend-gated by the paused `compliance.carf_exports` feature flag until explicitly enabled. | Export/filing workflows, USD snapshot provider, seller onboarding collection, and counsel/tax review remain. |
| Creator verification | Age/profile/wallet foundations and the backend-owned Become Creator readiness checklist exist. | Identity/KYB provider approval, tax profile collection, and deeper conversion/support UX remain. |
| Mutuals/Connections | Canonical Mutuals API routes such as `GET /v1/mutuals/feed` and `GET /v1/mutuals`, deprecated compatibility routes such as `GET /v1/dating/feed` and `GET /v1/dating/matches`, and frontend projections exist. | Migration from dating-named compatibility tables/types, conduct UX, and hard social-money rule tests remain. |
| Tiers | Free Verified, Veel Plus, Veel Studio, Enterprise are documented; organization member dashboards now expose software governance/readiness only. | Feature gates, admin overrides, and non-pay-to-win policy tests remain. |
| Notifications | OpenAPI routes, RLS-backed notification/preference/device/delivery-attempt tables, Fastify account routes, worker delivery queue boundary, server-only VAPID Web Push send-provider boundary, browser service-worker enrollment UI, Supabase Realtime projection publication/cache invalidation boundary, backend tests, settings preference reads, and admin health visibility exist. | Real VAPID secrets, staging push-service verification across target browsers, and live Supabase Realtime staging verification remain. |
| User/creator/studio/enterprise/admin dashboards | User activity, creator onboarding/readiness, creator monetisation dashboard, member-scoped Studio/Enterprise dashboards with backend-derived RBAC permission rows, admin user/content/report moderation queues, admin organization KYB mutation, audited admin organization member role/state mutation, audited support case/support policy surfaces, refund/dispute review, privacy data request lifecycle, feature flag policy controls, sanitized audit-log reads, and admin ops panels exist. | Remaining admin route-map breadth, feature-gate enforcement depth, and deeper provider-backed KYB workflow depth remain. |

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
- Refund workflows are modeled as request, creator/admin review, optional creator-initiated refund transaction, entitlement revocation/replacement where policy allows, and audit evidence. The current implementation covers request/review/audit state only; it must not be used as payment truth, access truth, reporting truth, or bookkeeping truth.
- Data request workflows are privacy lifecycle records only; export/deletion execution requires separate policy-approved workers and identity-minimized projections.
- Feature flags are audited software policy controls only; they cannot override payment truth, entitlement access truth, compliance reporting truth, accounting bookkeeping truth, or the hard social-money rule.

## Compliance Improvements

- Store compliance facts required for reporting readiness: transaction signature/reference, product type, timestamp, gross amount, creator amount, platform fee, token/mint, fiat snapshot, buyer/seller jurisdiction hints, sender wallet, recipient wallet, verification state, seller-of-record determination, receipt/invoice identifiers, and immutable audit linkage.
- Do not state that crypto, direct settlement, or noncustodial architecture eliminates VAT, platform reporting, consumer protection, age/KYC, sanctions, or recordkeeping duties.
- Treat DAC7, CARF/DAC8, and VAT/MWST as data/readiness systems until counsel/tax review approves filing/export behavior.

## UX Improvements

- Creator onboarding should present one "Become Creator" flow that internally checks email/session, wallet, age, identity/KYB where required, tax profile, and payout recipient readiness.
- Settings must read real notification preferences from the API; mutation controls and browser push enrollment must remain server-owned and provider-gated.
- Activity must show backend-derived receipts, passes, wallet transaction references, Membership state, safety actions, and relevant account issues.
- Admin must show system health, provider health, money/access state, compliance readiness, notifications delivery health, and organization/studio governance without exposing secrets or raw provider payloads.
- Admin audit-log reads must expose only sanitized event identity, subject type, action, and timestamp. Audit metadata stays backend-only unless a resource-specific redacted contract is explicitly approved.
- Admin moderation reads must stay sanitized and admin moderation/report mutations must be audited state transitions only; they must not create payment truth, entitlement truth, reporting truth, bookkeeping truth, social rank, Mutuals treatment, or paid visibility.
- Event Access admin reads may inspect event/pass/check-in state, but admin event/pass mutations require dedicated audited worker-backed policy slices. Provider-event replay requests may be enqueued through the audited worker boundary; provider-specific replay adapters must remain fail-closed until staging-approved.

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
2. Complete notification production rollout: real VAPID secrets, staging push-service verification across target browsers, and live Supabase Realtime staging verification with real RLS claims.
3. Complete single creator onboarding/readiness flow and creator/studio dashboard expansion.
4. Complete deeper provider-backed KYB surfaces and the remaining admin route-map breadth.
5. Complete refund/dispute execution follow-up only after policy approval: creator-initiated noncustodial refund transaction evidence, entitlement revocation/replacement controls, consumer disclosures, and compliance ledger correction events.
6. Complete provider launch approvals and staging fixtures for Solana settlement, delegated Membership renewals, Bunny, Livepeer, age/KYC, and embedded wallets.
7. Complete compliance export/readiness workflows only after counsel/tax review.
