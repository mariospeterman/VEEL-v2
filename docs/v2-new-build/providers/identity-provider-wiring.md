# Identity Provider Wiring

Status: accepted
Scope: documentation
Last updated: 2026-06-03
Source of truth: yes

Owns:
- identity provider wiring decisions for its named domain

Defers to:
- INDEX.md, route-map.md, OpenAPI, schema blueprint, and ADRs where narrower

Does not own:
- unrelated domains, implementation shortcuts, provider secrets, or hidden source-of-truth rules

Launch scope:
- accepted v2 launch or phased behavior stated in this document

Non-goals:
- historical-context inference, duplicate systems, and unapproved provider/product expansion

This repo now enforces server-owned verification for wallet sign-in and age-gate completion.
Local mock flows remain useful for development, but real provider launches and real provider
webhooks must be configured before production rollout.

Current implementation state:

- `POST /v1/age/sessions` is wired to an injectable backend provider waterfall.
- `GET /v1/age/status` is the browser-safe age read projection. `/age` reads it through the typed web API helper and starts `POST /v1/age/sessions` only after explicit authenticated user action.
- The default runtime waterfall fails closed with `503` until a real provider adapter is launch-approved and configured.
- Successful provider session starts are stored as pending `age_verifications` rows with provider reference, state, rule/jurisdiction metadata, and timestamps only.
- Raw provider payloads, identity images, document data, and browser-completed age state are not accepted by this route.

## Official references

- Phantom Browser SDK: https://docs.phantom.com/sdks/browser-sdk/index
- Phantom deeplinks: https://docs.phantom.com/phantom-deeplinks/handling-sessions
- Solana Mobile Wallet Adapter: https://docs.solanamobile.com/developers/mobile-wallet-adapter
- Sumsub API auth + webhooks: https://docs.sumsub.com/reference/get-started-with-api
- Sumsub applicant review webhook: https://docs.sumsub.com/docs/receive-verification-results
- Sumsub webhook signature verification: https://docs.sumsub.com/docs/webhook-manager
- Yoti age verification overview: https://developers.yoti.com/age-verification/age-verification-introduction
- Yoti notifications/signature verification: https://developers.yoti.com/age-verification/notifications
- Didit docs/pricing: https://docs.didit.me/getting-started/pricing
- Persona docs: https://docs.withpersona.com/
- EU age verification / EUDI: https://digital-strategy.ec.europa.eu/en/policies/eu-age-verification
- Scytales age verification connector: https://www.scytales.com/age-verification-connector

## Wallet signing

### Desktop

- Supported through injected Solana wallets exposed in the browser context.
- SIWS challenges are still created by the API and verified by the API after the wallet signs.

### Android

- Supported through Solana Mobile Wallet Adapter.
- The app registers MWA on the client through `@solana-mobile/wallet-standard-mobile`.

### iOS

- This repo now exposes a Phantom-specific deep-link path behind `NEXT_PUBLIC_PHANTOM_APP_ID`.
- That path is intended for mobile Safari / browser-based entry where no injected provider exists.
- It is wallet-specific. There is still no generic multi-wallet iOS standard in this repo.
- It does not replace Android MWA and it does not provide Solflare parity yet.

#### Public web env

- `NEXT_PUBLIC_PHANTOM_APP_ID`
- `NEXT_PUBLIC_APP_URL`

#### Production rollout notes

- Use a real Phantom App ID created for the production domain.
- Keep `NEXT_PUBLIC_APP_URL` aligned with the public origin that Phantom should return to.
- Validate the return path on the real iPhone browser/device matrix before rollout.
- If Solflare parity is required, add a dedicated Solflare deep-link path instead of pretending the Phantom path is generic.

#### Exact remaining iOS blocker

- This repo currently implements a verified Phantom-specific browser deep-link path only.
- It does not yet implement wallet-specific universal-link or deep-link flows for Solflare or other iOS wallets.
- Until those paths exist, iPhone production support is:
  - `Phantom in Safari via Browser SDK deeplink`: supported when `NEXT_PUBLIC_PHANTOM_APP_ID` is configured
  - `Solflare on iPhone`: not implemented
  - `generic multi-wallet iOS signing`: not implemented

