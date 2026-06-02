# Veel V2 Render-Safe Diagrams

Status: proposed v2 architecture
Scope: full-platform diagrams
Last updated: 2026-06-03
Source of truth: yes for render-safe architecture diagrams

These diagrams use plain text so they render in Cursor, GitHub, terminals, and any Markdown preview without a Mermaid extension. Mermaid diagrams may still exist in detailed docs, but this file is the canonical render-safe diagram set.

## Full Platform

```text
User
  │
  ▼
Next.js PWA
  ├─ Landing, auth, age gate
  ├─ App shell: Home, Bits, Discover, Create, Messages, Profile
  ├─ Explicit modes: Dating, Events, AI assistant
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
  ├─ dating, events, AI/MCP, admin/ops
  └─ idempotency + append-only audit
        │
        ├────────────────────────────┬────────────────────────────┐
        ▼                            ▼                            ▼
Supabase Platform                 Workers                      Providers
  ├─ Auth/JWT                       ├─ webhooks                  ├─ Solana RPC / Solana Pay
  ├─ Postgres/RLS                   ├─ reconciliation            ├─ Helius payment evidence
  ├─ Realtime Broadcast             ├─ media status              ├─ embedded wallet provider
  └─ Storage only if needed         ├─ moderation                ├─ onramp provider
                                    ├─ notifications             ├─ Bunny Stream/CDN/TUS
                                    └─ retry queues              ├─ Livepeer live/replay
                                                                 ├─ Yoti/Sumsub/Persona
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
  -> age gate and creator payout eligibility checks
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
  ├─ dating profile and matches
  └─ purchases, passes, tickets, subscriptions

Creator/User
  ├─ content items
  │   ├─ media asset
  │   ├─ teaser/full access rules
  │   ├─ monetisation config
  │   └─ optional event attachment
  ├─ dating profile/settings
  │   └─ media shows dating-active affordance when profile mode is enabled
  ├─ live rooms
  ├─ subscriptions
  ├─ referrals
  └─ payout/KYC state

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
1. User taps Tip / Support / Unlock / Subscribe / Pass / Ticket / Paid message
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
10. API records commission/creator balance where applicable
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
  -> pass/unlock payment grants live entitlement
  -> chat uses backend/Supabase policy checks
  -> Livepeer webhook marks stream status
  -> replay asset becomes content/replay item after end
  -> viewer replay follows content access rules
```

## Age And KYC Waterfall

```text
Age gate for protected app/media/dating/messages/wallet:
  1. Reusable age credential when supported
  2. Age estimation provider
  3. Database / non-document provider check where supported
  4. Documentary identity flow only when required
  5. Manual review only if policy requires escalation

Creator earning / payout KYC:
  - separate from ordinary viewer age gate
  - provider session/webhook result
  - minimal stored state
  - no raw biometric/document storage in core DB unless legally required
```

## Dating Mode Flow

```text
User opts into Dating Mode
  -> age gate required
  -> explicit consent and safety copy
  -> profile/settings Dating Mode enabled
  -> creator media shows dating-active affordance to eligible viewers
  -> dating feed shows eligible creator media
  -> Yes / Not interested actions create backend swipe events
  -> mutual interest creates match
  -> match opens conversation in Messages
  -> report/block removes visibility and audits safety event
```

## Events And Ticketing Flow

```text
Creator attaches event to media
  -> event config: digital live stream or physical, title, date/time, ticket count, price/free, public/private
  -> event appears from media/event surfaces
  -> user opens ticket sheet
  -> paid ticket creates payment intent
  -> wallet approves noncustodial transfer
  -> backend verifies confirmed payment
  -> backend grants ticket entitlement and QR/receipt
  -> admin can inspect ticket, payment, check-in, refund/escalation state
```

## Admin, Ops, And AI/MCP

```text
Admin surface
  ├─ users, content, reports, blocks
  ├─ payments, unlocks, referrals, commissions
  ├─ live rooms, media providers, provider webhooks
  ├─ age/KYC states and safety decisions
  ├─ dating moderation and event operations
  └─ audit logs, queues, health, incidents

AI/MCP
  ├─ user-safe assistant tools
  ├─ creator helper tools
  ├─ admin-only ops tools
  ├─ explicit confirmations for irreversible actions
  └─ every tool call audited and permission-scoped
```
