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
| Platform subscriptions | Solana Subscriptions/Allowances target; manual Solana Pay renewal fallback until staging approval | Keeps subscriptions noncustodial and avoids merchant checkout, custodial balances, and provider-operated product billing. |
| Creator subscriptions | Keep, but treat as creator fan-club access, not a replacement for discovery/unlocks | Supports creator recurring revenue without killing free discovery. |
| Creator pricing | Creator sets content unlock, paid message, live pass, ticket, and creator subscription prices within admin/env guardrails | Preserves creator ownership while preventing abuse, too-low pricing, and compliance issues. |
| VOD | Bunny Stream/CDN/TUS | Direct uploads and playback provider infrastructure. |
| Live/replay | Livepeer with JWT playback access from day one for paid streams/replays | Provider-owned live infra and provider-enforced protected playback. |
| Age assurance | Yoti app/Digital ID first, Sumsub reusable/KYC fallback, Veriff age-assurance fallback, Persona documentary fallback only after privacy/procurement review | User choice, reusable/low-friction first, no raw identity data in core DB. |
| Creator KYC/KYB | Disabled by default except high-risk/admin-required creators; Sumsub primary candidate | Avoid unnecessary friction while keeping an easy switch for legal/risk expansion. |
| AI/MCP | Provider-agnostic LLM gateway with OpenAI-compatible adapter first | Avoid lock-in; all tools permission-scoped and audited. |
| Create flow | Raw/simple create: record/upload, essential edits, caption/#/@/location, NSFW label, optional event, monetisation, preview, publish | Avoids overbuilt editor while preserving creator conversion controls. |
| Dating | Profile/settings-owned explicit mode; not configured per Create draft | Dating appears on creator media only when profile mode is active and viewer also opted in. |
| Event tickets | Internal backend QR/ticket entitlement + Solana Pay settlement first; NFT/Solana ticketing ADR later | Proven, simple, noncustodial split settlement without premature custom smart contracts. |
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

- tips
- support
- content unlocks
- paid messages
- live passes
- event tickets

Tips do not unlock content, but they still affect creator earning records, platform revenue, optional referral commission, and audit/accounting. They should still be backend-verified. If Helius webhook cost becomes high, tips can use batched reconciliation or RPC fallback, but frontend wallet success is not final financial truth.

### Subscriptions

Use one billing architecture for:

- platform subscription tiers
- creator profile subscriptions

Recommended path:

1. Build manual Solana Pay renewal as the fallback subscription path when delegated subscriptions are not staging-approved.
2. Evaluate Solana Subscriptions/Allowances through the official Subscription Delegation Program in staging.
3. Use delegated recurring billing only after authority setup, revoke, collection, wallet UX, events, and reconciliation pass.
4. Do not use merchant checkout, card billing, custodial subscription balances, or provider-operated product subscriptions.

Platform subscription tiers:

```text
Free Verified
  free 18+ verified account
  wallet, free Bits/teasers, basic social/media participation
  reporting/blocking and safe discovery controls

Veel Plus
  recommended launch target: 15 USDC/month or local equivalent
  higher fair-use watch allowance / bandwidth fairness
  better collections, activity, notifications, feed controls, and priority support
  still pays creators separately unless a documented bundle exists

Veel Studio
  recommended launch target: 29 USDC/month or local equivalent
  creator dashboard upgrades, scheduling, advanced analytics, pricing presets, event tools
  AI setup assistant where enabled
  not a hidden ranking boost and not a substitute for creator subscriptions

Enterprise/Partner
  custom pricing
  creator/team/admin/business support tier, not ordinary viewer default
```

Creator subscriptions:

- Viewer pays monthly to a creator profile.
- Backend owns entitlement scope.
- Creator subscription should not replace paid unlocks or free Bits; it complements them.
- The same subscription engine should power platform and creator subscriptions.

Subscriber benefits should be simple and conversion-friendly:

- subscriber badge on creator profile/comments
- subscriber-only posts or full clips where creator chooses
- discounted unlocks or included monthly unlock allowance if creator config allows it
- live pass discount or subscriber live chat access where creator enables it
- priority paid-message response lane if creator enables it

Do not hide all good creator content behind subscriptions. The product needs free Bits/teasers and public profile content for discovery. Subscriptions should reward recurring fans, not make the platform feel locked by default.

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

## Dating Product Decision

Dating should stay raw/simple at launch:

- user activates Dating Mode from profile/settings
- creator media shows a dating-active affordance when the creator has Dating Mode enabled
- viewers see dating actions only if they also enabled Dating Mode
- eligible viewers swipe or press Yes / Not interested
- no advanced filters at launch
- match only after backend-confirmed mutual interest
- match chat lives in Messages
- limit active matches/conversations to reduce ghosting and overwhelm
- gentle notifications, not spammy push pressure
- if a match has no first reply within a configurable window, mark it as stale and nudge once
- if repeated matches go stale, pause Dating Mode until the user clears or responds to active matches
- max active matches defaults to 10 for launch; admin can tune it
- require explicit dating conduct consent before activation

Anti-misuse limits:

- daily yes-action limit
- active match cap
- cooldown after mass rejections/reports
- block/report always visible
- no dating gestures outside Dating Mode

## Events Product Decision

Event creation is a Create/Edit toggle:

- title
- description
- date/time
- digital live stream or physical location
- ticket count/capacity
- free/request-to-join/paid
- ticket price
- direct purchase or precheck/approval mode

Ticketing launch strategy:

- backend ticket entitlement is source of truth
- Solana payment settlement for paid tickets
- QR/receipt generated from backend ticket record
- platform commission comes from split transaction
- Crossmint compressed NFT/SFT ticketing can be evaluated later for collectible or transferable event tickets
- do not use an unproven Solana-only ticketing provider as launch-critical infrastructure without vendor due diligence
- NFT/token ticketing is future ADR after provider/protocol proof

Reason: Solana-native NFT ticket platforms exist, but a proven API/provider path for Veel needs vendor validation. Internal entitlement + Solana Pay settlement is faster, safer, lower-cost, and still noncustodial.

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
- payments/unlocks/tips/support
- subscriptions
- referrals/commissions
- event tickets/check-ins/refunds
- dating opt-ins/matches/reports
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