## Age-Assurance Waterfall

Landing onboarding should prefer reusable or light/free age assurance:

1. reusable age credential: Didit reusable ID, Yoti Digital ID, EUDI Wallet, Scytales
2. light/free fallback: Didit age estimation, Persona/Didit document proof
3. regional non-document/eID checks where supported

Users may leave the landing surface to create a reusable ID and then return to complete age assurance. Wallet connection stays mandatory; profile and Supabase recovery auth stay optional; age assurance stays mandatory for protected app access.

## Creator Compliance Providers

Sumsub and Veriff are not default ordinary viewer onboarding providers. Sumsub is the primary reusable KYC/KYB candidate; Veriff is a heavy documentary and returning-user biometric fallback candidate. Keep both inside Studio, enterprise, creator publishing, creator earning/tax, suspicious activity, merchant, or regulated partner workflows after legal, privacy, security, procurement, and provider-contract approval.

## Creator KYC/KYB Cost-Control Waterfall

Before starting any creator, Studio, enterprise, tax, merchant, or partner KYC/KYB session, the API should choose the least invasive provider path that satisfies the required policy:

1. Reusable provider identity or copied applicant.
   - Sumsub reusable identity/KYC and Copy Applicant are primary candidates when the provider contract, consent record, entity relationship, and legal basis allow reuse.
   - This is the lowest-friction path and should be preferred for returning creators, related organizations, UBOs already verified under a related entity, or partner-network reuse.
2. Freemium or low-cost KYC/KYB check.
   - Didit and Persona are candidates where current provider docs, pricing, supported regions, webhook behavior, and data-retention terms fit the exact use case.
   - This path is preferred before premium enterprise document sessions when reusable proof is unavailable.
3. Returning-user biometric/account-continuity check.
   - Sumsub face authentication or Veriff biometric authentication can re-check a previously verified creator without repeated document upload when allowed by policy.
   - This is for returning users inside a verified provider/app context, not a public reusable identity wallet claim.
4. Full paid documentary KYC/KYB.
   - Use only for legal, fraud, sanctions/PEP, UBO, merchant/off-ramp, enterprise contract, failed reusable proof, or provider-required escalation.

Every provider adapter must normalize to the same app-facing state:

- `verification_purpose`: creator_publishing, creator_earning, studio, enterprise, tax, merchant, fraud_review, admin_required
- `entity_type`: person, business, organization, ubo
- `provider`
- `provider_reference`
- `status`
- `assurance_level`
- `risk_tier`
- `country_code`
- `credential_reusable`
- `consent_reference`
- `verified_at`
- `expires_at`
- `next_action`

Never store raw identity documents, selfies, registry files, UBO documents, biometric templates, raw provider payloads, or private provider comments in browser resources or core app tables.

### Required API env when explicitly selected

- `AGE_VERIFICATION_DRIVER=sumsub`
- `SUMSUB_APP_TOKEN`
- `SUMSUB_SECRET_KEY`
- `SUMSUB_WEBHOOK_SECRET`
- `SUMSUB_LEVEL_NAME`
- `SUMSUB_API_BASE_URL=https://api.sumsub.com`

### Required dashboard setup

1. Create or select a Sumsub verification level intended for the approved creator/compliance use case.
2. Set the level name into `SUMSUB_LEVEL_NAME`.
3. Add the production webhook URL:
   - `POST https://<api-domain>/v1/webhooks/age/{provider}`
4. Configure the webhook signing secret to match `SUMSUB_WEBHOOK_SECRET`.
5. Ensure the webhook includes applicant review events.
6. Keep the API app token and secret key server-side only.

### Sumsub webhook expectations in this repo

- Route:
  - `POST /v1/webhooks/age/{provider}` with `{provider}=sumsub`
- Signature:
  - header `x-payload-digest`
  - header `x-payload-digest-alg`
  - validated against the raw JSON payload with the HMAC algorithm declared by Sumsub
  - supported values are `HMAC_SHA256_HEX`, `HMAC_SHA512_HEX`, and legacy `HMAC_SHA1_HEX`
