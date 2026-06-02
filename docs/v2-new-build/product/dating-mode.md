# Veel V2 Dating Mode Architecture

Status: proposed v2 architecture
Scope: dating, matching, safety, messages
Last updated: 2026-06-03
Source of truth: yes for v2 Dating Mode

Dating is an explicit opt-in mode layered on creator media. It is not the root product and it must not pollute normal Home/Bits gestures.

## Product Position

- Dating is a conversion and engagement mode for adults who explicitly opt in.
- A creator enables Dating Mode in profile/settings, not per Create draft.
- Creator media can show a dating-active icon/badge when the creator has Dating Mode enabled.
- A viewer sees dating actions only if the viewer also enabled Dating Mode and accepted dating conduct rules.
- Match chat lives in Messages.
- Normal media gestures never become dating gestures unless the user is inside Dating Mode.
- Money, matching, reporting, and blocking always have visible controls, not gesture-only controls.

## Routes

```text
/app/dating/activate          planned
/app/dating/preferences       planned
/app/dating/feed              planned
/app/dating/matches           planned
/app/dating/matches/:id       planned
/app/messages?filter=matches  planned
```

## Backend Ownership

Fastify owns:

- dating opt-in state
- age gate requirement
- consent version
- dating profile visibility
- creator dating visibility on media surfaces
- viewer eligibility for dating gestures/actions
- swipes/interests
- match creation
- match conversation permissions
- report/block safety outcomes
- audit events

Frontend owns:

- Dating Mode UI
- gesture handling
- visible Yes / Not interested buttons
- match chat presentation
- safe empty/error states

Frontend never decides final match state or visibility policy.

## Data Relations

```text
users
  └─ dating_profiles
       ├─ consent_version
       ├─ visibility
       ├─ preferences_minimum
       └─ safety_state

dating_swipes
  ├─ actor_user_id
  ├─ target_user_id
  ├─ content_item_id
  ├─ action: yes | not_interested
  └─ created_at

dating_matches
  ├─ user_a_id
  ├─ user_b_id
  ├─ source_content_item_id
  ├─ conversation_id
  └─ state: active | blocked | reported | expired
```

## Gesture Model

```text
Dating feed:
  vertical swipe = next / previous dating media
  left/right or buttons = Yes / Not interested
  Back/Esc = exit mode or close sheet

Normal media:
  no dating swipe semantics unless both creator and viewer have Dating Mode active and the UI is explicitly in Dating Mode
```

Visible buttons must exist for Yes and Not interested, because gestures are shortcuts only.

## Safety Rules

- Age verified before activation.
- Explicit opt-in before Dating Mode feed.
- Clear Dating Mode badge.
- Create/Edit does not configure dating per post.
- Dating can be toggled from profile/settings and can be changed later.
- If the creator disables Dating Mode, creator media stops showing dating-active affordances.
- If the viewer disables Dating Mode, dating gestures/actions disappear from media.
- Consent checklist before first use:
  - be respectful
  - do not harass or pressure
  - do not send explicit content without consent
  - report unsafe behavior
  - matches can expire or pause when ignored
- Report/block visible on every profile/media/match surface.
- Blocking removes match/chat visibility where required.
- Reports create safety/moderation audit records.
- Consent version is stored and updateable.
- No accidental dating actions in normal media mode.

## Anti-Ghosting And Overwhelm Rules

Dating should avoid becoming another infinite-swipe loop.

Launch defaults:

- maximum 10 active matches
- daily Yes action limit
- one gentle first-message nudge per match
- stale match state after no first reply in configured window
- Dating Mode pauses when active match cap is reached
- user must reply, close, or archive matches to continue
- repeated reports, low reply rate, or abuse signals reduce daily limits
- no aggressive push notifications

This protects both sides: fewer low-intent matches, less overwhelm, clearer accountability, and less ghosting.

## Notification Rules

- Notify on mutual match.
- Notify once if a match is waiting for first reply.
- Notify before a match becomes stale.
- Do not spam repeated nudges.
- Safety/report notifications have priority.
- Dating notifications are muted by default if user disables Dating Mode.

## Provider Dependencies

Dating itself has no external dating provider. It depends on:

- Supabase Auth for identity.
- Age provider waterfall before activation.
- Supabase Realtime / backend events for match chat updates.
- Moderation providers if content/user safety scanning is added.

## Admin/Ops Requirements

Admin can inspect:

- opt-in state
- consent version
- reported dating media
- match report/block history
- moderation decisions
- abuse rate per user

Admin cannot see private message content by default unless a documented legal/moderation workflow authorizes access.

## Tests

- activation requires age gate
- normal media gestures do not create dating actions
- dating feed Yes creates backend swipe
- mutual Yes creates one match
- duplicate swipes are idempotent
- block/report hides match and audits event
- match chat permission derives from backend match state
- mobile and desktop gestures have visible button alternatives
