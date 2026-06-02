# ADR 0002: 2026 Provider Decisions For V2 Launch

Status: proposed
Scope: wallet, onramp, payments, subscriptions, media, live, age/KYC, AI, events
Last updated: 2026-06-03
Source of truth: proposal pending vendor/account checks

This ADR turns the v2 blueprint into concrete provider defaults for the first implementation pass. The goal is provider-first architecture with minimal custom infrastructure, low platform custody/regulatory exposure, and strong user conversion.

## Decision Summary

| Area | Launch recommendation | Reason |
| --- | --- | --- |
| Onboarding order | Identity + mandatory wallet path, then age verification, then protected app access | Keeps app fully 18+ while reducing wallet-install friction through embedded wallet. |
| Embedded wallet | Privy first, Turnkey as deeper-control fallback | Best consumer UX and built-in wallet funding/onramp path; Turnkey is stronger when we need full policy/sub-org control. |
| Onramp/funding | Embedded-wallet provider funding UI first | Platform does not handle card processing or custody; user funds their own wallet. |
| One-time payments | Solana Pay / Solana transaction requests | Noncustodial, wallet-approved, backend-verified. |
| Payment evidence | Helius scoped to money/access evidence, with RPC fallback | Cost-aware, not a broad firehose. |
| Platform subscriptions | Solana Subscriptions/Allowances once stable for product, otherwise provider checkout ADR | Native recurring/delegated payments are now a first-class Solana primitive, but need staging proof. |
| Creator subscriptions | Keep, but treat as creator fan-club access, not a replacement for discovery/unlocks | Supports creator recurring revenue without killing free discovery. |
| VOD | Bunny Stream/CDN/TUS | Direct uploads and playback provider infrastructure. |
| Live/replay | Livepeer with JWT playback access where protected | Provider-owned live infra and provider-enforced protected playback. |
| Age assurance | Yoti app/Digital ID first, Sumsub reusable/non-doc fallback, Persona documentary fallback | User choice, reusable/low-friction first, no raw identity data in core DB. |
| Creator KYC/KYB | Disabled by default except high-risk/admin-required creators; Sumsub primary candidate | Avoid unnecessary friction while keeping an easy switch for legal/risk expansion. |
| AI/MCP | Provider-agnostic LLM gateway with OpenAI-compatible adapter first | Avoid lock-in; all tools permission-scoped and audited. |
| Create flow | Raw/simple create: record/upload, essential edits, caption/#/@/location, NSFW label, optional event, monetisation, preview, publish | Avoids overbuilt editor while preserving creator conversion controls. |
| Dating | Profile/settings-owned explicit mode; not configured per Create draft | Dating appears on creator media only when profile mode is active and viewer also opted in. |
| Event tickets | Internal backend ticket entitlement + Solana Pay settlement first; NFT ticket ADR later | Proven, simple, noncustodial split settlement without premature custom smart contracts. |
| Event location | Browser geolocation with permission + manual OSM-backed place search | Free/low-cost launch UX without platform handling private location carelessly. |
| Share | Internal Veel share/repost/message has no referral commission; external share tab uses backend referral URL | Keeps social sharing clean while preserving referral attribution for off-platform conversion. |

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

- Solana embedded wallet support works cleanly with the app UX.
- Funding/onramp flow supports SOL/USDC destination funding.
- External wallet transfer/bridge flows work with Phantom/Solflare-style users.
- Export/recovery/user-control posture is acceptable.
- Pricing is acceptable at expected MAU.

Use Turnkey as fallback or second ADR if we need:

- deeper noncustodial policy controls
- sub-organization-level wallet ownership
- hardware enclave posture
- custom transaction-policy enforcement
- business/shared wallets

### Rationale

Privy’s docs describe wallet funding with fiat onramps and wallet/bridge transfers, including funding Solana wallets with SOL. This aligns with user-friendly self-funding while keeping the platform out of fiat custody and card processing.

Turnkey’s docs show a stronger infrastructure-oriented model: embedded wallets, Solana accounts, user-controlled/noncustodial options, sub-organizations, policy controls, and a MoonPay onramp helper. It is excellent, but likely more custom work than needed for the first consumer launch.

### Rules

- The platform never holds user private keys.
- Backend never signs product purchases for users.
- Onramp provider delivers funds to the user wallet.
- A top-up is not a purchase and never grants entitlement by itself.
- Product purchase still requires a payment intent and backend-confirmed settlement.
- Browser may receive only publishable wallet/onramp config.

## Payment And Subscription Settlement

### One-Time Products

Use Solana transaction-request architecture for:

- tips
- support
- paid unlocks
- paid messages
- live passes
- event tickets
- creator drops

Tips do not unlock content, but they still affect creator balance, platform revenue, optional referral commission, and audit/accounting. They should still be backend-verified. If Helius webhook cost becomes high, tips can use batched reconciliation or RPC fallback, but frontend wallet success is not final financial truth.

### Subscriptions

Use one billing architecture for:

- platform subscription tiers
- creator profile subscriptions

Recommended path:

1. Evaluate Solana Subscriptions/Allowances in staging.
2. If stable and wallet UX is acceptable, use it for native recurring billing.
3. If not ready, use a provider checkout adapter only for subscriptions while keeping internal subscription state backend-owned.

Platform subscription tiers:

```text
Free
  limited teaser/free-watch allowance
  basic social/media participation

Heavy viewer
  higher watch allowance / bandwidth fairness
  smoother media and message experience
  still pays creators separately unless product decides otherwise

Premium
  advanced dating/events/AI profile features
  enhanced discovery/profile tools
  possible lower platform fees or bonus limits if business model supports it
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

- Bunny VOD: backend-issued signed/tokenized playback for full locked content; public or short-lived safe teaser playback.
- Livepeer: JWT playback policy for protected streams/assets where live/replay is paid or pass-gated.
- Frontend should use official provider players/components where they fit the UX, then wrap them in Veel UI primitives. Do not build custom playback engines.

Before implementation, confirm with the product owner:

1. Should locked Bunny full playback always require signed/tokenized URLs?
2. Should free teaser media be public CDN or signed short-lived CDN?
3. Should paid Livepeer streams use JWT access control from day one?
4. How long should playback tokens live before refresh?

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
- admin can require KYC/KYB for high-risk creators, payout thresholds, suspicious activity, jurisdiction changes, or future legal policy

The schema must support enabling KYC/KYB for all earning creators later without redesign.

## NSFW, Moderation, And Content Checks

Create/Edit must include:

- creator-selected NSFW/adult label
- content warning category
- paid/free/teaser access state
- optional event attachment only, not per-media Dating Mode settings
- event fields: date/time, ticket amount/capacity, public sale or private request-to-join, online/physical location
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
- location or online
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
- Livepeer JWT access control: https://docs.livepeer.org/developers/guides/access-control-jwt
- Yoti age verification: https://developers.yoti.com/age-verification/age-verification-introduction
- Sumsub reusable KYC: https://docs.sumsub.com/docs/reusable-kyc
