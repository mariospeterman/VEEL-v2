# Age Assurance, KYC, And Audience Geoblocking

Status: accepted
Scope: documentation
Last updated: 2026-06-03
Source of truth: yes

Owns:
- age kyc jurisdictions decisions for its named domain

Defers to:
- INDEX.md, route-map.md, OpenAPI, schema blueprint, and ADRs where narrower

Does not own:
- unrelated domains, implementation shortcuts, provider secrets, or hidden source-of-truth rules

Launch scope:
- accepted v2 launch or phased behavior stated in this document

Non-goals:
- historical-context inference, duplicate systems, and unapproved provider/product expansion

This document defines the recommended 2026 operating model for the greenfield v2 repo.

## Core separation

- age assurance answers: can this person access protected 18+ app surfaces?
- KYC or KYB answers: does this user need extra review for suspicious, regulated, tax, earning, or partner-required flows?
- creator audience geoblocking answers: does this creator want specific locations blocked from their own audience?

These are separate controls and should stay separate in data, policy, and UI.

## Recommended viewer flow

1. Let the user reach landing and teaser surfaces without heavy verification.
2. Create an app session through wallet auth or passkey auth.
3. Require third-party 18+ assurance before protected app access.
4. Present a simple provider-choice flow when multiple supported reusable proofs are available.
5. Fall back only when the preferred reusable proof is unavailable or inconclusive.
6. Trigger KYC or KYB later only for suspicious or operationally necessary cases.

## Best-practice age path

Keep the backend capable of this order:

1. portable over-18 credential
2. privacy-preserving age estimation with a safety buffer
3. database or non-doc verification where the provider supports it
4. document-based identity flow only when the risk or provider outcome requires it

This is the best-practice 2026 setup to keep:

- low churn because reusable proof stays first
- broad coverage because fallback methods exist when reusable proof is missing
- strong compliance posture because every protected-app path still resolves through a third-party age-assurance flow
- minimal retained data because the app stores only the result, not raw identity artifacts

Webhook rule:

- provider callbacks are accepted only through `POST /v1/webhooks/age/{provider}`
- provider signatures must verify before state changes
- provider retries must be idempotent
- the app stores normalized receipt/event/result state only, never raw document, biometric, or private provider-review payloads

## Product rule

Protected app access should be universal:

- all protected app entry requires third-party age assurance
- the product should not depend on coarse country-bucket segmentation for ordinary viewer access
- the onboarding surface should feel simple even though the backend keeps a layered fallback ladder

## Provider strategy

Support provider families, not one-off hard-coded vendors:

- `portable_credential`
  Examples: Didit reusable ID, EU age-verification app / future EUDI wallet, Yoti Digital ID, Scytales connector, and other reusable over-18 credentials as they become practical
- `age_estimation`
  Examples: Didit or Yoti facial age estimation
- `free_document`
  Examples: Persona or Didit starter/free-tier document checks for users who cannot present a reusable credential
- `database_non_doc`
  Examples: regional identity/eID-backed checks where supported
- `document_idv`
  Examples: Persona or Didit documentary flow for age assurance; Sumsub or Veriff only as creator/compliance escalation when required

Launch-default recommendation:

- primary onboarding path: reusable age credential first (`Didit`, `Yoti Digital ID`, `EUDI Wallet`, `Scytales`) where provider contracts and regional availability support it
- first fallback path: free/light age assurance (`Didit` age estimation or `Persona`/`Didit` document check) when reusable proof is not available
- do not show Sumsub or Veriff in ordinary viewer onboarding; keep them as Studio/enterprise compliance fallbacks after privacy/security/procurement review
- product rule: let the user choose a supported reusable provider when possible, then fall back within the same third-party flow when needed

Expanded provider recommendation:

- `Scytales`: good reusable-wallet verifier lane to support alongside `EUDI Wallet` and `Yoti` where wallet-based selective-disclosure credentials are available
- `Didit`: top candidate for reusable/free-first age assurance, age estimation, and free document fallback after provider-doc and contract validation
- `Persona`: useful free-tier document fallback candidate for age assurance when reusable proof is unavailable
- `Sumsub` and `Veriff`: serious KYC/KYB and documentary escalation providers for creator publishing, enterprise/studio, fraud, tax, or merchant workflows; not reusable-first credentials and not default viewer onboarding
- `ID.me`: do not make it part of the core default age-gate list right now; treat it as a possible future US-specific trusted-identity lane only if product scope and churn tradeoffs justify it

## Unified assurance result

Design the adapter layer so each provider returns the same app-facing result:

- `status`
- `over_threshold`
- `threshold`
- `assurance_level`
- `method_family`
- `provider`
- `credential_reusable`
- `country_code`
- `verified_at`
- `expires_at`
- `challenge_reference`

Do not store:

- raw ID images in the core app database
- full provider payloads unless a legal or audit workflow truly needs them
- public onchain age badges

## KYC and KYB triggers

Do not run KYC or KYB for ordinary viewers at signup.

Trigger KYC or KYB only for:

- suspicious account activity
- Studio, enterprise, or creator-content setup before publishing or monetized creator actions when policy requires it
- creator earning/tax setup only when a partner, regulator, bank, or operator workflow truly requires it
- regulated fiat off-ramp or merchant partner handoff
- business or merchant onboarding

Keep earning, tax, and partner risk separate from age-gate state:

