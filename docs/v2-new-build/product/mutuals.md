# Veel V2 Mutuals Architecture

Status: accepted
Scope: Mutuals, interest signaling, safety, mutual chat
Last updated: 2026-08-15
Source of truth: yes for v2 Mutuals

Owns:
- Mutuals product decisions for its named domain

Defers to:
- INDEX.md, route-map.md, OpenAPI, schema blueprint, and ADRs where narrower

Does not own:
- unrelated domains, implementation shortcuts, provider secrets, legal advice, or hidden source-of-truth rules

Launch scope:
- accepted v2 launch or phased behavior stated in this document

Non-goals:
- dating-platform positioning, paid people-ranking, historical-context inference, duplicate systems, and unapproved provider/product expansion

Mutuals is an explicit opt-in social interest mode layered on creator/user media. It is not the root product, not a paid discovery product, and not a dating marketplace.

Hard line:

```text
Money can buy access to content, events, memberships, and live streams.
Money can never buy access to people, visibility, matches, recommendations, or preferential social treatment.
```

## Product Position

- Use product language: Mutuals, Show Interest, Interested, Mutual, Mutual chat, Mutuals mode.
- Avoid product language: dating, dating mode, swipes, match marketplace, pay-to-match, boost, priority interest.
- Mutuals is an adult opt-in mode for users who explicitly consent to interest signaling and conduct rules.
- A creator/user enables Mutuals in profile/settings, not per Create draft.
- Eligible media can show a Mutuals-active affordance when the profile mode is enabled.
- A viewer sees Mutuals actions only when the viewer also enabled Mutuals and accepted conduct rules.
- Mutual chat lives in Messages.
- Normal media gestures never become Mutuals gestures unless the user is inside Mutuals mode.
- Money, reporting, blocking, and Mutual actions always have visible controls, not gesture-only controls.
- Paid content access, support, memberships, or platform plan status never imply romantic consent, social consent, visibility priority, or Mutuals interest.
- Paid products never increase Mutuals feed position, match probability, message priority, social reputation, or eligibility to contact a person outside ordinary backend safety/access rules.
- Commerce Kit and native Product Offers have no Mutuals role. Support or a purchase cannot activate Mutuals, create interest, imply consent or reply obligation, unlock contact, or change Mutuals eligibility/ranking.

## Routes

```text
/mutuals                       planned app surface
/mutuals/preferences           planned
/mutuals/feed                  canonical Mutuals feed
/mutuals                       canonical Mutual list
/messages?filter=mutuals       planned
```

## Current Implementation State

- The backend exposes canonical Mutuals API routes:
  `POST /v1/mutuals/activate`, `PATCH /v1/mutuals/preferences`,
  `GET /v1/mutuals/feed`, `POST /v1/mutuals/interests`,
  `GET /v1/mutuals`, and `PATCH /v1/mutuals/:id/archive`.
- Dating-named API routes are removed from launch-facing contracts and code.
- Admin safety operations use canonical `GET /v1/admin/mutuals/safety`.
  Dating-named admin safety routes are removed from launch-facing contracts and code.
- The canonical schema names are `mutual_profiles`, `mutual_interests`, and `mutuals`.
- The `0049_event_access_mutuals_canonical_names` migration renames the pre-launch dating tables to canonical Mutuals tables before launch-facing copy ships.
- Frontend projections must use Mutuals copy and canonical Mutuals API routes.
- `/mutuals/feed` and `/mutuals` use typed API-backed projections through the
  canonical API routes `GET /v1/mutuals/feed` and `GET /v1/mutuals`; they fail
  closed when the API is unavailable instead of rendering fixture Mutuals data.
- The visible Interested and Not interested controls submit to
  `POST /v1/mutuals/interests`, retain one idempotency key across a lost-response
  retry, and render the canonical persisted action plus only the backend-owned
  Mutual result. A saved interest never
  implies contact, a reply, or a Mutual until the backend says both users opted in.
- Dating-named frontend routes and historical aliases such as
  `/mutuals/mutuals` are removed from launch-facing navigation and route
  ownership.
- Admin safety should use Mutuals copy and must preserve legacy API aliases only
  as internal transition details.

## Backend Ownership

Fastify owns:

- Mutuals opt-in state
- age gate requirement
- conduct consent version
- Mutuals profile visibility
- creator/user Mutuals visibility on media surfaces
- viewer eligibility for Show Interest actions
- interest records
- Mutual creation
- Mutual chat permissions
- report/block safety outcomes
- audit events

Frontend owns:

