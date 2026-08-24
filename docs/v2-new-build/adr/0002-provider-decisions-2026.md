# ADR 0002: 2026 Provider Decisions For V2 Launch

Status: accepted
Scope: wallet, onramp, payments, subscriptions, media, live, age/KYC, AI, events
Last updated: 2026-08-15
Source of truth: yes for provider topology; vendor/account approval remains provider-specific

Owns:
- 0002 provider decisions 2026 decisions for its named domain

Defers to:
- INDEX.md, route-map.md, OpenAPI, schema blueprint, and ADRs where narrower

Does not own:
- unrelated domains, implementation shortcuts, provider secrets, or hidden source-of-truth rules

Launch scope:
- accepted v2 launch or phased behavior stated in this document

Non-goals:
- historical-context inference, duplicate systems, and unapproved provider/product expansion

This ADR turns the v2 blueprint into concrete provider defaults for the first implementation pass. The goal is provider-first architecture with minimal custom infrastructure, low platform custody/regulatory exposure, and strong user conversion.

## Decision Summary

| Area | Launch recommendation | Reason |
| --- | --- | --- |
| Onboarding order | Three visible steps: Account + Wallet, Minimal Profile, Age Verification, then app | Every user gains wallet capability without exposing separate provider/provision/sign/session screens. |
| Embedded wallet | Privy is the sole launch runtime; Turnkey is unbundled fallback only | Mainstream entry and an embedded Solana wallet converge on the same backend challenge/session as external wallets without parallel auth authorities. |
| Onramp/funding | Embedded-wallet provider funding UI first, funding only | Platform does not handle card processing, merchant checkout, product billing, or custody; user funds their own wallet. |
| One-time payments | Solana Pay / Solana transaction requests | Noncustodial, wallet-approved, backend-verified. |
| Payment evidence | Helius scoped to money/access evidence, with RPC fallback | Cost-aware, not a broad firehose. |
| Platform plans | Solana Subscriptions/Allowances auto-renewal; manual Solana Pay recovery fallback only | Keeps plans recurring, noncustodial, revocable, and avoids merchant checkout, custodial balances, and provider-operated product billing. |
| Profile Memberships | Keep as `Join @handle` fan access, not a replacement for discovery/unlocks | Supports creator recurring revenue without killing free discovery. |
| Creator pricing | Creator sets content unlock, media-offer, structured-deliverable, live pass, Event Access Pass, and Profile Membership prices within admin/env guardrails | Preserves creator ownership while preventing abuse, too-low pricing, and compliance issues. |
| VOD | Bunny Stream/CDN/TUS | Direct uploads and playback provider infrastructure. |
| Live/replay | Livepeer with JWT playback access from day one for paid streams/replays | Provider-owned live infra and provider-enforced protected playback. |
| Age assurance | One configured reusable/light primary and at most one documented fallback behind the provider-neutral waterfall | Server policy chooses the lowest-friction approved path; no ordinary provider chooser and no raw identity data in core DB. |
| Creator KYC/KYB | Separate Studio/enterprise/creator compliance flow; Sumsub reusable-first, Didit/Persona cost-control candidates, Veriff heavy/biometric fallback | Avoid viewer onboarding friction while keeping a provider path for creator publishing, tax, fraud, and business workflows. |
| AI/MCP | Secure MCP connection layer first; external AI clients/LLMs bring the brain, optional BYO in-app assistant later | Avoid overbuilding a model platform; Veel owns data, scopes, policy, rate limits, approvals, and audit. |
| Create flow | Raw/simple create: record/upload, essential edits, caption/#/@/location, NSFW label, optional event, monetisation, preview, publish | Avoids overbuilt editor while preserving creator conversion controls. |
| Mutuals | Profile/settings-owned explicit mode; not configured per Create draft | Mutuals appears on creator media only when profile mode is active and viewer also opted in. |
| Event Access | Internal backend QR/pass entitlement + Solana Pay settlement first; NFT/Solana pass ADR later | Proven, simple, noncustodial split settlement without premature custom smart contracts. |
| Event location | Browser geolocation with permission + manual OSM-backed place search | Free/low-cost launch UX without platform handling private location carelessly. |
| Share | Internal Veel share/repost/message has no referral commission; external share tab uses backend referral URL | Keeps social sharing clean while preserving referral attribution for off-platform conversion. |
| Commerce interoperability | Selected Solana Commerce Kit primitive: exact-pinned `@solana-commerce/solana-pay` behind the existing payment module in Slice 06 | Replaces manual Solana Pay URL/QR plumbing without replacing WeVid payment intents, wallets, checkout UI, transaction composition, exact split verification, or domain outcomes. |
| Physical commerce | Deferred WeVid-native Product Offers plus lightweight Orders/Fulfillment; no full commerce engine | Content remains the advertisement and the profile the storefront while existing identity, wallet, payment, verification, dispute, notification, and audit authorities are reused. |

