# Identity Provider Wiring

Status: accepted
Scope: documentation
Last updated: 2026-11-04
Source of truth: yes

Owns:
- identity provider wiring decisions for its named domain

Defers to:
- INDEX.md, route-map.md, OpenAPI, the immutable migration chain for database shape, and ADRs where narrower

Does not own:
- unrelated domains, implementation shortcuts, provider secrets, or hidden source-of-truth rules

Launch scope:
- accepted v2 launch or phased behavior stated in this document

Non-goals:
- historical-context inference, duplicate systems, and unapproved provider/product expansion

This repo now enforces server-owned verification for wallet sign-in, age-gate completion, adult-publisher eligibility, creator KYC, and organization KYB.
Local mock flows remain useful for development, but real provider launches and real provider
webhooks must be configured before production rollout.

Current implementation state:

- Wallet authentication requires the immutable signed purpose `login` or `onboarding`. Login can create only an application session for an existing wallet mapping; unknown identities return `account_not_found` without creating a user, profile, wallet, or provider mapping. Onboarding may create one provisional account after verified wallet ownership and reuses an existing mapping without duplication.
- Current official Privy React/Solana documentation was re-checked on 2026-08-23. `embeddedWallets.solana.createOnLogin` is explicitly `off` in login mode and `users-without-wallets` only in onboarding mode. Existing Solana wallets are obtained through `useWallets`; `useCreateWallet` is never invoked by login.

- `POST /v1/age/sessions` is wired to an injectable backend provider waterfall.
- `GET /v1/age/status` is the browser-safe age read projection. `/age` reads it through the typed web API helper and starts `POST /v1/age/sessions` only after explicit authenticated user action.
- `GET /v1/verification/status` is the backend-owned capability projection for app, creator, Studio, and enterprise access.
- `POST /v1/verification/sessions` starts adult-publisher eligibility, creator KYC, or organization KYB sessions. Adult-publisher sessions require an explicit versioned terms acceptance. The browser receives only a hosted provider launch URL and cannot mark any verification complete.
- `POST /v1/webhooks/verification/{provider}` accepts signed age, adult-content, KYC, and KYB callbacks and writes normalized `verification_records`.
- The runtime waterfall has real HTTP session adapters for Yoti, Persona, Veriff, and Sumsub. Each adapter is inert until its exact env/config is present, and all unconfigured or failing providers fail closed with `503`.
- The creator/business verification waterfall has real HTTP session adapters for Didit, Sumsub, Persona, and Veriff. Didit, Sumsub, and Persona can serve creator KYC and org KYB when their purpose-specific workflows/levels/templates are configured. Veriff is currently a creator KYC documentary fallback only unless a Veriff business/KYB product is separately approved and wired.
- Local/test environments can enable `AGE_VERIFICATION_ALLOW_MOCK_PROVIDER=true` to use API-owned mock adapters for age, creator KYC, and organization KYB. These adapters create normal pending sessions, immediately apply a normalized valid result through the repository boundary, and are disabled when `NODE_ENV=production`.
- The landing path exposes one recommended age action and lets the server choose the lowest-friction configured method. Didit Adaptive Age Verification is the preferred low-friction path; Yoti Digital ID is the reusable credential candidate. The UI does not hardcode provider availability.
- Adult-publishing intent is not part of the locked three-step onboarding. Adult eligibility begins later from Create when explicit publication is selected; a valid higher-assurance result may satisfy ordinary age access only under explicit reuse policy.
- Before any provider request, the API atomically reserves a `verification_sessions` row and its matching pending `verification_records` entry. Provider selection is persisted before the external HTTP call, and the remote identifiers are attached afterward. This makes an early signed webhook reconcilable even if it arrives before the provider response. `verification_records` is the sole application authority; `age_verifications` is a revoked historical archive after migration `0077`.
- Raw provider payloads, identity images, document data, and browser-completed age state are not accepted by this route.

## Official references

