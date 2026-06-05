# ADR 0002: 2026 Provider Decisions For V2 Launch

Status: draft
Scope: wallet, onramp, payments, subscriptions, media, live, age/KYC, AI, events
Last updated: 2026-06-03
Source of truth: draft pending vendor/account checks

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
| Onboarding order | Identity + mandatory wallet path, then age verification, then protected app access | Keeps app fully 18+ while reducing wallet-install friction through embedded wallet. |
| Embedded wallet | Privy first, Turnkey as advanced policy fallback | Veel needs noncustodial Solana wallets, policy controls, external wallet support, auditability, and future AI/admin safety controls more than a lowest-code auth widget. |
| Onramp/funding | Embedded-wallet provider funding UI first, funding only | Platform does not handle card processing, merchant checkout, product billing, or custody; user funds their own wallet. |
| One-time payments | Solana Pay / Solana transaction requests | Noncustodial, wallet-approved, backend-verified. |
| Payment evidence | Helius scoped to money/access evidence, with RPC fallback | Cost-aware, not a broad firehose. |
| Platform plans | Solana Subscriptions/Allowances auto-renewal; manual Solana Pay recovery fallback only | Keeps plans recurring, noncustodial, revocable, and avoids merchant checkout, custodial balances, and provider-operated product billing. |
| Creator Memberships | Keep, but treat as creator fan-club access, not a replacement for discovery/unlocks | Supports creator recurring revenue without killing free discovery. |
| Creator pricing | Creator sets content unlock, paid message, live pass, Event Access Pass, and Creator Membership prices within admin/env guardrails | Preserves creator ownership while preventing abuse, too-low pricing, and compliance issues. |
| VOD | Bunny Stream/CDN/TUS | Direct uploads and playback provider infrastructure. |
| Live/replay | Livepeer with JWT playback access from day one for paid streams/replays | Provider-owned live infra and provider-enforced protected playback. |
| Age assurance | Yoti app/Digital ID first, Sumsub reusable/KYC fallback, Veriff age-assurance fallback, Persona documentary fallback only after privacy/procurement review | User choice, reusable/low-friction first, no raw identity data in core DB. |
| Creator KYC/KYB | Disabled by default except high-risk/admin-required creators; Sumsub primary candidate | Avoid unnecessary friction while keeping an easy switch for legal/risk expansion. |
| AI/MCP | Provider-agnostic LLM gateway with OpenAI-compatible adapter first | Avoid lock-in; all tools permission-scoped and audited. |
| Create flow | Raw/simple create: record/upload, essential edits, caption/#/@/location, NSFW label, optional event, monetisation, preview, publish | Avoids overbuilt editor while preserving creator conversion controls. |
| Mutuals | Profile/settings-owned explicit mode; not configured per Create draft | Mutuals appears on creator media only when profile mode is active and viewer also opted in. |
| Event Access | Internal backend QR/pass entitlement + Solana Pay settlement first; NFT/Solana pass ADR later | Proven, simple, noncustodial split settlement without premature custom smart contracts. |
| Event location | Browser geolocation with permission + manual OSM-backed place search | Free/low-cost launch UX without platform handling private location carelessly. |
| Share | Internal Veel share/repost/message has no referral commission; external share tab uses backend referral URL | Keeps social sharing clean while preserving referral attribution for off-platform conversion. |

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
| Embedded wallet fallback | Turnkey | candidate | Solana policy/MPC controls, signer UX, export/recovery, transaction policy, adult-platform account acceptance. |
| Wallet backup | Dynamic | candidate | Solana support, embedded + external wallet UX, funding path, mobile PWA, adult-platform account acceptance. |
| Age assurance | Yoti | candidate | 18+ flow, reusable Digital ID path, webhook verification, regional support, minimal-data storage. |
| Age/KYC fallback | Sumsub | candidate | Age/KYC/KYB levels, reusable verification support, webhook verification, creator KYC/KYB path. |
| Age fallback | Veriff | candidate | Global age assurance, risk-based checks, webhook verification, privacy/security review. |
| Documentary fallback | Persona | candidate | Procurement, privacy/security, data minimization, explicit legal basis for documentary fallback. |
| VOD | Bunny Stream/CDN/TUS | candidate | TUS upload, signed/tokenized playback, webhook idempotency, provider outage state. |
| Live/replay | Livepeer JWT | candidate | Stream creation, JWT playback, replay handoff, no viewer stream-key exposure. |
| Payment evidence | Helius | candidate | Devnet/staging webhook, scoped watched addresses/references, signature/replay validation, confirmed payment fixture. |
| Onramp/funding | Embedded-wallet funding UI | candidate | User-controlled wallet funding, provider KYC handled by provider, no entitlement on funding completion. |
| Subscriptions/allowances | Solana Subscription Delegation Program | candidate | Devnet/staging authority setup, revoke, collection, wallet UX, token support, unsafe-extension rejection, event/reconciliation fixtures, direct recipient settlement, cancellation, no custody, no merchant checkout. |

