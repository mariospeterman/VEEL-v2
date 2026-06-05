# Veel V2 Full Platform Blueprint

Status: accepted
Scope: complete standalone Veel platform blueprint
Last updated: 2026-06-03
Source of truth: yes

Owns:
- complete Veel product, workflow, provider, and business map

Defers to:
- OpenAPI/schema/route-map for exact build contracts

Does not own:
- migration implementation details

Launch scope:
- full platform mental model and phased build boundaries

Non-goals:
- implementation code or vendor secrets

This is the single visual blueprint for building the full Veel v2 platform from scratch. The historical context is a reference for validated product lessons, provider edge cases, and tests only. Do not port historical architecture wholesale.

Use this document to understand how every major module relates before writing code.

## Product Definition

Veel v2 is an 18+ creator PWA/dApp for:

- short video and mixed media feeds
- live rooms and live-to-replay content
- VOD/media upload and playback
- paid unlocks and premium content
- tips and direct support
- paid messages
- creator subscriptions
- live passes
- events and tickets
- dating/matches as an explicit opt-in mode
- messaging and quick chat
- creator monetisation and earning/tax records
- referral commissions
- user activity and wallet transaction history
- admin/ops/business control
- AI/MCP assistant tools with strict permissions
- adult content compliance, age assurance, safety, moderation, reporting, and blocking

## Stack Blueprint

```text
Runtime and tooling
  Node.js LTS
  pnpm workspace
  TypeScript strict mode
  OpenAPI + Zod/JSON schema contracts
  Vitest + Playwright
  ESLint + Prettier/Biome decision before implementation

Frontend
  Next.js PWA
  Tailwind v4 tokens
  TanStack Query for server state
  Zustand/local state for UI state
  GSAP for landing-page frame animation only
  official wallet / provider clients where safe

Backend
  Fastify modular monolith
  worker process for async/provider jobs
  Supabase Auth + Postgres + Realtime
  OpenTelemetry and structured logging

Providers
  Embedded noncustodial wallet provider
  External Solana wallets
  Solana RPC / Solana Pay / Solana Subscriptions
  Helius for confirmed payment/access evidence
  Bunny Stream/CDN/TUS for VOD
  Livepeer for live/replay
  Yoti/Sumsub/Veriff/Persona age/KYC waterfall
  wallet funding path for user-owned wallets
  email/push provider
```

## Complete System Diagram

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                               Next.js PWA                                   │
│                                                                             │
│  Landing/Enter   Age Gate   App Shell   Home/Bits   Media Viewer            │
│  Create/Edit     Live Room  Messages    Profile     Activity/Wallet         │
│  Dating Mode     Events     AI Helper   Admin Gate  Settings                │
│                                                                             │
│  TanStack Query = server cache                                               │
│  Zustand/local state = sheets, panels, gestures, playback UI                 │
│  Wallet layer = embedded wallet + external Solana wallets                    │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ OpenAPI client
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Fastify Modular Monolith API                         │
│                                                                             │
│  auth/profile  age/access  content/media  live  messages  engagement        │
│  payments      referrals   subscriptions  events/tickets  dating            │
│  safety/moderation/report/block  activity  notifications  admin/ops         │
│  AI/MCP tool gateway  provider adapters  audit/idempotency                  │
│                                                                             │
│  Rules: controllers/routes are thin, services are scoped, providers are      │
│  adapter-wrapped, money/access/safety/admin mutations are transactional.     │
└───────────────┬───────────────────┬────────────────────┬───────────────────┘
                │                   │                    │
                ▼                   ▼                    ▼
┌─────────────────────────┐ ┌─────────────────┐ ┌────────────────────────────┐
│ Supabase                │ │ Worker Process  │ │ External Providers          │
│                         │ │                 │ │                            │
│ Auth/JWT                │ │ webhooks        │ │ Solana RPC / Pay / Subs     │
│ Postgres/RLS            │ │ reconciliation  │ │ Helius payment evidence     │
│ Realtime Broadcast      │ │ media status    │ │ Embedded wallet/funding     │
│ Storage if needed       │ │ moderation      │ │ Bunny VOD/CDN/TUS           │
│                         │ │ notifications   │ │ Livepeer live/replay        │
└─────────────────────────┘ │ retries         │ │ Age/KYC providers           │
                            └─────────────────┘ │ Email/push/observability    │
                                                └────────────────────────────┘
```

## Source-Of-Truth Rules

```text
Frontend owns:
  layout, gestures, motion, sheets, panels, optimistic UI where safe

Fastify API owns:
  payment truth, entitlement truth, referral truth, commission truth,
  access policy, dating match truth, ticket truth, safety/admin decisions

Supabase owns:
  database, auth sessions, realtime transport, RLS enforcement