## Commerce Kit And Native Commerce Lock

The superseded commerce-engine direction is rejected. Vendure, Medusa, Shopify, WooCommerce, and other full commerce engines are not canonical providers or core dependencies. Shopify may be reconsidered much later only as an optional import/synchronisation connector for professional sellers, and any such connector requires a new ADR; it cannot own WeVid product identity, checkout, seller identity, customer identity, orders, payments, or fulfillment.

The Commerce Kit baseline was re-checked on 2026-08-15 and is exact-pinned in Slice 06 as `@solana-commerce/solana-pay` version `0.1.1`, tied to official upstream repository HEAD `6164d5104f3d1bd4cfbb637075f000d6ac23d6c3`. The selected runtime surface is limited to `encodeTransactionRequestURL` query generation and `createQRDataURL` SVG generation behind `solana-pay-codec.ts`; no package type crosses the adapter.

Version `0.1.1` has a verified encoder/parser incompatibility for transaction requests: its encoder returns the HTTPS callback without the standard `solana:` scheme, while its parser requires `solana:` and removes two pathname characters. WeVid does not broaden provider authority to compensate. The adapter uses the official encoder's query shape and QR generator, supplies and validates the standard scheme locally, rejects transfer requests and unsafe callback origins, and pins the defect in compatibility tests. An upgrade is accepted only after official source review, round-trip/safety tests, bundle proof, real devnet wallet/QR proof, and rollback confirmation.

Only `@solana-commerce/solana-pay` is initially selected, for Solana Pay URL encode/parse, transaction-request URLs, QR data generation, and deep-link/cross-device wallet handoff. `@solana-commerce/kit`, `@solana-commerce/react`, `@solana-commerce/connector`, `@solana-commerce/sdk`, and `@solana-commerce/headless` are excluded initially because they would add unused meta functionality or duplicate WeVid checkout UI, wallet connection/state, transaction approval, cart, order, or payment-flow authority. `@solana-commerce/headless` may return for review only after a focused benchmark proves meaningful code removal without creating a competing authority.

Commerce Kit is isolated behind the existing payment module. It never confirms settlement, computes price or recipients, composes WeVid's exact split transaction, grants entitlement/access, creates an order, or replaces Privy/Wallet Standard. A Commerce Kit callback, wallet approval, QR, or submitted signature is presentation/pending evidence only; blockchain settlement verified against the stored WeVid `PaymentIntent` remains payment truth.

## Provider Acceptance States

Provider-dependent code cannot ship from a vague draft. Each provider must move through these states:

```text
candidate -> staging-approved -> launch-approved
candidate -> rejected
candidate -> replaced
```

Definitions:

- `candidate`: architecture preference documented, official docs reviewed, account/terms not fully proven.
- `staging-approved`: staging account exists, keys/webhooks work, required UX and security tests pass, adult-platform/account acceptance risk is understood.
- `launch-approved`: production account approved, limits/pricing/support reviewed, security/compliance accepted, rollback/fallback documented.
- `rejected`: provider failed technical, UX, pricing, compliance, account, or support criteria.
- `replaced`: provider was superseded by a better accepted provider.