No provider can be treated as launch-approved until its staging smoke, security review, account/terms review, and fallback/rollback notes are documented.

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

Provider docs override assumptions in this ADR if an API has changed. Any changed provider behavior needs an ADR update before coding.

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
- email/social/passkey onboarding can create or load the wallet before age verification
- external wallets can be used alongside embedded wallets
- onramp/funding sends funds to the user wallet, not a Veel custodial balance
- explicit user approval is enforced for money actions
- wallet export/recovery posture is acceptable
- pricing is acceptable at expected MAU and transaction volume

Use Turnkey as fallback or second ADR if:

- Privy cannot meet Solana, export/recovery, onramp, audit, or regional requirements
- deeper policy controls and sub-organization isolation are required earlier than expected
- Turnkey staging UX remains acceptable for mainstream email/social/passkey users

### Rationale

Privy is the launch default because consumer onboarding speed is a primary conversion risk: email/social/passkey users should get a user-controlled Solana wallet without installing a browser extension. Staging must verify Solana support, funding/onramp UX, export/recovery posture, external-wallet linking, pricing, and noncustodial user approval.

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
- paid messages
- live passes
- Event Access Passes

Support does not unlock content by default, but it still affects creator earning records, platform revenue, optional referral commission, compliance ledger, receipt, and audit/accounting. It must still be backend-verified. If Helius webhook cost becomes high, support can use batched reconciliation or RPC fallback, but frontend wallet success is not final financial truth.

### Subscriptions

Use one recurring authorization/collection architecture for:

- platform plans
- Creator Memberships

Recommended path:

1. Build delegated subscription authorization, recurring collection state, cancellation, revoke tracking, and worker scheduling as the subscription foundation.
2. Evaluate Solana Subscriptions/Allowances through the official Subscription Delegation Program in staging.
3. Keep manual Solana Pay renewal as recovery fallback only; it must not become the normal subscription product path.
4. Do not use merchant checkout, card billing, custodial subscription balances, or provider-operated product subscriptions.

Platform plan tiers:

```text
Free Verified
  free 18+ verified account
  wallet, free Bits/teasers, basic social/media participation
  reporting/blocking and safe discovery controls

Veel Plus
  recommended launch target: 8.99 USDC/month, 89 USDC/year, or local equivalent
  higher fair-use watch allowance / bandwidth fairness
  better collections, activity, notifications, feed controls, and priority support
  no feed ranking boost, Mutuals boost, or message priority
  still pays creators separately unless a documented bundle exists

Veel Studio
  recommended launch target: 29 USDC/month, 290 USDC/year, or local equivalent
  creator dashboard upgrades, scheduling, advanced analytics, pricing presets, Event Access tools
  KYC/KYB, wallet, and tax setup
  AI setup assistant where enabled
  not a hidden ranking boost and not a substitute for Creator Memberships

Enterprise
  custom, from 199 USDC/month equivalent
  organization, agency, venue, KYB, RBAC, consolidated reporting, and business support tier
```

Creator Memberships:

- Viewer pays monthly to a creator profile.
- Backend owns entitlement scope.
- Creator Membership should not replace paid unlocks or free Bits; it complements them.
- The same delegated authorization engine should power platform plans and Creator Memberships.

Subscriber benefits should be simple and conversion-friendly:

- subscriber badge on creator profile/comments
- subscriber-only posts or full clips where creator chooses
- discounted unlocks or included monthly unlock allowance if creator config allows it
- live pass discount or subscriber live chat access where creator enables it
- clearly labeled member-only paid-message access if creator enables it; no paid message priority ranking

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
1. Reusable app credential / Digital ID
2. Reusable KYC network / reusable identity
3. Non-doc or database check where supported
4. Facial age estimation
5. Documentary verification only when required
```

Launch posture:

- Yoti app/Digital ID or Yoti age session as primary reusable/user-choice lane.
- Sumsub reusable KYC / Sumsub ID / non-doc verification as fallback.
- Persona as documentary fallback where Yoti/Sumsub coverage is weak.

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

## NSFW, Moderation, And Content Checks

Create/Edit must include:

- creator-selected NSFW/adult label
- content warning category
- paid/free/teaser access state
- optional event attachment only, not per-media Dating Mode settings
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
- messages/paid messages
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
