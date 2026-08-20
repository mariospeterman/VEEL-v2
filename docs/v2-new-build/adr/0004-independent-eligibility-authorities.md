# ADR 0004: Independent Eligibility Authorities

Status: accepted

Date: 2026-08-12

## Decision

Veel keeps three independent server-owned truths:

1. **Earning eligibility** decides whether a universal account may receive creator-side proceeds for a specific product. `private.resolve_recipient_monetisation_policy(...)` is the canonical deterministic KYC decision and `private.assert_recipient_monetisation_ready(...)` is the atomic payment gate that consumes it. `disabled` and `required` are explicit policy decisions. A required account override can tighten any mode, while global `required` cannot be weakened by an account exemption and global `disabled` cannot be tightened by ordinary risk inputs. `risk_based` requires KYC only when a configured product, normalized jurisdiction, or active normalized risk assessment reaches the configured threshold. Account overrides remain auditable. The payment gate also checks account, age, tax, product, and noncustodial recipient-wallet readiness.
2. **Adult/performer eligibility** decides whether adult/explicit media may be released. Adult-publisher eligibility belongs to the uploader. Every real performer has separate verification evidence and explicit consent bound to the exact content revision and allowed uses. A verification result never implies consent.
3. **Enterprise management relationship** decides whether an organization may manage a universal creator and receive an agreed share of creator-side proceeds. It requires an accepted, versioned agreement plus active Enterprise entitlement, verified KYB, and a verified organization settlement wallet. KYB or a tier alone never creates a relationship.

Verification evidence may be derived or reused when provider policy and assurance permit it. Reuse creates a purpose-specific normalized record with provenance; it never copies raw identity data and never grants another authority implicitly.

## Settlement Order

1. Compute the gross platform fee from total price.
2. Compute referral commission only from the gross platform fee.
3. Compute creator-side proceeds as total minus gross platform fee.
4. Compute Enterprise management share only from creator-side proceeds.
5. Pay creator net, Enterprise management share, platform fee net, and referral commission as separate direct recipients.

The payment intent snapshots all amounts and recipient wallets. When the Enterprise management amount is non-zero, it also snapshots the relationship ID, agreement ID, and organization ID. Historical intents never change when a relationship changes. No Veel balance, withdrawal, escrow, or payout queue is created.

## Required Invariants

- New payment writes accept `support`; `tip` is historical read compatibility only.
- Minimum support is 500,000 USDC atomic units (0.50 USDC).
- A creator has at most one active revenue-allocation management relationship.
- Relationship acceptance is serialized per creator and backed by a partial unique index.
- Every changed Enterprise agreement requires a new version and creator acceptance.
- Creator net remains positive; Enterprise management cannot take 100% of creator-side proceeds.
- A rounded zero-value Enterprise share creates no transfer, allocation record, or Enterprise recipient snapshot.
- Content/media changes supersede pending performer requests and revoke prior content-revision consent.
- Adult publishing, performer consent, creator KYC, organization KYB, and Enterprise entitlement are never aliases.
- Risk assessments store normalized reason codes, source, policy version, effective/expiry time, and assessor where applicable; raw provider identity payloads do not enter the policy table.
- Creator onboarding, verification capabilities, dashboard readiness, membership offers, and one-time payment intents consume the same recipient-policy resolver rather than recreating KYC rules.
- New payment intents and creator Membership offers snapshot the effective KYC requirement, mode, policy version, and reason. Each recurring collection re-evaluates the same policy; a newly required but unsatisfied creator KYC decision suspends collection before submission and records a redacted subscription event.
- Browser payloads cannot supply recipients, fee rates, shares, verification decisions, or relationship truth.

## Ownership And Change Rule

- Earning readiness: migration/function and monetisation repository.
- Performer verification/consent: media-safety and performer repositories.
- Enterprise relationships: managed-creator repository.
- Settlement composition: payment amount calculator and payment repository transaction.

Any semantic change must update the API contract, reversible migration, backend tests, frontend smoke/E2E where user-visible, and this ADR. Provider behavior changes also require official provider documentation review. CI must retain explicit tests that the three authorities are independent.

## Consequences

The UX may present one smooth journey and reuse evidence, but the database and API preserve purpose-specific decisions. This prevents accidental privilege escalation, stale consent, retroactive split changes, and duplicate financial truth.