Current provider gate:

| Domain | Provider/path | State | Must pass before implementation depends on it |
| --- | --- | --- | --- |
| Embedded wallet | Privy | candidate | Solana embedded wallet creation, signing, export/recovery, external wallet link, mobile PWA, funding UI, noncustodial terms, adult-platform account acceptance. |
| Embedded wallet fallback | Turnkey | candidate, unbundled | Consider only if Privy is rejected; no SDK, initialization, login, or parallel UI. |
| Age assurance | Yoti | candidate | 18+ flow, reusable Digital ID path, webhook verification, regional support, minimal-data storage. |
| Age/KYC fallback | Sumsub | candidate | Age/KYC/KYB levels, reusable verification support, webhook verification, creator KYC/KYB path. |
| Age fallback | Veriff | candidate | Global age assurance, risk-based checks, webhook verification, privacy/security review. |
| Documentary fallback | Persona | candidate | Procurement, privacy/security, data minimization, explicit legal basis for documentary fallback. |
| VOD | Bunny Stream/CDN/TUS | candidate; `CODE_COMPLETE_PROVIDER_BLOCKED` for the C08 private MCP handoff | TUS upload, signed/tokenized playback, webhook idempotency, provider outage state. The private MCP path reuses canonical image sanitization and Bunny TUS behind a one-time capability; staging still must prove the exact provider account, Shield, upload, deletion/recovery, and rollback behavior before approval. |
| Live/replay | Livepeer JWT | candidate; `CODE_COMPLETE_PROVIDER_BLOCKED` in Slice 07 | OBS ingest, one-response owner secret reveal, exact JWT subject/expiry, moderation source multistream, signed webhook timestamp/replay protection, suspend/terminate, separately quarantined replay, and no viewer secret exposure are code-complete. Staging must prove real ingest/playback, webhook delivery, moderation-target behavior, measured suspension/recovery, replay handoff/release, provider account acceptance, and rollback before `staging-approved`. |
| Payment evidence | Helius | candidate | Devnet/staging webhook, scoped watched addresses/references, signature/replay validation, confirmed payment fixture. |
| Onramp/funding | Embedded-wallet funding UI | candidate | User-controlled wallet funding, provider KYC handled by provider, no entitlement on funding completion. |
| Subscriptions/allowances | Canonical Solana Subscription Delegation Program recurring delegation, `@solana/subscriptions` `0.5.0` + `@solana/kit` `7.1.0` exact-pinned | candidate, `CODE_COMPLETE_PROVIDER_BLOCKED` | Code owns server-derived one-click setup, finalized on-chain account/transaction verification, exact direct creator/platform `transferRecurring` collection, reconciliation, first-payment activation, cancellation, creator offers, ops, and fail-closed provider config. Devnet/staging must still prove real embedded/external wallet setup, first collection, renewal, revoke, insufficient funds/grace/recovery, responsive UX, collector rotation, and rollback through `pnpm proof:subscriptions` before staging approval. |
| Commerce interoperability | `@solana-commerce/solana-pay` `0.1.1` | candidate; `CODE_COMPLETE_PROVIDER_BLOCKED` in Slice 06 | Exact pin, narrow codec, known-defect compatibility tests, unsafe-link rejection, API build/import proof, and exact multi-recipient backend verifier are code-complete. Staging must prove real devnet external/embedded-wallet deep link and QR behavior, mobile return behavior, package/account acceptance, security review, and rollback before `staging-approved`. |

No provider can be treated as launch-approved until its staging smoke, security review, account/terms review, and fallback/rollback notes are documented.

## Universal Account And Session Lock

One WeVid user owns one profile, one or more wallets with one primary wallet, and optional Supabase recovery identity, verification records, earning readiness, performer records, and organization memberships. Privy is the embedded-wallet UX; WeVid authenticates its Solana wallet signature and does not store a separate unverified Privy subject. Viewer, creator, buyer, performer, manager, and Enterprise participation are capabilities/relationships, never account types. Wallet and recovery-subject collisions fail closed; duplicate callbacks and link replays are idempotently rejected; email equality never silently merges users.