Providers own:
  wallet UX, chain evidence, media infrastructure, live infrastructure,
  age/KYC verification, user-wallet funding, delivery infrastructure
```

Frontend never computes final access, final commission, final ticket state, final match state, final KYC state, or final provider status.

## Module Coverage Matrix

| Area | V2 docs | Backend module | Frontend surface | Providers |
| --- | --- | --- | --- | --- |
| Landing/onboarding | `landing-page-gsap.md`, `embedded-wallet-onboarding.md` | auth, age, wallet | landing, enter, onboarding | Supabase Auth, wallet provider, funding path |
| App shell/navigation/gestures | `native-ui-ux-screens.md`, `frontend-architecture.md` | profile/session policy | app shell, nav, gesture layer | none |
| Home/Bits/media viewer | `product-flows.md`, `native-ui-ux-screens.md`, `recommendation-discovery.md`, `frontend/component-map.md` | content, recommendation, engagement, access | Home, Bits, media viewer | Bunny/Livepeer playback |
| Create/Edit media | `product-flows.md`, `media-live-providers.md`, `frontend/component-map.md` | content, media, moderation | Create/Edit | Bunny TUS, Livepeer, moderation |
| VOD/media pipeline | `media-live-providers.md`, `providers/content-protection.md` | media, assets, provider callbacks | media cards/viewer | Bunny Stream/CDN/TUS |
| Live rooms/replays | `media-live-providers.md`, `product-flows.md` | live, passes, chat, replay | live room, replay viewer | Livepeer |
| Payments/unlocks | `payments-and-monetisation.md`, `business-monetisation.md` | payments, entitlements | payment sheet | Solana Pay/RPC, Helius |
| Tips/support | `business-monetisation.md`, `payments-and-monetisation.md` | payments, creator earnings records, referrals | tip/support sheet | Solana Pay/RPC, Helius/RPC evidence |
| Referrals/commissions | `business-monetisation.md`, `engagement-strategy.md` | referrals, commissions | share/invite, activity | Solana evidence |
| Subscriptions | `business-monetisation.md`, `payments-and-monetisation.md`, `noncustodial-money-compliance.md` | subscriptions, renewals | subscribe sheet/profile | Auto-renewing Solana Subscriptions/Allowances; manual Solana Pay recovery only |
| Paid messages | `business-monetisation.md`, `realtime-messages-activity.md` | messages, payments, access | messages/quick chat | Solana evidence |
| Engagement | `engagement-strategy.md` | likes, comments, saves, shares, follows | cards, viewer, profile | none |
| Messages/activity/realtime | `realtime-messages-activity.md`, `auth-supabase-realtime.md` | conversations, activity, notifications | messages, quick chat, activity | Supabase Realtime |
| Profile/creator dashboard | `frontend/component-map.md`, `business-monetisation.md`, `profile-activity-ranking.md` | profile, badges, rankings, creator settings, activity | profile, activity, creator dashboard | KYC provider |
| Dating/matches | `product/dating-mode.md`, `native-ui-ux-screens.md` | dating, matches, safety | dating mode, matches, match chat | age provider, realtime |
| Events/tickets | `product/events-ticketing.md`, `business-monetisation.md` | events, tickets, payments | event sheet, tickets | Solana evidence, email/push |
| AI/MCP | `safety-admin-ai.md`, `ai-mcp-use-cases.md` | AI sessions, tools, permissions, audit | AI assistant/admin AI | OpenAI-compatible adapter first |
| Admin/ops | `admin-operations-dashboard.md`, `deployment-topology.md` | admin, audit, ops diagnostics | admin app | all providers via sanitized diagnostics |
| Adult compliance/age/KYC | `compliance/*`, `providers/identity-provider-wiring.md` | age, KYC/KYB, audit | age gate, creator earning/tax setup | Yoti/Sumsub/Veriff/Persona |
| Security/content protection | `providers/content-protection.md`, `safety-admin-ai.md` | access policy, signed playback | safe media resources | Bunny, Livepeer |
| Deployment/ops | `deployment-topology.md`, `slice-workflow.md` | API/worker/observability | health/admin views | Supabase, providers, telemetry |

## Primary User Workflows

### New Viewer

```text
Landing
  -> sign up with social/email or external wallet
  -> embedded noncustodial wallet created or native wallet linked
  -> age verification
  -> protected app access
  -> Home feed
  -> watch teaser/free media
  -> tip/support/content-unlock/pass/ticket when desired
  -> wallet approval
  -> backend verification
  -> refreshed access/activity state
```

### Creator

```text
Sign up
  -> embedded wallet or native wallet path
  -> age gate
  -> create profile
  -> optional creator monetisation setup
  -> KYC/KYB for earning, tax, and compliance where required
  -> upload/capture media
  -> choose thumbnail/teaser/access/monetisation and creator prices within admin guardrails
  -> optional event attachment with date/time, ticket amount, public/private, and location
  -> publish
  -> dashboard shows backend-derived revenue/activity/provider state
```

### Paid Unlock

```text
Locked media
  -> payment sheet
  -> API creates payment intent
  -> wallet approves transaction
  -> Helius/RPC confirms chain facts
  -> API validates mandatory facts
  -> entitlement grant
  -> referral/commission if eligible
  -> viewer receives full playback resource
```

### Live Pass

```text
Creator starts live
  -> Livepeer stream created by API
  -> creator gets host connection only
  -> viewer sees playback-safe live room
  -> viewer buys pass
  -> backend verifies payment
  -> pass grants playback/chat
  -> replay becomes content item after live ends
```

### Event Ticket

```text
Media/event sheet
  -> ticket selection
  -> backend validates creator price, inventory, and policy
  -> wallet approval for paid ticket or approval path for free/requested ticket
  -> backend grants ticket entitlement
  -> QR/receipt
  -> admin/check-in sees ticket state
```

### Dating Match

```text
User explicitly activates Dating Mode
  -> age/consent check
  -> profile/settings Dating Mode enabled
  -> eligible creator media displays dating-active icon
  -> dating feed
  -> Yes / Not interested visible controls
  -> backend records swipe
  -> mutual interest creates match
  -> match chat opens in Messages
  -> report/block always available
```

### Admin/Ops

```text
Admin login
  -> role/policy check
  -> dashboard: revenue, provider health, queue health, reports, age/KYC, media
  -> inspect user/content/payment/ticket/live/referral records
  -> perform moderated actions with confirmation
  -> every mutation writes audit event
```

## Provider-First Integration Map

```text
Do not build custom infrastructure when a provider already owns the job.

Wallet UX:
  embedded wallet provider + external wallets

Chain settlement:
  Solana Pay / Solana RPC

Confirmed payment evidence:
  Helius, scoped to money/access products

VOD:
  Bunny Stream/CDN/TUS

Live:
  Livepeer

Age/KYC:
  Yoti primary candidate
  Sumsub/Veriff/Persona fallback candidates

Realtime:
  Supabase Realtime for selected messages/notifications/live/activity events

Identity/session:
  Supabase Auth

Database:
  Supabase Postgres with RLS and API-side policy
```

## Data Relationship Overview

```text
users
  ├─ profiles
  ├─ wallets
  ├─ age_verifications
  ├─ creator_accounts
  ├─ content_items
  ├─ live_rooms
  ├─ conversations/messages
  ├─ follows/likes/saves/comments/shares
  ├─ referral_attributions
  ├─ dating_profiles/swipes/matches
  ├─ ticket_entitlements
  └─ activity_events

content_items
  ├─ media_assets
  ├─ access_rules
  ├─ payment_products
  ├─ teaser_ranges
  ├─ moderation_state
  ├─ optional_event
  └─ optional_dating_setting

payment_intents
  ├─ product_type
  ├─ payer_user_id
  ├─ creator_user_id
  ├─ amount/currency
  ├─ split recipients
  ├─ solana_reference
  ├─ transaction_signature
  ├─ wallet_transaction_records
  ├─ entitlement_id
  ├─ commission_id
  └─ audit_events
```

## Permission And Safety Layers

```text
Every request passes:
  auth/session check
  age/access gate where required
  policy check
  rate limit
  validation/schema
  idempotency where mutation is replay-sensitive
  audit write for money/safety/admin/provider actions

Every frontend response is:
  resource-shaped
  provider-sanitized
  PII-minimized
  permission-scoped
```

## Build Order

```text
1. Repo/tooling/contracts
2. Supabase schema/RLS/auth
3. Fastify API shell and generated client
4. Age/auth/onboarding/wallet
5. App shell/navigation/gestures
6. Home/media/create MVP
7. Bunny VOD provider slice
8. Solana payment intent and verification slice
9. Unlock/access/referral/commission slice
10. Messages/activity/realtime slice
11. Livepeer live/pass/replay slice
12. Admin/ops baseline
13. Creator monetisation/subscriptions
14. Events/ticketing
15. Dating mode
16. AI/MCP assistant
17. Compliance hardening, provider smoke, launch QA
18. UI polish
```

## Required Provider ADR

Provider defaults are defined in `adr/0002-provider-decisions-2026.md`. Use it before writing wallet, onramp, subscription, media playback, age/KYC, ticketing, moderation, or AI/MCP code.

## New Repo Rule

Build by vertical slices from this pack. Do not start by copying historical context code. Only reference the historical context for:

- screenshots and UX lessons
- provider edge cases
- test cases
- validated payment/access/referral/security decisions
- docs that are explicitly merged into this v2 pack

If a topic is not present in this blueprint or the linked v2 docs, create an ADR before implementation.
