# Veel V2 Provider Map

Status: accepted
Scope: provider ownership, boundaries, integrations
Last updated: 2026-06-02
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

This map defines which provider does which job and what Veel owns. It exists to avoid custom infrastructure, duplicate adapters, and frontend-owned business truth.

## Provider Boundary Table

| Provider / System | Provider Job | Veel Backend Job | Browser Exposure | Required Proof |
| --- | --- | --- | --- | --- |
| Supabase Auth | identity/session/JWT | user policy, roles, account state | public anon key, session | verified JWT |
| Supabase Postgres | primary data store | schema, RLS, migrations, business transactions | only safe realtime/read channels | DB constraints + API policy |
| Supabase Realtime | selected realtime events | channel authorization, payload policy | scoped channel payloads | JWT + RLS/policy |
| Embedded wallet provider | noncustodial wallet UX | wallet link, payment intent, verification | publishable config only | provider proof + wallet address |
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
| Email/push provider | notifications | notification policy, templates, retries | no secrets | delivery status |
| OpenTelemetry/logging | observability | traces, logs, redaction | none | trace/log pipeline |

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
  -> grants entitlement / earning record / commission

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

## Required Provider Decisions Before Coding

- embedded wallet provider staging confirmation
- wallet funding path, if any
- age/KYC primary and fallback provider choice
- Livepeer JWT key management and TTL configuration
- Bunny signed/tokenized playback TTL configuration
- Helius webhook scoping strategy