Privy mainstream entry and external-wallet entry both sign the normal domain-bound wallet challenge. The backend-issued WeVid session is the authorization authority after Step 1. The preferred target keeps the raw token only in a secure HttpOnly cookie and only a hash server-side, with rotation, revocation, device audit, and recent-auth step-up for high-risk wallet/recovery operations. Slice 00 documents this target; Slices 01–02 own remaining contract/runtime convergence.

Supabase Postgres, RLS, and selective Realtime remain core. Supabase Auth is optional recovery/linking, primarily for external-wallet-only users, and never a fourth onboarding step. A Privy user is not asked to repeat equivalent recovery setup.

## Official Docs Anchors

Before implementation, verify the latest official docs for each provider/API. The current June 2026 anchors are:

| Area | Official docs to verify |
| --- | --- |
| Fastify API schemas | `https://fastify.dev/docs/latest/Reference/Validation-and-Serialization` |
| Supabase Auth | `https://supabase.com/docs/guides/auth` |
| Supabase RLS | `https://supabase.com/docs/guides/database/postgres/row-level-security` |
| Supabase Realtime | `https://supabase.com/docs/guides/realtime` |
| Solana Pay | `https://docs.solanapay.com/` |
| Solana Pay transaction requests | `https://solana.com/docs/tools/solana-pay/quickstart/transaction-requests` |
| Solana Commerce Kit overview | `https://solana.com/docs/tools/commerce-kit` |
| Solana Commerce Kit source | `https://github.com/solana-foundation/commerce-kit` |
| Commerce Kit Solana Pay package | `https://github.com/solana-foundation/commerce-kit/tree/main/packages/solana-pay` |
| Solana Subscriptions overview | `https://solana.com/docs/payments/subscriptions/overview` |
| Solana Subscriptions fixed delegation | `https://solana.com/docs/payments/subscriptions/fixed-delegation` |
| Solana Subscriptions recurring delegation | `https://solana.com/docs/payments/subscriptions/recurring-delegation` |
| Solana Subscriptions plan | `https://solana.com/docs/payments/subscriptions/subscription-plan` |
| Helius webhooks | `https://www.helius.dev/docs/webhooks` |
| Bunny Stream auth/security | `https://docs.bunny.net/stream/authentication`, `https://docs.bunny.net/stream/security` |
| Bunny TUS uploads | `https://docs.bunny.net/stream/tus-resumable-uploads` |
| Bunny edge/API protection | `https://docs.bunny.net/shield/overview` |
| Livepeer JWT access | `https://docs.livepeer.org/developers/guides/access-control-jwt` |
| Livepeer React Player | `https://docs.livepeer.org/sdks/react/migration/3.x/Player` |
| Livepeer create/update/terminate stream | `https://docs.livepeer.org/api-reference/stream/create`, `https://docs.livepeer.org/api-reference/stream/update`, `https://docs.livepeer.org/api-reference/stream/terminate` |
| Livepeer webhooks and OBS | `https://docs.livepeer.org/developers/guides/setup-and-listen-to-webhooks`, `https://docs.livepeer.org/developers/guides/stream-via-obs` |
| Privy user authentication | `https://docs.privy.io/authentication/user-authentication/privy-auth` |
| Privy Solana setup | `https://docs.privy.io/recipes/solana/getting-started-with-privy-and-solana` |
| Privy external-wallet connectors | `https://docs.privy.io/wallets/connectors/setup/configuring-external-connector-wallets` |
| MCP authorization | `https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization` |
| MCP security best practices | `https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices` |
| OpenAI MCP/connectors | `https://developers.openai.com/api/docs/guides/tools-connectors-mcp` |
| OpenAI remote MCP server guide | `https://developers.openai.com/api/docs/mcp` |