- Mutuals UI
- gesture handling
- visible Show Interest / Not interested buttons
- Mutual chat presentation
- safe empty/error states

Frontend never decides final Mutual state, eligibility, visibility policy, or chat permission.

## Data Relations

Target names:

```text
users
  └─ mutual_profiles
       ├─ consent_version
       ├─ visibility
       ├─ preferences_minimum
       └─ safety_state

mutual_interests
  ├─ actor_user_id
  ├─ target_user_id
  ├─ content_item_id
  ├─ action: interested | not_interested
  └─ created_at

mutuals
  ├─ user_a_id
  ├─ user_b_id
  ├─ source_content_item_id
  ├─ conversation_id
  └─ state: active | blocked | reported | expired
```

Canonical table names:

```text
mutual_profiles
mutual_interests
mutuals
```

Historical migrations and rollback files may still contain `dating`, `swipe`, or `match` vocabulary for audit and reversibility only. New implementation and launch-facing copy must use Mutuals, interests, and mutuals.

## Gesture Model

```text
Mutuals feed:
  vertical swipe = next / previous Mutuals media
  right = Show Interest shortcut
  left = Not interested shortcut
  explicit buttons = Show Interest and Not interested
  Back/Esc = exit mode or close sheet

Normal media:
  no Mutuals action semantics unless both users have Mutuals active and the UI is explicitly in Mutuals mode
```

Visible buttons must exist for Show Interest and Not interested, because gestures are shortcuts only.

Undo may reverse only an eligible recent interest action. Reciprocal backend-confirmed interest alone creates a Mutual. Support, paid access, platform plans, and Profile Membership never imply consent, a reply, a match, or priority. Expanded Mutuals is separately gated/post-core; safe existing backend foundations remain but primary launch UI must not imply completion.

## Safety Rules

- Age verified before activation.
- Explicit opt-in before Mutuals feed.
- Clear Mutuals affordance.
- Mutuals visibility is separate from public creator profile visibility.
- A creator/user can disable Mutuals without hiding their creator profile.
- A viewer can disable Mutuals without changing normal content recommendations.
- Create/Edit does not configure Mutuals per post.
- Mutuals can be toggled from profile/settings and changed later.
- If a user disables Mutuals, their media stops showing Mutuals-active affordances.
- If a viewer disables Mutuals, Mutuals actions disappear from media.
- Consent checklist before first use:
  - be respectful
  - do not harass or pressure
  - do not send explicit content without consent
  - report unsafe behavior
  - Mutuals can expire or pause when ignored
- Report/block visible on every profile/media/Mutual surface.
- Blocking removes Mutual/chat visibility where required.
- Reports create safety/moderation audit records.
- Consent version is stored and updateable.
- No accidental Mutuals actions in normal media mode.
- Location is optional, coarse, and never exposed as exact user location by default.
- Explicit media in Mutual chat requires consent controls and report/block tooling.

## Anti-Pressure Rules

Mutuals must avoid becoming an infinite low-intent loop.

Launch defaults:

- maximum 10 active Mutuals
- daily Show Interest action limit
- one gentle first-message nudge per Mutual
- stale Mutual state after no first reply in configured window
- Mutuals mode pauses when active Mutual cap is reached
- user must reply, close, or archive Mutuals to continue
- repeated reports, low reply rate, or abuse signals reduce daily limits
- no aggressive push notifications
- admin-configurable limits override env defaults and every override is audited

## Notification Rules

- Notify on a new Mutual.
- Notify once if a Mutual is waiting for first reply.
- Notify before a Mutual becomes stale.
- Do not spam repeated nudges.
- Safety/report notifications have priority.
- Mutuals notifications are muted by default if user disables Mutuals.

## Provider Dependencies

Mutuals itself has no external dating provider. It depends on:

- Supabase Auth for identity.
- Age provider waterfall before activation.
- Supabase Realtime / backend events for Mutual chat updates.
- Moderation providers if content/user safety scanning is added.

## Admin/Ops Requirements

Admin can inspect:

- opt-in state
- consent version
- reported Mutuals media
- Mutual report/block history
- moderation decisions
- abuse rate per user
- configured Mutuals limits and safety thresholds

Admin cannot see private message content by default unless a documented legal/moderation workflow authorizes access.

## Tests

- activation requires age gate
- normal media gestures do not create Mutuals actions
- Mutuals feed Show Interest creates backend interest record
- reciprocal interest creates one Mutual
- duplicate interests are idempotent
- block/report hides Mutual and audits event
- Mutual chat permission derives from backend Mutual state
- mobile and desktop gestures have visible button alternatives
