# WeVid V2 Recommendation And Discovery Architecture

Status: accepted
Scope: Home feed, Bits feed, Discover, hashtags, mentions, NSFW controls, ranking safety
Last updated: 2026-11-04
Source of truth: yes for v2 content delivery and discovery

Owns:
- recommendation discovery decisions for its named domain

Defers to:
- INDEX.md, route-map.md, OpenAPI, the immutable migration chain for database shape, and ADRs where narrower

Does not own:
- unrelated domains, implementation shortcuts, provider secrets, or hidden source-of-truth rules

Launch scope:
- accepted v2 launch or phased behavior stated in this document

Non-goals:
- historical-context inference, duplicate systems, and unapproved provider/product expansion

Veel should feel like a premium social video app, but recommendation quality must not depend on addictive dark patterns or frontend-only state. Ranking is a backend-owned read model with user controls, safety filters, and measurable business outcomes.

Current implementation state:

- `GET /v1/content/feed` is the canonical protected Home/Bits read model. It accepts an explicit `surface=home|bits`, `mode`, and opaque compound cursor and returns ranking metadata with each page.
- `GET /v1/discover/search`, `/hashtags`, `/hashtags/{slug}`, `/creators`, `/events`, and `/live` are implemented as protected Discover read models.
- Grouped search uses independent scope-bound opaque cursors for content, creators, hashtags, events,
  and live rooms. Each cursor carries the matching deterministic keyset and is rejected if reused for
  another group; no mixed cursor is cast across timestamp, text, and UUID query boundaries. Live-room
  pagination uses immutable `(created_at, id)` ordering, so a waiting-to-live state transition cannot
  move an unseen room across the continuation boundary.
- The route requires authenticated app readiness server-side: profile, verified age state, and wallet readiness.
- Captions are parsed server-side for normalized hashtags. Frontend does not submit trusted hashtag state.
- Eligibility is applied before scoring through `private.eligible_content(...)`: ready/published/approved media, active age-ready creator and public profile, age-ready viewer or constrained anonymous preview, public/follower/member visibility, active entitlement where applicable, viewer content preference, hidden creators/topics, blocks, and viewer reports. Feed, detail, Discover, public profile, share, unlock, and engagement consume this same gate. Anonymous public profiles are public-visibility and Safe-only. Bits additionally accepts only Bit/clip media. Following has no recommendation fallback and returns active followed creators only.
- Discover content is mapped by the canonical content access projection and then passed through the
  same server-side Bunny playback/image capability and viewing-allowance decision as feed/detail.
  Discover live rooms use the canonical safety/replay/access projection and the same Livepeer JWT and
  allowance decision as room detail. Provider identifiers and unsigned stored delivery resources are
  never exposed as usable playback; locked/subscriber-only, exhausted-allowance, rejected, and
  quarantined resources fail closed without a short-lived delivery credential.
- `deterministic_v1` now ranks one index-backed candidate window of at most 512 content IDs on page
  one and stores only that derived ordering in a server-only session for at most 30 minutes. The opaque
  cursor carries the session ID, mode/surface, and last delivered ordinal. New posts, impressions, and
  unrelated engagement cannot shift or invalidate the active walk, and later pages never recompute or
  hash the eligible corpus. Current canonical eligibility, visibility, blocks, Following membership,
  Moment expiry, access rules, and entitlements are re-evaluated before each item is delivered; revoked
  items are skipped. Engagement counters and viewer reaction state are read live for display but do not
  re-rank the snapshot. Cross-surface reuse is rejected, and only an expired or unavailable session
  requires a first-page restart.
- Ranking uses only follow, bounded freshness, projected engagement quality, creator diversity, bounded exploration, and prior-impression de-prioritisation. Purchase value, wallet balance, settlement, creator earnings, checkout, membership, and Commerce Kit data are not queried and cannot influence ranking.
- Engagement counters and follow counts are maintained as bounded write-time projections. The feed reads those projections, selects page IDs before playback/access lateral reads, and avoids count-correlated subqueries and per-card API calls.
- The web Home surface renders the mixed feed plus its real live rail. `/app/bits` renders the same canonical projection as an immersive vertical surface. Both mount playback only for the active item, preload only the next poster, restore route scroll, reconcile real engagement/follow mutations, and render explicit loading/error/empty/exhausted states. Neither surface renders local business-data fixtures or raw provider payloads.
- Create exposes the required human labels `Safe for everyone`, `Adult`, and `Explicit`. Adult/Explicit drafts and provider uploads remain private and resumable before adult-publisher verification; only explicit submission/publication rechecks the contextual adult-publisher capability. This never invokes creator KYC or earnings setup.

## Feed Surfaces

```text
Home
  mixed feed: live/moments/replays rail + media cards
  ranking tabs: For You, Following
  content filter: Both, Safe only, Adult only

Bits
  immersive short-video feed
  free/discoverable by default
  vertical swipe/scroll = next or previous media

Discover
  search + hashtags + creators + events + content categories

Profile
  creator-owned grid/tabs

Mutuals Mode
  explicit opt-in creator media only when both creator and viewer have Mutuals enabled
```

Home/Bits gesture lock: the visible action rail owns like, comment, save, share, and Support; Not interested remains a visible action/menu. Horizontal swipes never create Mutuals, buy a product, join an event, grant paid access, or send funds. Event and future product media may expose at most one primary contextual CTA (`View Event`/`Get Access` or `View Product`/`Buy Product`), followed by explicit detail and confirmation. Money never affects ranking, Mutuals priority, or message priority.