Provider docs override assumptions in this ADR if an API has changed. Any changed provider behavior needs an ADR update before coding.

### MCP re-verification — 2026-08-24

Convergence 07 was re-checked against the official stable MCP `2025-11-25` authorization and
Streamable HTTP specifications, the official MCP security guidance, and current OpenAI remote MCP
and review guidance. The accepted implementation remains OAuth authorization-code plus S256 PKCE,
protected-resource discovery, exact redirect matching, resource/audience-bound short-lived bearer
tokens, no token passthrough, explicit scopes, per-request authorization, Origin validation,
standard structured tool results, accurate tool annotations, minimized results, and audit. The July
2026 MCP release candidate is not adopted while it remains non-final and lacks the required
supported-client staging proof. OpenAI-compatible remote usage remains unclaimed until the public
HTTPS staging matrix in `mcp-staging-proof.md` passes.

### MCP media handoff re-verification — 2026-08-24

Convergence 08 was re-checked against the official Bunny TUS upload documentation and the C2PA 2.2
specification. Bunny TUS authorization remains the documented SHA-256 signature over library id,
server-only API key, expiry, and video id. The returned client header set is limited to signature,
expiry, library id, and video id, and the provider-supported minimum one-hour expiry is used. The
API key, create-video response, and provider identifiers remain outside MCP audit output. C2PA
references are stored as bounded claims only: HTTPS references are restricted to C2PA-controlled
`c2pa.org` hosts, while WeVid/C2PA URNs use opaque terminal identifiers. WeVid does not represent
an unverified reference as a validated manifest or trust decision.

Official anchors:

- `https://docs.bunny.net/stream/tus-resumable-uploads`
- `https://c2pa.org/specifications/specifications/2.2/specs/C2PA_Specification.html`

This proof does not move Bunny beyond `candidate`. Real private storage, Stream/TUS, Shield,
webhook, deletion/recovery, account-terms, and rollback evidence remains required in staging.

## GStack Autonomy Decision

GStack can improve workflow quality, but it will not make the project safely autonomous by itself.

Use GStack for:

- planning review
- architecture critique
- design review
- QA review
- security/release review
- focused code-review lanes

Do not allow GStack or any agent to override:

- this provider ADR
- OpenAPI contracts
- database migrations
- tests
- official provider docs
- security and adult-compliance requirements

Expected autonomy model:

```text
Human sets slice goal
  -> agent reads docs/contracts/ADR
  -> agent implements one vertical slice
  -> agent runs checks/tests
  -> agent reports risks
  -> human reviews irreversible/provider/security decisions
```

## Embedded Wallet And Funding

### Recommendation

Use Privy as the launch embedded-wallet provider if staging checks confirm:

- fully user-controlled/noncustodial Solana wallet flow works cleanly
- the secondary secure-wallet action can create or load a wallet through the provider-owned email/social/passkey surface before age verification
- external wallets can be used alongside embedded wallets
- onramp/funding sends funds to the user wallet, not a Veel custodial balance
- explicit user approval is enforced for money actions
- wallet export/recovery posture is acceptable
- pricing is acceptable at expected MAU and transaction volume

Use Turnkey as fallback or second ADR if:

- Privy cannot meet Solana, export/recovery, onramp, audit, or regional requirements
- deeper policy controls and sub-organization isolation are required earlier than expected
- Turnkey staging UX remains acceptable as an explicit secondary secure-wallet path

### Rationale

Privy is the launch embedded-wallet provider, but not the primary landing action. Users who explicitly choose `Create secure WeVid wallet` should get a user-controlled Solana wallet through Privy's provider-owned email/social/passkey surface without installing a browser extension. Staging must verify Solana support, funding/onramp UX, export/recovery posture, external-wallet linking, pricing, and noncustodial user approval.

Turnkey remains the advanced fallback when stronger policy controls, sub-organization isolation, or deeper wallet governance is more important than the fastest consumer activation path.

### Rules

