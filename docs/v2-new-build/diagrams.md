# Veel V2 Render-Safe Diagrams

Status: accepted
Scope: full-platform diagrams
Last updated: 2026-06-03
Source of truth: yes for render-safe architecture diagrams

Owns:
- diagrams decisions for its named domain

Defers to:
- INDEX.md, route-map.md, OpenAPI, schema blueprint, and ADRs where narrower

Does not own:
- unrelated domains, implementation shortcuts, provider secrets, or hidden source-of-truth rules

Launch scope:
- accepted v2 launch or phased behavior stated in this document

Non-goals:
- historical-context inference, duplicate systems, and unapproved provider/product expansion

These diagrams use plain text so they render in Cursor, GitHub, terminals, and any Markdown preview without a Mermaid extension. Mermaid diagrams may still exist in detailed docs, but this file is the canonical render-safe diagram set.

## Full Platform

```text
User
  │
  ▼
Next.js PWA
  ├─ Landing, auth, age gate
  ├─ App shell: Home, Bits, Discover, Create, Messages, Profile
  ├─ Explicit modes: Mutuals, Event Access, AI assistant
  ├─ TanStack Query: server state cache
  ├─ Zustand/local state: sheets, panels, gestures, playback UI
  └─ Wallet layer: embedded wallet + external Solana wallets
        │
        ▼
Fastify TypeScript API
  ├─ OpenAPI/Zod contracts
  ├─ auth, profile, policy, roles
  ├─ payments, referrals, commissions, entitlements
  ├─ media, live, messages, engagement, safety
  ├─ Mutuals, Event Access, AI/MCP, admin/ops
  └─ idempotency + append-only audit
        │
        ├────────────────────────────┬────────────────────────────┐
        ▼                            ▼                            ▼
Supabase Platform                 Workers                      Providers
  ├─ Auth/JWT                       ├─ webhooks                  ├─ Solana RPC / Pay / Subs
  ├─ Postgres/RLS                   ├─ reconciliation            ├─ Helius payment evidence
  ├─ Realtime Broadcast             ├─ media status              ├─ embedded wallet provider
  └─ Storage only if needed         ├─ moderation                ├─ wallet funding path
                                    ├─ notifications             ├─ Bunny Stream/CDN/TUS
                                    └─ retry queues              ├─ Livepeer live/replay
                                                                 ├─ Didit/Yoti/EUDI/Scytales/Persona
                                                                 ├─ Sumsub/Veriff creator compliance
                                                                 └─ email/push/observability
```

## Provider Relations

```text
Fastify API is the business boundary.

Wallet provider
  -> creates/links noncustodial embedded wallet
  -> never grants access by itself

Solana Pay / Solana RPC
  -> wallet-approved payment transaction
  -> backend verifies signature, payer, recipient, amount, reference, finality

Helius
  -> confirmed payment/access evidence only
  -> scoped to treasury/recipient/reference where possible
  -> not a social/activity firehose

Bunny Stream/CDN/TUS
  -> VOD object, upload, transcode, thumbnail, playback
  -> backend issues upload/session/playback-safe data

Livepeer
  -> live stream infrastructure and replay handoff
  -> backend owns host authorization and viewer access

Age/KYC providers
  -> age gate and creator earning compliance checks
  -> backend stores minimal result, provider reference, timestamps, jurisdiction/rule

Onramp provider
  -> funds user wallet
  -> does not directly grant product entitlements
```

## Core Product Relations

```text
User
  ├─ profile
  ├─ wallets
  ├─ age verification state
  ├─ creator settings
  ├─ messages/conversations
  ├─ follows, likes, saves, comments, shares
  ├─ Mutuals profile and mutuals
  └─ purchases, passes, Event Access Passes, subscriptions

Creator/User
  ├─ content items
  │   ├─ media asset
  │   ├─ teaser/full access rules
  │   ├─ monetisation config
  │   └─ optional event attachment
  ├─ Mutuals profile/settings
  │   └─ media shows Mutuals-active affordance when profile mode is enabled
  ├─ live rooms
  ├─ subscriptions
  ├─ referrals
  └─ earning/KYC state

Money object
  ├─ payment intent
  ├─ transaction/reference/signature
  ├─ split recipients
  ├─ entitlement outcome
  ├─ referral/commission outcome
  └─ audit trail
```

## Payment And Entitlement Flow

