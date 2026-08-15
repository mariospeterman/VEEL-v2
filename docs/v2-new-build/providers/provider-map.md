# WeVid V2 Provider Map

Status: accepted
Scope: provider ownership, boundaries, integrations
Last updated: 2026-08-15
Source of truth: yes for v2 provider relations

Owns:
- provider map decisions for its named domain

Defers to:
- INDEX.md, route-map.md, OpenAPI, schema blueprint, and ADRs where narrower

Does not own:
- unrelated domains, implementation shortcuts, provider secrets, or hidden source-of-truth rules

Launch scope:
- accepted v2 launch or phased behavior stated in this document

Non-goals:
- historical-context inference, duplicate systems, and unapproved provider/product expansion

This map defines which provider does which job and what WeVid owns. It exists to avoid custom infrastructure, duplicate adapters, and frontend-owned business truth.

## Provider Boundary Table

| Provider / System | Provider Job | WeVid Backend Job | Browser Exposure | Required Proof |
| --- | --- | --- | --- | --- |
| Supabase Auth | optional recovery/link identity | universal-user mapping, link intent, collision rejection, canonical app session | publishable key and optional recovery UI | both sessions + audited link; fail closed until proven |
| Supabase Postgres | primary data store | schema, RLS, migrations, business transactions | only safe realtime/read channels | DB constraints + API policy |
| Supabase Realtime | selected realtime events | channel authorization, payload policy | scoped channel payloads | JWT + RLS/policy |
| Privy | mainstream auth state and noncustodial/user-controlled embedded Solana wallet create/retrieve/recovery/export | universal-user mapping, normal wallet challenge, canonical session, linked/primary wallet, payment intent and settlement truth | publishable app id and official UI only | provider auth + backend-verified wallet signature; candidate until staging proof |
| External wallet adapters | wallet approval | server transaction request and verification | wallet connector UI | signed transaction |
| Solana RPC | transaction state | finality/amount/reference validation | browser-safe devnet RPC only if needed | confirmed transaction |
| Helius | payment/access evidence | normalize/verify event, dedupe, audit | none | signed/authorized webhook or API response |
| Bunny Stream/CDN/TUS | VOD upload/transcode/playback | content state, access policy, signed/safe playback | safe upload/playback data | provider webhook/status |
| Livepeer | live streaming/replay infra | room policy, host/viewer split, pass access | playback-safe viewer resource | provider webhook/status |
| Didit/Yoti/EUDI/Scytales | reusable/light age assurance | session creation, minimal result storage | provider redirect/widget/link only | signed notification/result |
| Persona/Didit | light document age fallback and cost-control KYC/KYB candidate | inquiry/session mapping, minimal state | provider redirect/widget only | signed webhook/result |
| Sumsub | reusable KYC/KYB and creator compliance candidate | reusable identity, copied applicant, applicant/session mapping, minimal state | provider redirect/widget only | signed webhook/result |
| Veriff | creator KYC/KYB heavy fallback and returning-user biometric candidate | applicant/session mapping, minimal state | provider redirect/widget only | signed webhook/result |
| Wallet funding/onramp | user-owned wallet funding only | start session, show funding state | funding widget/session only | provider callback for funding status only |
| Solana Commerce Kit, selected package only | standards-compliant Solana Pay URL encode/parse and QR/deep-link interoperability through `@solana-commerce/solana-pay` | payment intents, immutable prices/recipients/splits, checkout capability, transaction composition, exact settlement verification, receipts, domain outcome, and unified checkout policy | WeVid checkout UI and wallet handoff only; no raw package/provider payload | `candidate` for Slice 06; exact `0.1.1` baseline reviewed, exact version and upstream source must be re-verified and pinned before installation |
| Email/push provider | notifications | notification policy, templates, retries | no secrets | delivery status |
| OpenTelemetry/logging | observability | traces, logs, redaction | none | trace/log pipeline |
| WeVid-native physical commerce | no external commerce engine; WeVid Product Offers plus lightweight Orders/Fulfillment | seller eligibility, catalog, attachment, stock reservation, immutable order/shipping snapshot, payment linkage, fulfillment, refunds/disputes, moderation, privacy, audit, and frontend-safe projections | profile/content-native product detail, checkout, and order status | DEFERRED post-core; no schema, routes, SDK, or runtime in Launch 01; policy/legal/operations gates required |

Turnkey is an unbundled embedded-wallet fallback only. It has no parallel login, wallet UI, or runtime. Indexed PostgreSQL is the initial search authority. Transactional email, web push, and OpenTelemetry remain adapter boundaries; managed providers are selected and proven in their owning deployment slice rather than replaced by custom infrastructure.

Verification remains one provider-neutral domain with one configured primary and at most one documented fallback per purpose. Ordinary users never choose among providers. Age access, adult-publisher eligibility, creator KYC, organization KYB, and performer verification remain separate policy purposes; KYC/KYB are not universal onboarding. Moderation combines proven provider-native upload signals, a trusted illegal-content hash provider, lightweight local routing, a specialist classifier for uncertain/high-risk material, and human review for consequential decisions. A general VLM is not run over every frame, local nudity scores do not prove legality, and AI alone cannot impose permanent sanctions.

## Payment Provider Relations

```text
Frontend
  -> requests payment intent from API
  -> opens wallet approval
  -> never computes final split or entitlement

API
  -> computes amount, recipients, splits, reference, memo
  -> builds transaction request
  -> verifies confirmed transaction facts
  -> grants the domain outcome: receipt, entitlement, Event Access Pass, message delivery, or paid order

Helius/RPC
  -> supplies confirmed transaction evidence
  -> does not decide business outcome
```

## Media Provider Relations

```text
VOD:
  API -> Bunny create video object
  Browser -> Bunny TUS upload with safe credentials
  Bunny -> API webhook/status
  API -> frontend-safe media resource

Live:
  API -> Livepeer create stream
  Creator endpoint -> masked host connection
  Viewer endpoint -> playback-safe data only
  Livepeer -> API stream/replay webhook
```

## Identity Provider Relations

```text
Age gate:
  API -> provider session
  User -> provider verification
  Provider -> API webhook/result
  API -> minimal over-18/access state

KYC/KYB for earning:
  API -> provider session
  Creator -> provider verification
  Provider -> API webhook/result
  API -> earning compliance state
```

## Provider Selection Principles

- Choose one primary provider per job at launch.
- Keep an adapter boundary, but do not create speculative multi-provider systems until a second provider is real.
- Use official SDKs/APIs where they reduce custom code.
- Provider raw payloads are stored only when needed for reconciliation and are never returned to normal frontend responses.
- Every provider callback is authenticated, idempotent, replay-safe, and audited.
- Provider outage behavior must be visible in admin/ops and recoverable in user UI.
- Prefer one primary provider, one documented fallback, and one canonical adapter. A new provider decision must identify the obsolete path it replaces.
- WeVid custom code is reserved for product authority: universal capabilities, onboarding orchestration, payment/split/settlement verification, entitlements, native Product Offers and lightweight Orders/Fulfillment, social/feed policy, Mutuals consent, performer consent, moderation/HITL policy, Event Access, and product UI/analytics. Providers own commodity identity checks, key storage, Solana Pay interoperability, encoding/CDN, live ingest/transcoding, delivery infrastructure, and managed observability storage.

## Required Provider Decisions Before Coding

- embedded wallet provider staging confirmation
- wallet funding path, if any
- age/KYC primary and fallback provider choice
- Livepeer JWT key management and TTL configuration
- Bunny signed/tokenized playback TTL configuration
- Helius webhook scoping strategy