- Phantom Browser SDK: https://docs.phantom.com/sdks/browser-sdk/index
- Phantom deeplinks: https://docs.phantom.com/phantom-deeplinks/handling-sessions
- Solana Mobile Wallet Adapter: https://docs.solanamobile.com/developers/mobile-wallet-adapter
- Sumsub API auth + webhooks: https://docs.sumsub.com/reference/get-started-with-api
- Sumsub hosted WebSDK link: https://docs.sumsub.com/reference/generate-websdk-external-link
- Sumsub applicant review webhook: https://docs.sumsub.com/docs/receive-verification-results
- Sumsub webhook payload fields: https://docs.sumsub.com/docs/user-verification-webhooks
- Sumsub webhook signature verification: https://docs.sumsub.com/docs/webhook-manager
- Yoti age verification overview: https://developers.yoti.com/age-verification/age-verification-introduction
- Yoti notifications/signature verification: https://developers.yoti.com/age-verification/notifications
- Didit Sessions API: https://docs.didit.me/integration/api-full-flow
- Didit Adaptive Age Verification: https://docs.didit.me/core-technology/age-estimation/overview
- Didit docs/pricing: https://docs.didit.me/getting-started/pricing
- Persona create inquiry: https://docs.withpersona.com/api-reference/inquiries/create-an-inquiry
- Persona generate one-time link: https://docs.withpersona.com/api-reference/inquiries/generate-a-one-time-link
- Didit webhook ordering and signatures: https://docs.didit.me/integration/webhooks
- EU age verification / EUDI: https://digital-strategy.ec.europa.eu/en/policies/eu-age-verification
- Scytales age verification connector: https://www.scytales.com/age-verification-connector

The Sumsub session/webhook, Persona inquiry/link, Didit webhook, and Yoti age-notification references above were re-checked on 2026-11-04. Sumsub requires the declared HMAC algorithm over the exact raw bytes; Yoti embeds its RSA-PSS signature in the JSON notification and retries unless the receiver returns `200`.

## Wallet signing

### Desktop

- Supported through injected Solana wallets exposed in the browser context.
- SIWS challenges are still created by the API and verified by the API after the wallet signs.

### Android

- Supported through the official Solana Wallet Adapter React stack: `ConnectionProvider`, `WalletProvider`, and `WalletModalProvider`.
- The web provider follows the current Solana React cookbook pattern: install `@solana/wallet-adapter-base`, `@solana/wallet-adapter-react`, `@solana/wallet-adapter-react-ui`, and `@solana/wallet-adapter-wallets`, pass `wallets={[]}`, and let wallet-standard/mobile discovery populate available adapters.
- WeVid renders detected Wallet Standard providers as direct cards and uses the Wallet Adapter modal only as the fallback for installation, mobile handoff, or less common adapters. Account creation starts only after a wallet connects, signs the backend challenge, and the API creates the wallet session.
- Profile logout calls Wallet Adapter `disconnect` through the mounted runtime before app-owned wallet state and cookies are expired. It does not infer provider state from browser storage keys.

### iOS

- There is no generic Solana Mobile Wallet Adapter equivalent for iOS web in this repo. Current Solana Mobile Wallet Adapter web support is Android/Chrome-oriented.
- iOS and macOS support should prefer wallet-standard/Safari Web Extension discovery where available. If the user has no wallet context, send them to the wallet's official install page or the Solana wallet directory, then return to the WeVid wallet chooser.
- Privy is the selected iOS-safe embedded onboarding candidate once its Solana signing UX is verified on the production domain. No parallel embedded-wallet provider is active.
- When configured for staging, Privy login and teardown stay inside the official SDK boundary, including `logout`. Privy is not launch-approved until the production-domain checks below pass.

### Public web env

- `NEXT_PUBLIC_SOLANA_CHAIN`
- `NEXT_PUBLIC_SOLANA_RPC_URL`
- `NEXT_PUBLIC_SOLANA_RPC_SUBSCRIPTIONS_URL`
- `NEXT_PUBLIC_PRIVY_APP_ID`
- `NEXT_PUBLIC_EMBEDDED_WALLET_RUNTIME_ENABLED`

### Supabase Auth callbacks

- Email magic links use `verifyOtp({ token_hash, type })`.
- Social/OAuth providers use PKCE and must exchange the returned `code` with `exchangeCodeForSession(code)` in `/auth/confirm`.
- Supabase recovery auth is not a second account path. Linking begins from a recently authenticated WeVid session, issues a short-lived one-use HttpOnly intent, then verifies the Supabase subject on the server. If that subject belongs to another user, the API returns conflict instead of merging profiles, wallets, age state, payments, creator KYC, or organization KYB.
- Recovery is optional and primarily benefits external-wallet-only users. Privy users are not asked to repeat equivalent recovery setup. Recovery login resolves an existing provider-subject mapping and rotates the canonical WeVid session; it never creates a user from a matching email.
- Landing recovery email uses Supabase `signInWithOtp` with `shouldCreateUser=false`; an unknown recovery identity therefore cannot silently become a Supabase or WeVid signup. OAuth recovery still fails closed at the backend mapping boundary.
- Local preview on port `3008` requires the local web env and Supabase dashboard redirect allowlist to include `http://localhost:3008/auth/confirm` and, when testing through Playwright or `127.0.0.1`, `http://127.0.0.1:3008/auth/confirm`.