- The platform never holds user private keys.
- Backend never signs product purchases for users.
- Wallet funding/onramp provider delivers funds to the user wallet only.
- Funding completion is not product checkout, payment proof, subscription renewal, or entitlement proof.
- A top-up is not a purchase and never grants entitlement by itself.
- Product purchase still requires a payment intent and backend-confirmed settlement.
- Browser may receive only publishable wallet/onramp config.

## Payment And Subscription Settlement

### One-Time Products

Use Solana transaction-request architecture for:

- support
- content unlocks
- creator media offers and accepted structured requests
- live passes
- Event Access Passes

Support does not unlock content by default, but it still affects creator earning records, platform revenue, optional referral commission, compliance ledger, receipt, and audit/accounting. It must still be backend-verified. If Helius webhook cost becomes high, support can use batched reconciliation or RPC fallback, but frontend wallet success is not final financial truth.

### Subscriptions

Use one recurring authorization/collection architecture for:

- platform plans
- Profile Memberships

Recommended path:

1. Use the official recurring-delegation primitive, not the on-chain merchant-plan primitive, so WeVid can preserve its backend-owned product/access policy and exact direct creator/platform split without a custom contract or escrow.
2. Exact-pin `@solana/subscriptions` `0.5.0` and `@solana/kit` `7.1.0`; the canonical program ID is `De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44`. The audit baseline and post-audit release diff were reviewed on 2026-08-16; staging evidence remains mandatory.
3. A verified delegation is authorization only. The worker submits the first exact-split collection immediately, and only its finalized confirmation activates access.
4. Evaluate the completed adapter through the official program on devnet/staging with the repository proof command before changing provider state.
5. Keep manual Solana Pay renewal as recovery fallback only; it must not become the normal subscription product path.
6. Do not use merchant checkout, card billing, custodial subscription balances, or provider-operated product subscriptions.

Platform plan tiers:

```text
Free
  free 18+ verified account
  wallet, free Bits/teasers, basic social/media participation
  reporting/blocking and safe discovery controls

Plus
  recommended launch target: 8.99 USDC/month, 89 USDC/year, or local equivalent
  higher fair-use watch allowance / bandwidth fairness
  better collections, activity, notifications, feed controls, and priority support
  no feed ranking boost, Mutuals boost, or message priority
  still pays creators separately unless a documented bundle exists

Ultra
  recommended launch target: 17.99 USDC/month, 179 USDC/year, or local equivalent
  highest configured public viewing allowance and playback convenience
  no feed ranking boost, Mutuals boost, or message priority

Studio
  recommended launch target: 29 USDC/month, 290 USDC/year, or local equivalent
  creator dashboard upgrades, scheduling, advanced analytics, pricing presets, Event Access tools
  KYC/KYB, wallet, and tax setup
  AI setup assistant where enabled
  not a hidden ranking boost and not a substitute for Profile Memberships

Enterprise
  custom, from 199 USDC/month equivalent
  organization, agency, venue, KYB, RBAC, consolidated reporting, and business support tier
```

Profile Memberships:

- Viewer pays monthly to a creator profile.
- Backend owns entitlement scope.
- Profile Membership should not replace paid unlocks or free Bits; it complements them.
- The same delegated authorization engine should power platform plans and Profile Memberships.

Subscriber benefits should be simple and conversion-friendly:

- subscriber badge on creator profile/comments
- subscriber-only posts or full clips where creator chooses
- discounted unlocks or included monthly unlock allowance if creator config allows it
- live pass discount or subscriber live chat access where creator enables it
- clearly labeled member-only media offers if creator enables them; no payment-based message or social priority

Do not hide all good creator content behind memberships. The product needs free Bits/teasers and public profile content for discovery. Memberships should reward recurring fans, not make the platform feel locked by default.

## Media Playback Strategy

This ADR does not replace the implementation-specific Bunny/Livepeer playback decision. It defines what “strategy” means:

