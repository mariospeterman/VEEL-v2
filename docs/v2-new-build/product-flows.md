# Veel V2 Product Flows

Status: proposed v2 architecture
Scope: product workflows
Last updated: 2026-06-01
Source of truth: proposal

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
- Fastify maps identity to Veel profile, age gate, wallet, monetisation, and permissions.
- KYC/KYB is separate from normal viewing age access.
- External wallet is not mandatory at signup. Mainstream users can enter with email/social/passkey and receive a user-controlled embedded wallet before the first wallet-required action.

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
  Embedded --> Session["Safe session payload"]
  Link --> Session
  Session --> Paywall["First paid action"]
  Paywall --> Topup["Top-up if needed"]
  Topup --> Intent["Backend payment intent"]
```

Rules:

- wallet can be created lazily before the first wallet-required action if provider cost requires it
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

Create MVP:

- upload/capture
- caption
- hashtags/mentions
- sound/music metadata if available
- crop/trim
- text overlay
- thumbnail/frame
- teaser range
- visibility/access
- monetisation toggle
- optional dating enable
- optional event attach
- publish/review

Not MVP:

- CapCut-level timeline editor
- client-owned video processing
- direct provider object creation from frontend

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

Do not let frontend mark creator balance or referral commission final.

If the user has an embedded wallet with insufficient balance, the same sheet should offer top-up through the selected onramp provider and then return to the pending tip/support intent. The onramp session itself is not payment proof.

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
- GIFs if provider configured
- block/report
- match/event contexts later

Realtime:

- backend writes message row
- Supabase Realtime notifies authorized clients
- RLS ensures participants only

## Events Flow

Events are content-attached conversion flows.

- creator attaches event config
- user opens ticket sheet
- wallet confirms payment if paid
- backend verifies payment
- backend grants ticket entitlement
- QR/receipt generated from backend ticket record

## Dating Flow

Dating is explicit mode.

- content-level dating enable
- dating feed only after opt-in
- left/right gestures only inside dating mode
- match chat lives in Messages
- report/block/age gate required