Future native Product Offers are contextual metadata, not ranking authority. A profile, Post, Bit, or live stream may expose one eligible offer after backend policy/moderation filtering, but purchase value, wallet balance, checkout completion, seller revenue, or Commerce Kit events cannot buy recommendation weight, creator visibility, Mutuals priority, or message priority. Commerce Kit has no role in feed selection.

## Feed Modes

Home should expose simple controls, not too many categories:

- `Recommended`: recommended mixed media, default.
- `Following`: creators the viewer follows.
- Ranking mode and content preference are independent controls. `default_feed_mode` is only `recommended | following`; `nsfw_preference` is only `both | sfw | nsfw`.
- `Both`: safe and adult/explicit media.
- `Safe only`: excludes adult and explicit media.
- `Adult only`: includes only adult and explicit media.

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

Veel is 18+ only, so NSFW/SFW is not an account type or app-access gate. It is a per-media rating and a viewer preference filter for age-verified adults.

Recommended launch behavior:

- before age verification: no protected app access
- after age verification and wallet setup: viewer can choose feed preference
- default feed mode for new verified users: `Recommended`
- default safety preference: `both`
- quick Home/Bits content filter independent from `For You`/`Following`
- one-click `Both`, `Safe only`, and `Adult only` preference under Settings
- clear content warnings and report/block controls

Creator Create/Edit:

- required `nsfw_label`; `none` means SFW
- optional content warning category
- moderation can correct or override labels
- repeated mislabeling can restrict monetisation/discovery
- Mutuals is not a Create/Edit field; creator profile/settings controls Mutuals-active visibility on media

Publishing policy is capability-based on one universal account:

- age assurance permits SFW upload and publishing
- adult-publisher eligibility is required only for `adult` or `explicit` media
- creator KYC controls earning readiness, not ordinary SFW publishing
- Studio and Enterprise access comes from backend plan/organization policy, never from KYC alone

NSFW states:

```text
none
adult
explicit
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
- creator quality/safety signals
- diversity/fairness constraints
- ranking mode: Recommended / Following
- content preference: Both / Safe only / Adult only

Do not use:

- private message content
- raw age/KYC provider data
- raw wallet balances
- sensitive identity data
- AI-inferred sensitive traits
- hidden paid ranking boost
- referral commission eligibility as a ranking shortcut

## Ranking Goals

Rank for:

- relevant media discovery
- creator monetisation opportunity
- safe adult-content handling
- diversity across creators
- healthy engagement
- low report/block rate

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

The launch `deterministic_v1` pipeline is:

1. filter by policy, age, block graph, visibility
2. boost following
3. boost fresh content
4. boost good engagement ratio
5. diversify creators
6. apply the independent content preference
7. apply prior-impression de-prioritisation and bounded deterministic exploration
8. freeze at most 512 ranked IDs in a 30-minute server-only session and paginate by session ordinal,
   rechecking canonical eligibility and access at delivery

Only add ML/vector personalization after enough data exists.

## Transparency And User Controls

Feed ranking must be explainable enough for users, admins, and compliance review.

Required launch controls:

- `Why am I seeing this?` summary on media detail/menu
- hide creator
- hide hashtag/topic
- block/report creator
- reset recommendations
- Following feed that does not rely on behavioral profiling
- NSFW/SFW preference stored under Settings
- moderation and safety filters applied before ranking

Commercial separation rule:

- Veel does not sell ranking weight, recommendation visibility, or preferential discovery.
- Contextual access and Product Offer actions may be rendered after an item is selected, but payment, purchase, subscription, revenue, wallet, referral, and entitlement facts do not influence selection or score.
- Authorized private analytics may measure commerce outcomes by feed mode; those measurements are never ranking inputs.

## Feed API

```text
GET /v1/content/feed?mode=recommended
GET /v1/content/feed?mode=following
PATCH /v1/feed/preferences { "defaultMode": "recommended|following", "nsfwPreference": "both|sfw|nsfw" }
POST /v1/feed/impressions
GET /v1/discover/hashtags/:slug
GET /v1/discover/search?q=...&contentCursor=...&creatorCursor=...&hashtagCursor=...&eventCursor=...&liveCursor=...
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
- `Safe only` excludes adult and explicit media on every public content surface
- `Adult only` includes only adult and explicit media and remains behind platform 18+ access
- anonymous public profile content is Safe-only
- ranking tabs never overwrite the saved content preference
- following mode returns active followed creators only, with no recommendation fallback
- blocked creators/content do not appear
- hashtags parse and normalize
- mentions notify unless muted/blocked
- creator mislabel correction is audited
- feed pagination is stable
- grouped Discover pagination keeps an independent validated cursor per group, preserves timestamp
  ties with an ID key, cannot feed a content timestamp into a live-room UUID predicate, and does not
  lose an unseen live room when its state changes between pages
- Discover responses never expose usable private Bunny or Livepeer delivery without the canonical
  short-lived credential; locked/subscriber-only content, rejected/quarantined live rooms, and
  exhausted public-media allowances remain blocked
- replayed and concurrent impression keys increment at most once; changed-content key reuse returns conflict
- Home and Bits render from the real feed contract on desktop and mobile
- ranking does not expose internal sensitive signals