### Production rollout notes

- Keep embedded wallet runtime disabled until Privy is staging-proven with Solana wallet creation/unlock, message signing, recovery/export, external wallet linking, and mobile Safari/PWA QA.
- Do not add wallet-specific iOS copy or support claims until the exact wallet path is implemented and tested on real devices.

## Age-Assurance Waterfall

Landing onboarding should prefer reusable or light/free age assurance:

1. reusable age credential: Yoti Digital ID and future launch-approved EUDI-compatible proof
2. light fallback: Didit Adaptive Age Verification with document fallback
3. regional non-document/eID checks where supported

Users may leave the landing surface to create a reusable ID and then return to complete age assurance. The wallet-owned application session and unique handle stay mandatory; display name, avatar, and Supabase recovery linking stay optional; age assurance stays mandatory for protected app access.

Current API behavior:

- `providerPreference=reusable_first` uses the configured light/reusable adapter order: Didit Adaptive Age Verification, then Yoti, then Persona. It does not silently treat ordinary onboarding as creator KYC.
- `providerPreference=yoti|persona|sumsub|veriff` remains an API compatibility/operator-test override for a specifically configured provider. Ordinary onboarding does not expose it as a provider chooser; production policy selects one primary and at most one documented fallback.
- Webhooks normalize signed provider events into app-owned states only: `pending`, `verified`, or `failed`.
- Launch approval still requires live sandbox evidence for the selected provider, webhook signing proof, retention/legal review, and provider-contract approval.

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
- `SUMSUB_CREATOR_KYC_LEVEL_NAME`
- `SUMSUB_ORG_KYB_LEVEL_NAME`
- `SUMSUB_API_BASE_URL=https://api.sumsub.com`
- `DIDIT_API_KEY`
- `DIDIT_WEBHOOK_SECRET`
- `DIDIT_AGE_WORKFLOW_ID`
- `DIDIT_ADULT_PUBLISHER_WORKFLOW_ID`
- `DIDIT_KYC_WORKFLOW_ID`
- `DIDIT_KYB_WORKFLOW_ID`
- `DIDIT_API_BASE_URL=https://verification.didit.me`
- `PERSONA_API_KEY`
- `PERSONA_WEBHOOK_SECRET`
- `PERSONA_TEMPLATE_ID`
- `PERSONA_CREATOR_KYC_TEMPLATE_ID`
- `PERSONA_ORG_KYB_TEMPLATE_ID`
- `PERSONA_API_BASE_URL=https://api.withpersona.com`
- `VERIFF_API_KEY`
- `VERIFF_SHARED_SECRET`
- `VERIFF_API_BASE_URL=https://stationapi.veriff.com`

`SUMSUB_LEVEL_NAME` remains a compatibility fallback. Production should prefer separate creator and organization levels so creator KYC does not accidentally satisfy organization KYB or the reverse.
`PERSONA_TEMPLATE_ID` remains a compatibility fallback. Production should prefer separate creator and organization templates so person KYC and business KYB cannot satisfy the wrong policy.

### Provider logo assets

Age/KYC/KYB provider buttons must use provider-approved brand files before launch. Store the approved assets in `apps/web/public/provider-icons/` with these exact names:

- `didit.svg`
- `yoti.svg`
- `sumsub.svg`
- `persona.svg`
- `veriff.svg`

The frontend has neutral monogram fallbacks for local development, but those fallbacks are not official provider logos and should not be used for final production polish. Do not recreate provider logos in React, CSS, or screenshots.

### Creator KYC / Org KYB runtime behavior

- SFW upload and publishing require valid age access, not creator KYC.
- Adult/explicit publishing requires `verification_records.purpose=adult_publisher_eligibility` with `status=valid`, valid age access, and media-specific performer/consent readiness.
- Creator KYC affects creator proceeds only. It does not grant adult publishing, Studio, Enterprise, or team tools.
- Organization KYB verifies a legal entity only. It never grants a paid plan or software capability by itself.
- Session creation stores a pending `verification_sessions` row and a pending normalized record.
- Signed provider webhooks update the pending session and append a normalized record.
- Raw provider payloads, identity documents, selfies, biometric templates, registry files, and private provider review comments stay out of core app tables and browser resources.