- whether playback access is enforced by provider token/JWT, API gating, or both
- where token/signing keys live
- token lifetime
- how entitlement refresh works
- failure behavior when provider access check fails
- whether teaser/full playback use separate assets or same asset with provider restriction

Recommended default:

- Bunny VOD: backend-issued signed/tokenized playback is mandatory for full locked content; public or short-lived safe teaser playback is allowed.
- Livepeer: JWT playback policy is mandatory from day one for paid/pass-gated streams and paid replay assets.
- Frontend should use official provider players/components where they fit the UX, then wrap them in Veel UI primitives. Do not build custom playback engines.

Token/lifetime defaults must be configurable by environment and admin policy. Admin can override env defaults for product policy without code deployment; environment remains the safe fallback when admin config is missing.

## Age Assurance And KYC/KYB

### Age Gate

Use a user-choice waterfall:

```text
1. Reusable age credential / Digital ID
2. Facial age estimation or other light/free age assurance
3. Free-tier document proof when reusable proof is unavailable
4. Regional non-doc or database check where supported
5. Manual review only when policy requires escalation
```

Launch posture:

- Didit, Yoti Digital ID, EUDI Wallet, and Scytales are reusable-first age-assurance candidates.
- Didit age estimation and Persona/Didit document proof are light/free fallback candidates when reusable proof is unavailable.
- Sumsub and Veriff are not default viewer-onboarding providers; keep them for creator/compliance escalation after privacy, security, procurement, and contract review.

Store only:

- provider
- provider reference
- status
- over-18 result
- jurisdiction/rule metadata
- timestamps
- audit references

Do not store raw face images, raw documents, or raw provider payloads in core DB unless legal/provider workflow requires it.

### Creator KYC/KYB

Default:

- ordinary users and ordinary creators do not need KYC/KYB beyond age gate
- admin can require KYC/KYB for high-risk creators, earning thresholds, suspicious activity, jurisdiction changes, or future legal policy

The schema must support enabling KYC/KYB for all earning creators later without redesign.

When KYC/KYB is required, use a cost-controlled waterfall:

```text
1. Reusable provider identity / reusable KYC / copied applicant where contract and consent allow it
2. Freemium or low-cost KYC/KYB check where coverage is adequate
3. Returning-user biometric/account-continuity check instead of repeated document upload
4. Full documentary KYC/KYB only for legal, fraud, merchant, Studio/enterprise, UBO, or provider-required escalation
```

Provider posture:

- Sumsub is the primary reusable KYC/KYB candidate because its official docs describe reusable identity/KYC and applicant-copy patterns.
- Veriff is a heavy KYC/KYB and returning-user biometric-authentication candidate, not a default shared reusable identity-wallet candidate.
- Didit and Persona are cost-control candidates where their current docs, pricing, regional coverage, webhook behavior, and data-retention terms fit the exact KYC/KYB use case.
- WeVid stores only normalized verification state and audit references; raw documents, selfies, registry files, UBO documents, biometric templates, and raw provider payloads remain provider-owned unless counsel approves a narrow exception.

## NSFW, Moderation, And Content Checks

Create/Edit must include:

- creator-selected NSFW/adult label
- content warning category
- paid/free/teaser access state
- optional event attachment only, not per-media Mutuals mode settings
- event fields: date/time, ticket amount/capacity, public sale or private request-to-join, digital live stream or physical location
- event type is `digital_live_stream` or `physical`
- map/location UX: browser geolocation with permission, manual place/street search, OSM-backed geocoding with production-safe caching/rate limits
- AI moderation placeholder
- manual admin review state

Moderation pipeline:

```text
Upload/create
  -> creator label
  -> automated policy scan if enabled
  -> admin queue when high risk or provider flags
  -> publish allowed only if policy passes
```

Live moderation:

- public live rooms can be monitored by provider events, chat reports, and admin tools
- private streams still need report/block/safety escalation
- do not store private stream content unless provider/legal policy explicitly requires recording

## Mutuals Product Decision

Mutuals should stay raw/simple at launch:

