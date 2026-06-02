# Veel V2 Recommendation And Discovery Architecture

Status: proposed v2 architecture
Scope: Home feed, Bits feed, Discover, hashtags, mentions, NSFW controls, ranking safety
Last updated: 2026-06-03
Source of truth: yes for v2 content delivery and discovery

Veel should feel like a premium social video app, but recommendation quality must not depend on addictive dark patterns or frontend-only state. Ranking is a backend-owned read model with user controls, safety filters, and measurable business outcomes.

## Feed Surfaces

```text
Home
  mixed feed: live/moments/replays rail + media cards
  modes: Recommended, Following, NSFW, SFW

Bits
  immersive short-video feed
  free/discoverable by default
  vertical swipe

Discover
  search + hashtags + creators + events + content categories

Profile
  creator-owned grid/tabs

Dating Mode
  explicit opt-in creator media only when both creator and viewer have Dating Mode enabled
```

## Feed Modes

Home should expose simple controls, not too many categories:

- `Recommended`: recommended mixed media, default.
- `Following`: creators the viewer follows.
- `NSFW`: adult/protected media preference.
- `SFW`: hides adult/explicit/sensitive media.

Do not make dozens of top-level categories at launch. Use hashtags, search, and Discover for finer navigation.

Reason:

- too many categories create decision friction
- hashtags are creator-native and flexible
- backend can still use internal categories for safety/ranking
- visible feed controls stay simple and mobile-friendly

## Hashtags

Hashtags are the creator/user-facing categorization system.

Rules:

- `#tag` is parsed server-side from captions.
- Hashtag pages/search are discoverable.
- Hashtags can influence feed ranking but cannot override safety or age gates.
- Admin can block, merge, or de-rank abusive hashtags.
- Creator AI can suggest hashtags, but creator confirms them.
- Hashtags are normalized lowercase for indexing.

Data:

```text
hashtags
  id
  slug
  display_name
  state: active | blocked | restricted

content_hashtags
  content_item_id
  hashtag_id
```

## Mentions

Mentions are relationship and notification primitives, not just text decoration.

Rules:

- `@handle` is parsed server-side from captions/comments.
- Mentioned user receives notification unless muted/blocked.
- Mentions link to public profile.
- Block graph suppresses mention notifications.
- Admin can disable abusive mention patterns.
- Mentions are not payment/referral attribution by themselves.

Data:

```text
content_mentions
  content_item_id
  mentioned_user_id
  source: caption | comment | live_chat

mention_notifications
  mention_id
  recipient_user_id
  state: pending | delivered | muted | blocked
```

## Creator Categories

Use a tiny controlled category list only for internal routing, moderation, and Discover filters.

Launch category examples:

- fitness
- music
- beauty
- comedy
- lifestyle
- education
- gaming
- events
- adult

Creator-facing UI should prefer hashtags first. Categories can be optional metadata or admin-derived.

## NSFW/SFW Viewing Controls

Veel is 18+ only, so NSFW/SFW is not an under-18 gate inside the app. It is a viewer preference filter for verified adults.

Recommended launch behavior:

- before age verification: no protected app access
- after age verification and wallet setup: viewer can choose feed preference
- default for new verified users: `Recommended`
- quick Home toggle: `Recommended`, `Following`, `NSFW`, `SFW`
- saved preference under Settings
- clear content warnings and report/block controls

Creator Create/Edit:

- required `nsfw_label`
- optional content warning category
- moderation can correct or override labels
- repeated mislabeling can restrict monetisation/discovery
- Dating Mode is not a Create/Edit field; creator profile/settings controls dating-active visibility on media

NSFW states:

```text
none
adult
explicit
sensitive
restricted
blocked
```

## Recommendation Inputs

Backend ranking may use:

- follows
- likes/saves/comments/shares
- watch completion
- replays
- skips
- reports/blocks
- creator freshness
- content freshness
- hashtag/topic match
- language/region where relevant
- paid/unlocked state
- creator quality/safety signals
- diversity/fairness constraints
- user feed preference: Recommended / Following / NSFW / SFW

Do not use:

- private message content
- raw age/KYC provider data
- raw wallet balances
- sensitive identity data
- AI-inferred sensitive traits

## Ranking Goals

Rank for:

- relevant media discovery
- creator monetisation opportunity
- safe adult-content handling
- diversity across creators
- healthy engagement
- low report/block rate
- conversion to legitimate purchases/unlocks/tickets/subscriptions

Do not rank only for:

- infinite watch time
- rage/sexual shock amplification
- manipulative scarcity
- low-intent dating swipes

## Read Model

```text
content_items
  -> content_feed_projection
  -> personalized_feed_candidates
  -> ranked_feed_response

engagement_events
  -> user_interest_projection
  -> creator_quality_projection

moderation/safety
  -> eligibility filters before ranking
```

Initial implementation can be simple:

1. filter by policy, age, block graph, visibility
2. boost following
3. boost fresh content
4. boost good engagement ratio
5. diversify creators
6. apply NSFW preference
7. return paginated feed

Only add ML/vector personalization after enough data exists.

## Feed API

```text
GET /v1/content/feed?mode=recommended
GET /v1/content/feed?mode=following
GET /v1/content/feed?mode=nsfw
GET /v1/content/feed?mode=sfw
GET /v1/discover/hashtags/:slug
GET /v1/discover/search?q=...
```

API responses include:

- content item
- creator relationship state
- access state
- NSFW/content warning state
- engagement counts/state
- reason hints only if safe, e.g. `following`, `fresh`, `popular in #fitness`

Do not expose ranking internals or sensitive signals.

## Admin Controls

Admin can:

- inspect feed health
- de-rank or block content/hashtags
- correct NSFW labels
- view report/block rates by tag/category
- inspect creator discovery health
- run recommendation QA samples
- see revenue/conversion by feed mode

Admin cannot:

- bypass age gate for normal viewer resources
- expose raw private/sensitive signals
- hide unsafe content without audit trail

## Tests

- unverified user cannot enter protected app/feed
- `SFW` mode excludes adult/explicit/sensitive media
- `NSFW` mode is available only after required 18+ verification and wallet setup
- following mode returns followed creators only or primarily, depending fallback policy
- blocked creators/content do not appear
- hashtags parse and normalize
- mentions notify unless muted/blocked
- creator mislabel correction is audited
- feed pagination is stable
- ranking does not expose internal sensitive signals
