# Veel V2 Product Flows

Status: accepted
Scope: product workflows
Last updated: 2026-06-03
Source of truth: yes

Owns:
- product flows decisions for its named domain

Defers to:
- INDEX.md, route-map.md, OpenAPI, schema blueprint, and ADRs where narrower

Does not own:
- unrelated domains, implementation shortcuts, provider secrets, or hidden source-of-truth rules

Launch scope:
- accepted v2 launch or phased behavior stated in this document

Non-goals:
- historical-context inference, duplicate systems, and unapproved provider/product expansion

## Flow Principles

- Critical actions require visible controls and confirmation.
- Gestures are shortcuts, never the only way to spend, publish, match, report, or unlock.
- All business outcomes are backend-derived.
- Frontend can show pending UI, but backend decides final truth.

## Auth And Access Flow

```mermaid
sequenceDiagram
  participant User
  participant Web as Next.js PWA
  participant Auth as Supabase Auth
  participant API as Fastify API
  participant DB as Postgres
  participant Age as Age/KYC Provider

  User->>Web: Open app
  Web->>Auth: Get session
  Auth-->>Web: JWT or anonymous
  Web->>API: GET /me with JWT
  API->>DB: Load user, profile, wallet, age state
  API-->>Web: Safe app session
  alt Age required
    Web->>API: Start age check
    API->>Age: Create provider session
    Age-->>API: Session reference
    API-->>Web: Provider-safe next action
    Age->>API: Signed webhook result
    API->>DB: Store minimal result + audit
  end
```

Rules:

- Supabase Auth identifies the user.
- Fastify maps identity to Veel profile, mandatory age gate, wallet, monetisation, and permissions.
- Protected app access requires age verified and a wallet path: external wallet linked or embedded noncustodial wallet created/loaded.
- KYC/KYB is separate from normal viewing age access.
- Onboarding order is strict:
  1. identity choice creates the user session
  2. wallet path is created or linked immediately: embedded wallet for email/social/passkey, or native external wallet for wallet-first users
  3. age verification completes the app gate
  4. protected app access opens
- External wallet is not mandatory at signup. Mainstream users can enter with email/social/passkey and receive a user-controlled embedded wallet before age verification and protected app access.

## Wallet Onboarding Flow

```mermaid
flowchart TD
  Entry["Open Veel"] --> AuthChoice["Choose email/social/passkey or external wallet"]
  AuthChoice --> Mainstream["Email/social/passkey"]
  AuthChoice --> Native["External wallet connect"]
  Mainstream --> Profile["Create Veel profile"]
  Profile --> Embedded["Create/load noncustodial embedded wallet"]
  Native --> Challenge["Wallet challenge/signature"]
  Challenge --> Link["Link external wallet"]
  Embedded --> WalletReady["Wallet path ready"]
  Link --> WalletReady
  WalletReady --> Age["Third-party age verification"]
  Age --> AppAccess["Protected app access"]
  AppAccess --> Paywall["Paid action"]
  Paywall --> Topup["Top-up if needed"]
  Topup --> Intent["Backend payment intent"]
```

Rules:

- wallet path must exist before protected app access
- onramp funds the user wallet, not a Veel custodial balance
- payment/access still goes through backend-created intent and verified settlement
- user can choose embedded wallet or linked external wallet as primary

## Home And Media Discovery

Home is mixed media:

- followed creators
- recommended media
- clips
- bits
- pictures
- live rooms
- replays
- premium teasers

Bits is immersive vertical media.

Discover is search/explore.

Source context rule:

- Home-origin media keeps Home active.
- Bits-origin media keeps Bits active.
- Public creator profile does not activate own Profile nav.

## Create/Edit Media

```mermaid
flowchart TD
  Draft["Create draft"] --> UploadIntent["Backend upload intent"]
  UploadIntent --> ProviderUpload["Direct Bunny TUS / Livepeer flow"]
  ProviderUpload --> ProviderWebhook["Provider webhook/status refresh"]
  ProviderWebhook --> Ready["Asset ready"]
  Ready --> Metadata["Caption, hashtags, mentions, thumbnail, teaser"]
  Metadata --> Access["Visibility + monetisation"]
  Access --> Review["Safety/moderation checks"]
  Review --> Publish["Publish"]
```

Create MVP is intentionally raw and simple:

1. Record or upload media.
2. Edit essentials:
   - trim/crop where provider/browser support is simple
   - choose thumbnail/frame
   - if video is longer than Bit length, choose the free Bit/teaser segment
3. Add caption:
   - caption text
   - hashtags `#`
   - mentions `@`
   - optional location
4. Label and attach:
   - required NSFW/adult/sensitive label
   - optional event toggle
   - no dating toggle; Dating Mode is enabled from profile/settings and appears on eligible creator media automatically