- user activates Mutuals mode from profile/settings
- creator media shows a Mutuals-active affordance when the creator has Mutuals enabled
- viewers see Mutuals actions only if they also enabled Mutuals
- eligible viewers press Show Interest / Not interested
- no advanced filters at launch
- Mutual only after backend-confirmed reciprocal interest
- Mutual chat lives in Messages
- limit active Mutuals/conversations to reduce ghosting and overwhelm
- gentle notifications, not spammy push pressure
- if a Mutual has no first reply within a configurable window, mark it as stale and nudge once
- if repeated Mutuals go stale, pause Mutuals until the user clears or responds to active Mutuals
- max active Mutuals defaults to 10 for launch; admin can tune it
- require explicit Mutuals conduct consent before activation
- payments support creators; payments do not buy people, Mutuals boosts, or message priority

Anti-misuse limits:

- daily Show Interest action limit
- active Mutual cap
- cooldown after mass rejections/reports
- block/report always visible
- no Mutuals gestures outside Mutuals mode

## Event Access Product Decision

Event creation is a Create/Edit toggle:

- title
- description
- date/time
- digital live stream or physical location
- pass count/capacity
- free/request-to-join/paid
- pass price
- direct purchase or precheck/approval mode

Event Access launch strategy:

- backend Event Access Pass entitlement is source of truth
- Solana payment settlement for paid access
- QR/access receipt generated from backend pass record
- compliance ledger and receipt/invoice determination are written before entitlement grant
- platform commission comes from split transaction
- Crossmint compressed NFT/SFT passes can be evaluated later for collectible or transferable access
- do not use an unproven Solana-only ticketing provider as launch-critical infrastructure without vendor due diligence
- NFT/token pass/ticketing is future ADR after provider/protocol proof

Reason: Solana-native NFT ticket platforms exist, but a proven API/provider path for Veel needs vendor validation. Internal Event Access entitlement + Solana settlement is faster, safer, lower-cost, and still noncustodial.

## Admin Dashboard Requirements

Admin must measure and operate:

- users and cohorts
- creator funnel
- age/KYC status
- content and moderation queues
- reports/blocks/safety actions
- media provider state
- live room state
- messages, creator media offers, and structured creator requests
- payments/unlocks/support
- memberships/platform plans
- referrals/commissions
- Event Access/check-ins/refunds
- Mutuals opt-ins/Mutuals/reports
- AI/MCP tool calls
- provider health
- webhook health
- queues/retries
- incident notes
- revenue and retention metrics

Every admin mutation requires:

- role/policy
- confirmation for risky actions
- audit event
- reversible state where possible

## References

- Privy funding overview: https://docs.privy.io/wallets/funding/overview
- Privy Solana funding: https://docs.privy.io/wallets/gas-and-asset-management/funding/prompting-users-to-fund/solana
- Turnkey embedded wallets: https://docs.turnkey.com/embedded-wallets
- Turnkey production checklist: https://docs.turnkey.com/production-checklist/embedded-wallet
- Turnkey fiat onramp: https://docs.turnkey.com/embedded-wallets/code-examples/fiat-on-ramp
- Solana Pay: https://solana.com/docs/payments/accept-payments/solana-pay
- Solana Subscriptions overview: https://solana.com/docs/payments/subscriptions/overview
- Bunny TUS uploads: https://docs.bunny.net/reference/tus-resumable-uploads
- Bunny Stream security/token authentication: https://docs.bunny.net/stream/security
- Livepeer JWT access control: https://docs.livepeer.org/developers/guides/access-control-jwt
- Yoti age verification: https://developers.yoti.com/age-verification/age-verification-introduction
- Sumsub reusable KYC: https://docs.sumsub.com/docs/reusable-kyc
- MCP authorization: https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization
- MCP security best practices: https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices
- OpenAI MCP/connectors: https://developers.openai.com/api/docs/guides/tools-connectors-mcp
- OpenAI remote MCP server guide: https://developers.openai.com/api/docs/mcp