```text
1. User taps Tip / Support / Unlock / Subscribe / Live Pass / Event Access Pass / Media offer / Accepted creator request
2. Frontend asks API for payment intent
3. API computes:
   - product type
   - amount/currency
   - creator share
   - platform share
   - optional referral share
   - recipient wallets
   - Solana reference and memo
4. Frontend opens wallet approval using server transaction request
5. Wallet submits transaction
6. Helius/webhook or RPC fallback confirms transaction facts
7. API validates mandatory facts
8. API records payment event idempotently
9. API grants entitlement if product unlocks access
10. API records commission and confirmed earning/revenue records where applicable
11. Frontend refreshes backend-confirmed state
```

## Media Lifecycle

```text
Create screen
  -> API validates creator, age, media policy, monetisation
  -> API creates content draft
  -> API creates Bunny video object for VOD
  -> Frontend uploads directly to Bunny TUS with safe credentials
  -> Bunny webhook/status refresh reaches worker/API
  -> API normalizes processing state
  -> moderation and access rules run
  -> frontend receives sanitized media resource
  -> viewer gets teaser or full playback based on backend entitlement
```

## Live Lifecycle

```text
Creator opens live room
  -> API authorizes creator
  -> API creates Livepeer stream
  -> creator receives masked host connection only in creator endpoint
  -> viewer endpoint receives playback-safe state only
  -> pass/content-unlock payment grants live entitlement
  -> chat uses backend/Supabase policy checks
  -> Livepeer webhook marks stream status
  -> replay asset becomes content/replay item after end
  -> viewer replay follows content access rules
```

## Age And KYC Waterfall

```text
Age gate for protected app/media/Mutuals/messages/wallet:
  1. Reusable age credential when supported
     - Didit reusable ID
     - Yoti Digital ID
     - EUDI wallet / Scytales connector where available
     - user may leave, create a reusable ID, then return to age check
  2. Light/free age assurance when reusable proof is unavailable
     - Didit/Yoti age estimation
     - Persona/Didit free-tier document proof
  3. Regional non-document/eID check where supported
  4. Manual review only if policy requires escalation

Studio / enterprise / creator KYC-KYB:
  - separate from ordinary viewer age gate
  - required before creator publishing or monetized creator workflows when policy requires it
  - reusable/provider-owned proof first:
      1. reusable KYC / copied applicant / reusable business applicant when consent and contract allow it
      2. freemium or low-cost KYC/KYB check
      3. returning-user biometric/account-continuity check
      4. full documentary KYC/KYB only for legal, fraud, UBO, merchant, or enterprise escalation
  - Sumsub reusable identity/KYC and Copy Applicant are primary candidates
  - Veriff belongs here as heavy documentary and returning-user biometric fallback, not default viewer onboarding

Creator earning / tax KYC:
  - separate from ordinary viewer age gate and creator age assurance
  - provider session/webhook result
  - minimal stored state
  - no raw biometric/document storage in core DB unless legally required
```

## Mutuals Mode Flow

```text
User opts into Mutuals
  -> age gate required
  -> explicit consent and safety copy
  -> profile/settings Mutuals enabled
  -> creator media shows Mutuals-active affordance to eligible viewers
  -> Mutuals feed shows eligible creator media
  -> Interested / Not interested actions create backend interest events
  -> mutual interest creates Mutual
  -> Mutual opens conversation in Messages
  -> report/block removes visibility and audits safety event
```

## Event Access Flow

```text
Creator attaches event to media
  -> event config: digital live stream or physical, title, date/time, Access Pass capacity, price/free, public/private
  -> event appears from media/event surfaces
  -> user opens Access Pass sheet
  -> paid Access Pass creates payment intent
  -> wallet approves noncustodial transfer
  -> backend verifies confirmed payment
  -> backend grants Event Access Pass entitlement and QR/receipt
  -> admin can inspect Access Pass, payment, check-in, refund/escalation state
```

## Admin, Ops, And AI/MCP

```text
Admin surface
  ├─ users, content, reports, blocks
  ├─ payments, unlocks, referrals, commissions
  ├─ live rooms, media providers, provider webhooks
  ├─ age/KYC states and safety decisions
  ├─ Mutuals moderation and event operations
  └─ audit logs, queues, health, incidents

AI/MCP
  ├─ user-safe assistant tools
  ├─ creator helper tools
  ├─ admin-only ops tools
  ├─ explicit confirmations for irreversible actions
  └─ every tool call audited and permission-scoped
```
