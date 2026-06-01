# Veel V2 Dating Mode Architecture

Status: proposed v2 architecture
Scope: dating, matching, safety, messages
Last updated: 2026-06-02
Source of truth: yes for v2 Dating Mode

Dating is an explicit opt-in mode layered on creator media. It is not the root product and it must not pollute normal Home/Bits gestures.

## Product Position

- Dating is a conversion and engagement mode for adults who explicitly opt in.
- Dating-enabled media can appear in Dating Mode.
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
- media eligibility for dating
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

content_items
  └─ dating_media_settings
       ├─ enabled_by_creator
       ├─ moderation_state
       └─ visibility_scope

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
  no dating swipe semantics
```

Visible buttons must exist for Yes and Not interested, because gestures are shortcuts only.

## Safety Rules

- Age verified before activation.
- Explicit opt-in before Dating Mode feed.
- Clear Dating Mode badge.
- Report/block visible on every profile/media/match surface.
- Blocking removes match/chat visibility where required.
- Reports create safety/moderation audit records.
- Consent version is stored and updateable.
- No accidental dating actions in normal media mode.

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