- a user can be age-verified and still be reviewed for earning, tax, partner, or merchant risk
- a user can fail or skip KYC without losing ordinary viewer access unless another policy requires restriction
- direct non-custodial creator monetization should stay open by default when settlement is wallet-to-wallet and no regulated partner handoff is involved
- admin tooling should be able to request KYC or KYB for a specific account and reason without turning that into a universal onboarding requirement
- if an account needs review, the safer non-custodial response is to pause new paid actions before signature and pause entitlement issuance where needed, not to custody or “freeze” user funds inside the platform

## Creator KYC and KYB cost-control waterfall

KYC/KYB is a Studio, enterprise, creator publishing, earning/tax, merchant, fraud, or regulated partner workflow. It is not ordinary viewer onboarding.

Use a reusable-first provider strategy to reduce user friction, provider spend, and retained-liability surface:

1. Reuse an existing approved provider identity or business applicant when allowed by provider contract, legal basis, and user consent.
   - Preferred examples: Sumsub reusable identity / reusable KYC / Sumsub ID, Sumsub Copy Applicant for related entities, or an equivalent reusable provider network.
   - Store only the provider reference, consent/audit reference, result state, verification scope, expiry, and normalized eligibility flags.
2. Use freemium or low-cost KYC/KYB checks before paid enterprise fallbacks when reusable proof is unavailable.
   - Candidate examples: Didit free-tier KYC/KYB and Persona inquiry flows where procurement, data protection, and product coverage validate the use case.
   - Do not route high-volume creators to premium document sessions until the reusable/free lane is exhausted, unsupported, or inconclusive.
3. Re-authenticate returning verified creators with provider-owned face/liveness or account-continuity checks when supported, instead of asking for documents again.
   - Candidate examples: Sumsub face authentication / reusable identity checks, Veriff biometric authentication for returning users inside the same platform context.
4. Escalate to full paid documentary KYC/KYB only for edge cases.
   - Triggers: legal requirement, high-risk creator, suspicious activity, regulated off-ramp/merchant handoff, enterprise contract, UBO/business ownership review, sanctions/PEP risk, failed reusable check, or provider-required reverification.
   - Candidate examples: Sumsub, Veriff, Persona, or Didit document/business verification after launch approval.

Provider-selection rule:

- Sumsub is the primary reusable KYC/KYB candidate because its official docs describe reusable identity/KYC and applicant-copy patterns.
- Veriff is a strong heavy verification and returning-user biometric-auth candidate, but do not document it as a cross-platform reusable identity wallet unless Veriff contract/docs for the exact product say so.
- Persona and Didit can be cost-control candidates, but each exact KYC/KYB flow must be launch-approved against current provider docs, pricing, webhook behavior, retention controls, and regional coverage.

Data minimization rule:

- WeVid does not store raw identity documents, selfies, registry documents, UBO documents, biometric templates, or raw provider payloads in core app tables.
- Store normalized result state only: provider, provider reference, verification purpose, entity type, status, assurance/risk tier, country/jurisdiction hints, reusable flag, consent/audit reference, timestamps, expiry, and next action.
- Admin screens expose sanitized projections only. Provider dashboards remain the place for raw documents unless counsel explicitly approves a narrow retention/legal workflow.

## Audience geoblocking

Use creator-controlled audience blocks instead of default app-wide jurisdiction buckets:

- age assurance answers “is this viewer 18+ for protected app access?”
- creator geoblocking answers “does this creator want this location blocked from their audience?”

Operator-side emergency blocks can still exist for legal or abuse escalations, but they should not be the default onboarding model.

## Config model

The v2 API should carry this config shape in the Fastify config module and generated typed config package:

- `policy_version`
- `age_gate.all_protected_surfaces_require_third_party_age_assurance`
- `age_gate.provider_selection_enabled`
- `age_gate.prefer_reusable_credentials`
- `age_gate.supported_reusable_providers`
- `age_gate.supported_fallback_providers`
- `age_gate.fallback_order`
- `age_gate.reverification_mode`
- `age_gate.reverification_days`
- `age_gate.reverification_triggers`
- `monetization_verification.separate_from_age_assurance`
- `monetization_verification.on_demand_only`
- `monetization_verification.required_for_earning`
- `monetization_verification.trigger_actions`
- `monetization_verification.prefer_reusable_kyc`
- `monetization_verification.supported_reusable_kyc_providers`
- `monetization_verification.supported_low_cost_kyc_providers`
- `monetization_verification.heavy_fallback_providers`
- `monetization_verification.reverification_triggers`
- `creator_audience_controls.country_blocks_enabled`
- `creator_audience_controls.default_audience_mode`

Implementation rule:

- operator-only user restrictions must support targeted `creator_monetization_hold` and `viewer_payment_hold` cases
- operator-triggered KYC requests must support specific accounts and reasons
- these are targeted and auditable controls, not universal onboarding requirements

Age reverification rule:

- default to `reverification_mode=risk_or_expiry`, not recurring onboarding
- do not ask a user to reverify just because a fixed number of days passed
- request a new check only when the provider credential expires, the jurisdiction/rule changes, suspicious activity is detected, the user moves into creator/Studio/enterprise features, or an admin/risk workflow records a specific reason
- `reverification_days` is a fallback compatibility control only when a policy explicitly enables fixed-interval reverification
