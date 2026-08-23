# Veel V2 Engagement Strategy

Status: accepted
Scope: engagement, social graph, activity
Last updated: 2026-08-11
Source of truth: yes

Owns:
- engagement strategy decisions for its named domain

Defers to:
- INDEX.md, route-map.md, OpenAPI, schema blueprint, and ADRs where narrower

Does not own:
- unrelated domains, implementation shortcuts, provider secrets, or hidden source-of-truth rules

Launch scope:
- accepted v2 launch or phased behavior stated in this document

Non-goals:
- historical-context inference, duplicate systems, and unapproved provider/product expansion

This document defines how Veel v2 handles social engagement without turning frontend counters into business truth.

## Engagement Principles

- Engagement actions are real backend records, not local-only counters.
- Frontend may optimistically update visible counts, but must reconcile from backend.
- Every action has a clear owner, state, idempotency rule, and abuse/rate-limit rule.
- Retrying an engagement command with the same idempotency key replays the original result and creates at most one audit event; reusing that key with changed input returns `409 Conflict`.
- Monetised engagement is separate from lightweight engagement.
- Internal sharing and external referral sharing are different products.
- Product metrics must not optimize only for addictive time-on-feed. Track creator earnings, successful purchases, healthy replies, completed tickets/events, safety reports resolved, and user satisfaction alongside watch time.

## Humane Engagement And Legal-Risk Guard

Veel should feel media-native without copying dark patterns that create regulatory or trust risk.

Rules:

- show break states in long vertical feeds
- avoid infinite autoplay loops without user control
- keep report/block/access controls visible
- do not hide payment or subscription terms behind engagement UI
- do not use misleading scarcity or manipulative countdowns
- keep Mutuals notifications low-pressure
- give users control over push notifications and Mutuals mode
- track safety and wellbeing metrics, not only watch time
- age-gate before adult/protected/Mutuals/payment areas

## Engagement Map

| Action | Backend record | Optimistic UI | Realtime | Monetisation impact | Notes |
| --- | --- | --- | --- | --- | --- |
| Like | `content_reactions` | Yes | Optional count projection | None | Toggle idempotent per user/content. |
| Save | `content_saves` | Yes | No | None | Private user library. |
| Comment | `comments` | After server write | Yes | None by default | Moderation and block graph apply. |
| Share in Veel | `share_events`, optional message row | After server write | Yes for recipient | No referral by default | Internal DM share does not create commission. |
| External referral share | `referral_tokens`, `share_events` | After server token/link creation | Optional | Can create attribution and commission | External links can earn commission from platform share after eligible paid settlement. |
| Admin partner referral | `partner_referral_campaigns`, `referrals` | After admin-created campaign | No | Yes if configured | Used for ambassadors, creator acquisition, or event promotion. |
| Repost/Mirror | `content_reposts` | Yes | Optional | None unless product changes | Product-facing name should stay consistent. |
| Follow | `profile_follows` | Yes | Optional | Feed ranking, creator audience | Creator-isolated follow/unfollow. |
| Block | `user_blocks` | No fake optimistic if destructive | Immediate local hide then reconcile | Safety | Blocks search/messages/feed visibility. |
| Report | `reports` | Server success state | Admin queue | Safety | Requires audit and moderation queue. |
| Tip/Support | `payment_intents`, `settlements`, `activity` | Submitted only | User payment event | Financial | Confirmed backend settlement for balances. |
| Unlock | `payment_intents`, `entitlements` | Pending only | User payment/access event | Access | Backend-confirmed entitlement only. |
| Media offer / structured request | `payment_intents`, `creator_media_offers`, `structured_creator_requests`, `entitlements` | Pending only | Offer/request state after confirm | Financial/access or delivery workspace | Exact entitlement or accepted delivery workspace activates after confirmed settlement; no paid chat message. |
| Live pass | `payment_intents`, `live_access_grants` | Pending only | Room access update | Access | Pass controls playback/chat. |
| Event interest | `event_interests` | Yes | Optional | None | Purchase still explicit. |
| Event Access Pass purchase | `payment_intents`, `event_access_passes` | Pending only | Event Access event | Access | Backend QR/receipt after confirm. |
| Mutuals interested/not interested | `mutual_interests` | Yes | Mutual only after backend state | Mutual | Only inside explicit Mutuals mode. |

## Social Graph

```mermaid
erDiagram
  users ||--o{ profile_follows : follows
  users ||--o{ user_blocks : blocks
  users ||--o{ reports : files
  users ||--o{ content_reactions : likes
  users ||--o{ content_saves : saves
  users ||--o{ comments : writes
  users ||--o{ share_events : shares
  users ||--o{ referral_tokens : creates
  users ||--o{ viewer_activity : owns
```

## Follow Strategy

Follow is a first-class social graph edge.

Rules:

- Follow/unfollow is idempotent per viewer/creator.
- Follow state is returned in feed cards, public profile, search results, and creator suggestions.
- Following a creator affects Home ranking and activity rails.
- Block removes or suppresses follow edges where policy requires.
- Creator profile APIs must return viewer-specific relationship state.

## Like, Save, Comment

Like:

- toggle endpoint: `POST /v1/engagement/:contentId/like`
- unique key: `(viewer_id, content_id, reaction_type)`
- backend returns canonical liked/saved/count projection; frontend optimistic state must reconcile

Save:

- toggle endpoint: `POST /v1/engagement/:contentId/save`
- private to viewer
- appears in Activity/Saved surfaces
- save state is never public ranking proof by itself

Comment:

- create endpoint: `POST /v1/engagement/:contentId/comments`
- list endpoint: `GET /v1/engagement/:contentId/comments`
- supports deletion/moderation
- never bypasses block/report/safety rules
- launch comment writes start `visible` only after backend access, block graph, and content visibility checks pass; admin moderation can later hide/remove.

## Feed Controls, Reports, And Blocks

Launch implementation rules:

- `GET /v1/feed/preferences` exposes the viewer-safe read projection for settings and client cache.
- `PATCH /v1/feed/preferences` owns default mode and NSFW/SFW preference server-side.
- `POST /v1/feed/reset` clears backend-owned recommendation hides and writes an audit event.
- `POST /v1/feed/hide-creator` and `POST /v1/feed/hide-topic` write private viewer controls that feed ranking must honor before scoring.
- `POST /v1/reports` writes a safety report, queues it by subject type, and appends one idempotent audit event.
- `POST /v1/blocks/:userId` creates a private block edge, suppresses future engagement visibility where relevant, and appends one idempotent audit event per accepted command.
- No frontend-only local preference, report, or block state is business truth.

## Share Strategy

Internal Veel share:

- sends to a user/thread inside Messages
- can also repost/mirror inside Veel if that product action is enabled
- creates share activity
- does not create referral commission by default

External share:

- creates a referral/share token
- can survive signup/login/wallet/payment
- can become commission-eligible only after backend payment settlement
- opens a professional share tab/sheet with Copy link, WhatsApp, Telegram, Instagram, TikTok, X, LinkedIn, and system share where supported
- each external channel uses the same backend-created referral URL; the frontend never creates commission state locally

Share UI rule:

- tab 1: `Send in Veel` for messages/repost/internal share, no referral commission by default
- tab 2: `Share link` for external/referral-capable links
- copy always uses a backend-created URL so attribution and abuse limits are server-owned
- unavailable networks are hidden or shown as disabled with clear copy; do not fake unsupported platform APIs

```mermaid
flowchart LR
  Internal["Share in Veel"] --> Thread["Message/thread event"]
  Thread --> NoCommission["No commission by default"]
  External["External share"] --> Token["Referral token"]
  Token --> Attribution["Attribution"]
  Attribution --> Payment["Paid action"]
  Payment --> Commission["Backend commission state"]
```

## Activity Strategy

Activity is a backend-derived projection:

- liked
- saved
- commented
- shared
- unlocked/purchased
- tipped/supported
- subscribed
- live passes
- tickets
- referral shares
- commissions
- wallet transactions

No fake activity counters. No frontend-calculated commission.

## Ranking Inputs

Allowed ranking signals:

- follows
- creator freshness
- media completion
- likes/comments/saves
- paid access conversion
- blocks/reports negative signals
- age/access/legal constraints
- content availability

Do not rank from:

- raw provider payloads
- frontend-only counters
- unconfirmed payments
- unmoderated unsafe signals

## Abuse Controls

- rate limits per action/user/IP/device
- block graph enforcement
- report queue
- spam thresholds for follows/comments/shares
- paid action throttles
- suspicious referral attribution review
- admin audit for moderation outcomes

## API Surface

```text
POST   /v1/engagement/:contentId/like
POST   /v1/engagement/:contentId/save
POST   /v1/engagement/:contentId/comments
GET    /v1/engagement/:contentId/comments
POST   /v1/shares
POST   /v1/referrals/tokens
POST   /v1/reports
POST   /v1/blocks/:userId
GET    /v1/follows/:userId
POST   /v1/follows/:userId
DELETE /v1/follows/:userId
POST   /v1/feed/impressions
GET    /v1/activity
```

Follow/unfollow is implemented through the canonical `user_follows` graph with projected follower/following counts, viewer-specific feed/profile state, durable command receipts, server-side block/public-profile constraints, social-only audit metadata, and new-follow notifications. Follow and block take the same ordered user-pair locks, so a concurrent block cannot leave an active edge; unfollow remains available after a target becomes private or inactive, while a new follow still requires a public active profile. Follow never implies Mutuals, messaging permission, membership, content access, or preferential paid treatment. Feed impressions use separate seven-day receipts so non-adjacent retries and concurrent delivery remain exactly idempotent inside the retry window; each write amortizes bounded expired-receipt cleanup.

## Tests

- concurrent follow/unfollow commands reconcile to one canonical edge/count projection
- block insertion deactivates both-direction follow edges and updates counts
- changed-input idempotency reuse fails with conflict
- impression replay remains idempotent even after later impressions
- like/save/comment persistence
- comment blocked by block graph
- share internal creates message/share event
- external share creates referral token
- self-referral blocked
- duplicate paid event does not duplicate commission
- activity projection is backend-derived