- Provider reference lookup:
  - the repo resolves the pending age verification by `applicantId`, falling back to `externalUserId` when provider setup uses that reference
- Result ownership:
  - the browser cannot complete or override the result
  - only the verified webhook path applies the over-18 decision
- Storage:
  - `provider_webhook_receipts` stores receipt metadata and a hash of the signature only
  - `provider_events` stores normalized provider event state
  - `age_verifications` stores normalized `pending`, `verified`, or `failed` state
  - raw provider payloads, identity images, document data, and private provider comments are not stored

### Runtime behavior in this repo

- The API starts the Sumsub session.
- The provider launch URL is returned to the browser; `/age` redirects to it only after the backend creates the session.
- The browser cannot self-complete the age check.
- A signed `applicantReviewed` webhook with `reviewResult.reviewAnswer=GREEN` applies the over-18 decision server-side.
- A signed `applicantReviewed` webhook with `reviewResult.reviewAnswer=RED` records a failed age state.
- Duplicate provider events return `202` but are not applied twice.

## Yoti

### Required API env

- `AGE_VERIFICATION_DRIVER=yoti_digital_id`
- `YOTI_SDK_ID`
- `YOTI_API_TOKEN`
- `YOTI_NOTIFICATION_KEY_PATH`
- `YOTI_API_BASE_URL=https://age.yoti.com/api/v1`
- `YOTI_LAUNCH_BASE_URL=https://age.yoti.com`

### Required dashboard/setup work

1. Create the Yoti age-verification application for the production domain.
2. Configure the notification / webhook endpoint:
   - `POST https://<api-domain>/v1/webhooks/age/{provider}`
3. Export the Yoti notification public key to the API host and set its path in `YOTI_NOTIFICATION_KEY_PATH`.
4. Keep the API token server-side only.

### Yoti webhook expectations in this repo

- Route:
  - `POST /v1/webhooks/age/{provider}` with `{provider}=yoti`
- Signature field:
  - JSON payload field `signature`
- Verification:
  - the repo verifies the signed notification with RSA-SHA256/PSS using the public key at `YOTI_NOTIFICATION_KEY_PATH`
- Provider reference lookup:
  - the repo resolves the pending age verification by `session_key`, falling back to `reference_id`
- Result ownership:
  - the browser cannot complete or override the result
  - only the verified webhook path applies the over-18 decision
- Storage:
  - `provider_webhook_receipts` stores receipt metadata and a hash of the notification signature only
  - `provider_events` stores normalized provider event state
  - `age_verifications` stores normalized `pending`, `verified`, or `failed` state
  - raw provider payloads and identity artifacts are not stored

### Runtime behavior in this repo

- The API starts the Yoti session.
- The launch URL is returned to the browser; `/age` redirects to it only after the backend creates the session.
- The browser cannot self-complete the check.
- A signed notification with `state=COMPLETE` applies the over-18 decision server-side.
- A signed notification with `state=FAIL` or `state=ERROR` records a failed age state.
- Duplicate provider events return `202` but are not applied twice.

## Production guardrails

- Never enable `AGE_VERIFICATION_ALLOW_MOCK_PROVIDER=true` outside local/test.
- If a real provider is selected but not configured, fail closed and block access.
- Keep provider secrets server-side only.
- Do not store unnecessary identity payloads; the app should keep only the minimum over-18 result fields.

## Go-live checklist

1. Pick one production age-assurance driver for ordinary viewer access:
   - `AGE_VERIFICATION_DRIVER=yoti_digital_id`
   - or another reusable/light provider only after its adapter, contract, webhook, and retention rules are launch-approved
   - do not use Sumsub or Veriff as default viewer onboarding
2. Set the matching provider env in the API runtime.
3. Keep `AGE_VERIFICATION_ALLOW_MOCK_PROVIDER=false` in production.
4. Configure the provider dashboard webhook to call the correct `/v1/webhooks/age/{provider}` endpoint.
5. Verify the webhook secret or notification key matches the API env.
6. Complete one full provider session on a staging domain and confirm:
   - the webhook is received
   - the user age status flips server-side
   - app access unlocks only after the server-owned result is stored