5. Monetisation:
   - free
   - teaser + content unlock
   - subscriber/pass where relevant
   - tip/support enabled
6. Preview.
7. Publish or submit for review if moderation requires it.

Not MVP:

- CapCut-level timeline editor
- client-owned video processing
- direct provider object creation from frontend
- unlicensed music uploads as a platform-provided feature
- dating controls inside Create

Location UX:

- use browser geolocation only after explicit user permission
- allow manual street/place search for users who do not want location detection
- use OpenStreetMap-backed geocoding for launch, with public Nominatim limited to light dev/test and a hosted or self-hosted geocoder for production scale
- store normalized place label, coarse coordinates when needed, and provider/place reference; do not expose precise private location without explicit user intent
- cache geocode results and rate-limit autocomplete/reverse geocoding
- complex multi-track editing

## Paid Unlock Flow

```mermaid
sequenceDiagram
  participant Web
  participant API
  participant Wallet
  participant Solana
  participant Helius
  participant DB

  Web->>API: POST /payment-intents
  API->>DB: Create/reuse intent + splits + reference
  API-->>Web: Intent
  Web->>API: GET /payment-intents/:id/transaction-request
  API-->>Web: Solana Pay transaction request
  Web->>Wallet: Approve transaction
  Wallet->>Solana: Submit transaction
  Wallet-->>Web: Signature
  Web->>API: POST submitted signature
  API->>Solana: Optional scoped RPC confirmation
  Helius->>API: Confirmed payment webhook
  API->>API: Validate mandatory facts
  API->>DB: Settlement + entitlement + audit
  Web->>API: Refresh access state
```

Access is granted only after backend verification.

## Tips And Support

Tips/support do not unlock content by themselves. They still require:

- backend-created intent
- backend-computed splits
- wallet approval
- confirmed settlement for financial records
- audit trail

For low-cost microtips, v2 can use:

- immediate `submitted` UX after wallet signature
- scoped RPC confirmation for the submitted signature
- Helius/reconciliation for final evidence

Do not let frontend mark creator earning records, platform revenue, or referral commission final.

If the user has an embedded wallet with insufficient balance, the same sheet should offer top-up through the selected user-wallet funding path and then return to the pending tip/support intent. The funding session itself is not payment proof and must not be product checkout.

## Referral Flow

```mermaid
flowchart LR
  Share["External share"] --> Token["Referral token"]
  Token --> Click["Click attribution"]
  Click --> Signup["Signup/login/wallet"]
  Signup --> PaidAction["Paid action"]
  PaidAction --> Eligibility["Backend eligibility"]
  Eligibility --> Commission["Commission state"]
  Commission --> Audit["Audit trail"]
```

Rules:

- Internal DM share does not create commission by default.
- External invite/referral token can create attribution.
- Self-referral blocked.
- Duplicate commission blocked.
- Commission linked to payment intent and settlement.

## Live Room Flow

```mermaid
flowchart TD
  CreateRoom["Creator creates room"] --> Start["Creator starts session"]
  Start --> Livepeer["Backend creates Livepeer stream"]
  Livepeer --> Host["Creator receives host connection"]
  Livepeer --> Viewer["Viewer receives safe playback state"]
  Viewer --> Pass["Pass required?"]
  Pass --> Payment["Live pass payment"]
  Payment --> Access["Backend live access grant"]
  Access --> Chat["Playback + chat"]
  Start --> End["End live"]
  End --> Replay["Replay asset if available"]
```

Viewers never receive stream keys or ingest URLs.

## Messages Flow

Messages support:

- normal messages
- paid messages
- tips
- attachments
- block/report
- match/event contexts later

Realtime:

- backend writes message row
- Supabase Realtime notifies authorized clients
- RLS ensures participants only

## Events Flow

Events are content-attached conversion flows.

- creator attaches event config from Create/Edit:
  - title
  - description
  - date/time
  - ticket amount/capacity
  - public ticket sale or private request-to-join/apply
  - digital live stream or physical location
  - location selected through map/autodetect/manual search
- user opens ticket sheet
- wallet confirms payment if paid
- backend verifies payment
- backend grants ticket entitlement
- QR/receipt generated from backend ticket record

## Dating Flow

Dating is profile/settings-owned explicit mode.

- creator enables Dating Mode in profile/settings
- creator media shows a dating-active icon/badge when the creator is visible in Dating Mode
- viewers only see/use dating actions if they also enabled Dating Mode and accepted dating conduct rules
- dating feed only after opt-in
- left/right gestures or visible Yes/Not interested buttons are active on eligible creator media only inside Dating Mode
- match chat lives in Messages
- report/block/age gate required
