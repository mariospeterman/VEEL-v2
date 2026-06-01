# Age Assurance, KYC, And Audience Geoblocking

Status: current
Scope: documentation
Last updated: 2026-05-29
Source of truth: yes

This document aligns the current codebase with the recommended 2026 operating model.

## Core separation

- age assurance answers: can this person access protected 18+ app surfaces?
- KYC or KYB answers: does this user need extra review for suspicious, regulated, or operational payout flows?
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

## Product rule

Protected app access should be universal:

- all protected app entry requires third-party age assurance
- the product should not depend on coarse country-bucket segmentation for ordinary viewer access
- the onboarding surface should feel simple even though the backend keeps a layered fallback ladder

## Provider strategy

Support provider families, not one-off hard-coded vendors:

- `portable_credential`
  Examples: EU age-verification app / future EUDI wallet, Yoti Digital ID, other reusable over-18 credentials as they become practical
- `age_estimation`
  Examples: Yoti facial age estimation, Sumsub age estimation
- `database_non_doc`
  Examples: Sumsub or regional identity/eID-backed checks where supported
- `document_idv`
  Examples: Sumsub documentary flow, Persona documentary flow

Launch-default recommendation:

- primary commercial provider: `Yoti`
- fallback providers: `Sumsub` and `Persona`
- product rule: let the user choose a supported reusable provider when possible, then fall back within the same third-party flow when needed

Expanded provider recommendation:

- `Scytales`: good reusable-wallet verifier lane to support alongside `EUDI Wallet` and `Yoti` where wallet-based selective-disclosure credentials are available
- `Didit`: reasonable optional fallback provider in the non-doc / documentary ladder, but not a reusable-first credential
- `Veriff`: reasonable optional fallback provider for age-estimation or documentary fallback, but not a reusable-first credential
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
- creator payout setup only when a partner, regulator, bank, or operator workflow truly requires it
- regulated fiat off-ramp or merchant partner handoff
- business or merchant onboarding

Keep payout risk separate from age-gate state:

- a user can be age-verified and still be reviewed for payout or merchant risk
- a user can fail or skip KYC without losing ordinary viewer access unless another policy requires restriction
- direct non-custodial creator monetization should stay open by default when settlement is wallet-to-wallet and no regulated partner handoff is involved
- admin tooling should be able to request KYC or KYB for a specific account and reason without turning that into a universal onboarding requirement
- if an account needs review, the safer non-custodial response is to pause new paid actions before signature and pause entitlement issuance where needed, not to custody or “freeze” user funds inside the platform

## Audience geoblocking

Use creator-controlled audience blocks instead of default app-wide jurisdiction buckets:

- age assurance answers “is this viewer 18+ for protected app access?”
- creator geoblocking answers “does this creator want this location blocked from their audience?”

Operator-side emergency blocks can still exist for legal or abuse escalations, but they should not be the default onboarding model.

## Config model

The repo now carries the config shape in `apps/api/config/compliance.php`:

- `policy_version`
- `age_gate.all_protected_surfaces_require_third_party_age_assurance`
- `age_gate.provider_selection_enabled`
- `age_gate.prefer_reusable_credentials`
- `age_gate.supported_reusable_providers`
- `age_gate.supported_fallback_providers`
- `age_gate.fallback_order`
- `age_gate.reverification_days`
- `monetization_verification.separate_from_age_assurance`
- `monetization_verification.on_demand_only`
- `monetization_verification.required_for_earning`
- `monetization_verification.trigger_actions`
- `creator_audience_controls.country_blocks_enabled`
- `creator_audience_controls.default_audience_mode`

Current implementation note:

- operator-only user restrictions now exist for targeted `creator_monetization_hold` and `viewer_payment_hold` cases
- operator-triggered KYC requests now exist for specific accounts and reasons
- these are meant to stay targeted and auditable, not to become a universal onboarding requirement