### Session and decision lifecycle invariants

- The API reserves the session and pending record transactionally before provider I/O. A repeated idempotency key cannot create a second reservation; reuse with a different request hash is rejected explicitly.
- The stable provider subject reference is separate from the provider-created applicant, inquiry, session, or transaction id. For Sumsub, `externalUserId` is the WeVid subject reference and `applicantId` is the later provider applicant id; they are never relabeled as each other.
- The chosen provider and method are persisted before the external request. Once a provider call is attempted, the API does not silently fall through to another provider because the first provider may have created a remote session even when the response was lost.
- Signed webhooks that arrive before the remote id is attached are stored as normalized unmatched receipts and reconciled by the stable subject reference when session creation completes.
- Provider delivery order is not decision order. Decisions are applied by the provider-authored event timestamp. An older approval cannot overwrite a newer denial; at equal timestamps the more restrictive decision wins. A timestamp-less positive result cannot overwrite an existing decision.
- Provider event idempotency uses the provider's documented immutable event id when one exists. Sumsub's `correlationId` is stored only as correlation metadata because multiple decisions can share it; Sumsub events use a fingerprint of the exact signed payload as the event id.
- A launch link's `expires_at` describes only how long the browser may start the provider flow. A valid evidence record does not inherit that TTL. Valid evidence remains active until provider revocation or an approved re-check/retention policy supplies an evidence expiry; that policy still requires legal and provider acceptance before launch.
- A valid canonical age result may activate a provisional user, but it does not change the user's selected profile visibility. Age evidence stores the threshold (`18`) and result (`true`) required by the capability resolver.

### Provider-specific runtime notes

- Didit age, adult-publisher, creator KYC, and org KYB session creation uses `POST /v3/session/` with `x-api-key`, a purpose-specific workflow ID, `callback`, `callback_method=completer`, opaque `vendor_data`, and non-sensitive metadata. Didit V3 webhooks use one application-level destination at `POST /v1/webhooks/verification/{provider}` with `provider=didit`; the API requires `X-Signature-V2`, verifies the documented canonical JSON body, derives the five-minute freshness window from the signed V3 envelope `timestamp`, and requires `X-Timestamp` to equal that signed value. A refreshed unsigned header can never make an old signed body fresh. Processing keys idempotency on the documented stable `event_id` and normalizes the documented plural decision arrays. Adult-publisher and creator-KYC approval fails closed unless document, liveness, and face-match nodes are all approved.

This direct adapter has no installed Didit server SDK. The V3 envelope and `X-Signature-V2` contract were re-checked against `https://docs.didit.me/integration/webhooks` and the official `didit-protocol/plugin-wordpress` verifier on 2026-11-04. The official generic sample still illustrates freshness from the independently supplied header, while the signed envelope contract states that body `timestamp` is present, refreshed per delivery attempt, used for signature verification, and covered by V2. We therefore require header/body equality and trust only the signed body value for freshness. A real Console `Try Webhook` fixture for the exact destination remains mandatory before provider promotion.

Didit launch approval requires four separately published workflows in the Business Console:

- adaptive age verification with an over-18 threshold and document fallback;
- adult publisher identity with government ID, liveness, face match, and jurisdictional over-18 rules;
- individual creator KYC for earning-policy requirements;
- organization KYB for legal-entity workflows.

The production webhook destination must subscribe to `status.updated`, use webhook version V3, and point to the verification webhook route with the `didit` provider path parameter. Console-issued credentials and a signed sandbox fixture remain mandatory launch evidence; mock approval is disabled in production.
- Persona session creation is an explicit two-step server flow pinned to `Persona-Version: 2026-09-29`: create the inquiry with the purpose-specific template, then call Persona's generate-one-time-link inquiry endpoint. The browser receives only `meta.one-time-link`. Persona webhooks verify `Persona-Signature` as timestamped HMAC-SHA256 over `timestamp.rawBody`.
- Sumsub session creation signs `POST /resources/sdkIntegrations/levels/-/websdkLink` with `x-app-token`, `x-app-access-ts`, and `x-app-access-sig`, supplies the purpose-specific level and stable external user id, and returns the hosted `url`. An SDK access token is SDK input, not a browser callback URL, and is not appended to the WeVid callback. Creator and organization levels should be separate.
- Veriff session creation uses the Veriff Sessions API with `x-auth-client`. Veriff webhooks verify `x-hmac-signature` against the raw payload. In this scaffold Veriff is creator KYC only, not organization KYB.

