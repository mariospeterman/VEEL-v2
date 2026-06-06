# Veel V2 Profile, Activity, Badges, And Ranking

Status: accepted
Scope: profile, badges, verification status, activity, creator/user rankings
Last updated: 2026-06-03
Source of truth: yes for profile/activity/gamification rules

Owns:
- profile activity ranking decisions for its named domain

Defers to:
- INDEX.md, route-map.md, OpenAPI, schema blueprint, and ADRs where narrower

Does not own:
- unrelated domains, implementation shortcuts, provider secrets, or hidden source-of-truth rules

Launch scope:
- accepted v2 launch or phased behavior stated in this document

Non-goals:
- historical-context inference, duplicate systems, and unapproved provider/product expansion

Profiles should show identity, trust, creator status, and user progress without turning Veel into a manipulative leaderboard. Ranking and badges should reward useful platform behavior: verified safety, creator quality, completed purchases, events, replies, and low report rates.

## Profile Must Show

Own profile:

- avatar/header
- handle/display name
- bio/location where user chooses
- age-verified status
- wallet linked/embedded wallet status
- creator status
- KYC/KYB status only if required or completed
- subscription tier if active
- badges
- activity shortcut
- wallet/transactions shortcut
- creator dashboard shortcut where applicable, backed by `GET /v1/profiles/me/creator-dashboard`

Public creator profile:

- avatar/header
- handle/display name
- creator badge/status
- age-verified/trust badge where product allows
- follow/message/support/subscribe actions
- backend-derived stats and monetisation capability flags from `GET /v1/profiles/{handle}`
- media grid/tabs
- premium/live/event indicators
- public badges only

Do not expose private KYC provider details, raw wallet metadata, private activity, raw payment state, or admin notes.

Current implementation state:

- `/profile` reads `GET /v1/profiles/me/creator-dashboard` through the typed web API helper and does not render local earnings/readiness fixtures. The dashboard displays backend-derived readiness score and `creator_records_only_no_balances_payout_queue_or_social_priority` as a policy boundary.
- `/profile` also reads `GET /v1/profiles/me/creator-onboarding` so incomplete creators get a backend-owned Become Creator checklist before the dashboard is available. Onboarding readiness score is derived from required backend checklist steps, not frontend heuristics.
- `/profile/[handle]` reads `GET /v1/profiles/{handle}` through the typed web API helper and does not render local public profile/media fixtures.
- Profile screens attach the current Supabase access token when present and render fail-closed unavailable/not-found states when the API, auth, or profile projection cannot return a safe resource.

## Badge Types

```text
trust badges
  age verified
  wallet linked
  creator verified
  earning/KYC verified if public policy allows

creator badges
  rising creator
  top creator
  live host
  event host
  responsive creator

community badges
  early member
  supporter
  event attendee
  subscriber

safety badges
  none by default
  do not publicly shame users with negative badges
```

Rules:

- badges are backend-derived
- badge grants/revocations are audited
- admin can manually grant/revoke selected badges with reason
- badges should not reveal sensitive provider data
- do not create paid-only status that makes free users feel second-class

## Activity Dashboard

Activity is the user’s own backend-derived record.

Categories:

- liked
- saved
- commented
- shared
- unlocked/purchased
- tips/support sent
- creator revenue received
- subscriptions
- live passes
- event tickets
- referral shares
- commissions
- wallet transactions
- Mutuals/actions where user-visible
- reports/safety actions where user-visible

Activity must link to safe records:

- payment intent
- transaction signature where safe
- entitlement
- ticket/QR
- referral attribution
- commission state

No fake counters. No frontend-calculated revenue.

## Ranking And Leaderboards

Use rankings carefully. The goal is motivation and discovery, not pressure.

Recommended launch rankings:

- trending creators
- rising creators
- top live hosts
- event hosts
- most supported creators
- creator response quality
- safe/high-quality creators

Avoid:

- ranking users by explicit content consumption
- exposing private spending rankings
- shaming low-ranked creators
- ranking dating desirability
- rewarding only infinite watch time

Ranking inputs:

- follow growth
- repeat support/unlocks
- content freshness
- low report/block rate
- creator response rate
- completed events/live sessions
- subscriber retention
- user satisfaction/safety metrics

## Gamification Rules

- use progress and badges to make platform state clear
- avoid dark patterns, streak pressure, or shame loops
- no gambling-style randomness for money or dating
- no “you are falling behind” notifications
- clear opt-out for ranking visibility where reasonable

## Admin Controls

Admin can inspect:

- badge grants/revocations
- ranking inputs
- creator quality signals
- earning/KYC status
- report/block impact
- ranking abuse attempts

Admin can tune ranking weights, but every change should be versioned and auditable.

## Tests

- public profile does not expose private activity
- own profile shows wallet/age/subscription status
- KYC status hidden unless allowed by policy
- badges are backend-derived
- badge grant/revoke writes audit event
- rankings exclude blocked/reported unsafe creators
- activity records link to backend payment/entitlement/ticket/referral state
