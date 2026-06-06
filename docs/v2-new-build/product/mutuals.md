# Veel V2 Mutuals Architecture

Status: accepted
Scope: Mutuals, interest signaling, safety, mutual chat
Last updated: 2026-06-05
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
Payments support creators. Payments do not buy people.
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

## Routes

```text
/mutuals                       planned app surface
/mutuals/preferences           planned
/mutuals/feed                  planned
/mutuals/mutuals               planned
/messages?filter=mutuals       planned

/app/dating compatibility paths  legacy compatibility alias only during migration
```

## Current Implementation State

- The current backend exposes the pre-rename dating route family as the implemented compatibility surface.
- The target route family is Mutuals.
- The target schema names are `mutual_profiles`, `mutual_interests`, and `mutuals`.
- Current migration tables named `dating_profiles`, `dating_swipes`, and `dating_matches` must be migrated before launch-facing copy ships.
- Frontend projections must use Mutuals copy even while the backend compatibility aliases exist.
- `/app/dating` and `/app/dating/matches` use typed API-backed projections
  through `GET /v1/dating/feed` and `GET /v1/dating/matches`; they fail
  closed when the API is unavailable instead of rendering fixture Mutuals data.
- Admin safety should use Mutuals copy and must preserve legacy route aliases only as internal transition details.

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

Compatibility names until migration:

```text
dating_profiles -> mutual_profiles
dating_swipes   -> mutual_interests
dating_matches  -> mutuals
yes             -> interested
match chat      -> mutual chat
```

## Gesture Model

```text
Mutuals feed:
  vertical swipe = next / previous Mutuals media
  explicit button = Show Interest
  explicit button = Not interested
  Back/Esc = exit mode or close sheet

Normal media:
  no Mutuals action semantics unless both users have Mutuals active and the UI is explicitly in Mutuals mode
```

Visible buttons must exist for Show Interest and Not interested, because gestures are shortcuts only.

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