### Required dashboard setup

1. Create or select a Sumsub verification level intended for the approved creator/compliance use case.
2. Set the level name into `SUMSUB_LEVEL_NAME`.
3. Add the production webhook URL:
   - `POST https://<api-domain>/v1/webhooks/age/sumsub`
4. Configure the webhook signing secret to match `SUMSUB_WEBHOOK_SECRET`.
5. Ensure the webhook includes applicant review events.
6. Keep the API app token and secret key server-side only.

### Sumsub webhook expectations in this repo

- Route:
  - `POST /v1/webhooks/age/sumsub`
- Signature:
  - header `x-payload-digest`
  - header `x-payload-digest-alg`
  - validated against the raw JSON payload with the HMAC algorithm declared by Sumsub
  - supported values are `HMAC_SHA256_HEX`, `HMAC_SHA512_HEX`, and legacy `HMAC_SHA1_HEX`
  - both headers are required; missing or unknown algorithm values fail closed rather than defaulting to SHA-256
- Provider reference lookup:
  - `applicantId` is the provider-created applicant id; `externalUserId` is the stable WeVid subject reference used to reconcile callbacks that beat the session response
  - the repo attaches the applicant id when known and can match an early callback by the external user id
- Event identity and ordering:
  - the exact signed payload fingerprint is the event id because Sumsub can reuse one `correlationId` across multiple final decisions
  - `correlationId` is retained separately for investigation
  - `createdAt` is the decision timestamp; later provider decisions win, including a later `RED` after an earlier `GREEN`
- Result ownership:
  - the browser cannot complete or override the result
  - only the verified webhook path applies the over-18 decision
- Storage:
  - `provider_webhook_receipts` stores receipt metadata and a hash of the signature only
  - `provider_events` stores normalized provider event state
  - `verification_sessions`, `verification_events`, and `verification_records` store normalized session, receipt, and decision state
  - raw provider payloads, identity images, document data, and private provider comments are not stored

### Runtime behavior in this repo

- The API creates a Sumsub hosted WebSDK link for the configured level and stable external user id.
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
   - `POST https://<api-domain>/v1/webhooks/age/yoti`
3. Export the Yoti notification public key to the API host and set its path in `YOTI_NOTIFICATION_KEY_PATH`.
4. Keep the API token server-side only.

### Yoti webhook expectations in this repo

- Route:
  - `POST /v1/webhooks/age/yoti`
- Signature field:
  - JSON payload field `signature`
- Verification:
  - the repo verifies the signed notification with RSA-SHA256/PSS using the public key at `YOTI_NOTIFICATION_KEY_PATH`
  - the route returns `200` after an accepted or duplicate notification because Yoti retries any notification not acknowledged with that exact success status
- Provider reference lookup:
  - the repo resolves the pending age verification by `session_key`, falling back to `reference_id`
- Result ownership:
  - the browser cannot complete or override the result
  - only the verified webhook path applies the over-18 decision
- Storage:
  - `provider_webhook_receipts` stores receipt metadata and a hash of the notification signature only
  - `provider_events` stores normalized provider event state
  - `verification_sessions`, `verification_events`, and `verification_records` store normalized session, receipt, and decision state
  - raw provider payloads and identity artifacts are not stored

### Runtime behavior in this repo

- The API starts the Yoti session.
- The launch URL is returned to the browser; `/age` redirects to it only after the backend creates the session.
- The browser cannot self-complete the check.
- A signed notification with `state=COMPLETE` applies the over-18 decision server-side.
- A signed notification with `state=FAIL` or `state=ERROR` records a failed age state.
- Duplicate provider events return `200` but are not applied twice.

## Production guardrails

- Never enable `AGE_VERIFICATION_ALLOW_MOCK_PROVIDER=true` outside local/test.
- Mock adapters are not provider integrations and must not be used for staging provider proof, launch approval, legal evidence, or compliance reporting.
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
4. Configure the provider dashboard webhook to call the exact `/v1/webhooks/age/sumsub` or `/v1/webhooks/age/yoti` endpoint selected for the approved workflow.
5. Verify the webhook secret or notification key matches the API env.
6. Complete one full provider session on a staging domain and confirm:
   - the webhook is received
   - the user age status flips server-side
   - app access unlocks only after the server-owned result is stored
