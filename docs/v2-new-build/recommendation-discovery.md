# WeVid V2 Recommendation And Discovery Architecture

Status: accepted
Scope: Home feed, Bits feed, Discover, hashtags, mentions, NSFW controls, and ordering safety
Last updated: 2026-11-05
Source of truth: yes for v2 content delivery and discovery

Owns:
- chronological Home/Bits ordering and the named discovery behavior

Defers to:
- `INDEX.md`, `route-map.md`, OpenAPI, the immutable migration chain, and narrower ADRs

Does not own:
- provider credentials, payment or entitlement truth, moderation decisions, or hidden ordering rules

Launch scope:
- simple photo, video, and live discovery for verified adults

Non-goals:
- behavioral recommendation scoring, paid visibility, a second eligibility system, or a second feed

WeVid launches with a simple chronological media feed. The backend remains responsible for access,
safety, visibility, and stable pagination, but it does not score, boost, shuffle, or freeze a bounded
candidate window.

Discovery quality and safety must not depend on addictive dark patterns or frontend-only state.

## Current Product Contract

- `GET /v1/content/feed` is the canonical protected Home/Bits read model. It accepts
  `surface=home|bits`, `mode=latest|following`, and an opaque scope-bound keyset cursor.
- `latest` is the default and returns eligible media in reverse publication order. `following`
  applies the same ordering after restricting creators to active follows; it has no fallback.
- Home and Bits exclude retired `text` and `poll` formats. Historical authorized detail, owner,
  admin, and export reads remain available through their existing lifecycle authority.
- Bits accepts only the short-video media types admitted by its surface contract. Home accepts the
  launch photo/video media set. A Moment may appear only through its contextual Moment surface and
  lifecycle; it is not a separate ranked format.
- The canonical `private.eligible_content(...)` decision continues to apply current release,
  moderation, profile, age, visibility, entitlement, preference, hide, block, report, and Moment
  expiry policy before delivery.
- Playback and image resources are issued only after that current access decision. Locked,
  exhausted, rejected, quarantined, or revoked content does not receive a usable provider resource.
- Engagement and relationship counts may be shown, but they never change ordering.

Chronological ordering inputs:
- `published_at DESC`
- `id DESC` as the stable tie-break

The first page captures an upper `(published_at, id)` bound. Every continuation cursor carries that
bound, the last delivered key, the viewer identity, the surface, and the canonical mode. This keeps
the walk stable when newer media is published, preserves timestamp ties, rejects cross-account or
cross-surface reuse, and has no fixed corpus ceiling. Current eligibility is rechecked on each page,
so revoked items are skipped without granting stale access.

## Feed Surfaces

```text
Home
  mixed photo/video feed plus live and Moment context
  tabs: Latest, Following
  content filter: Both, Safe only, Adult only

Bits
  immersive short-video feed
  tabs: Latest, Following
  vertical scroll = next or previous media

Discover
  search + hashtags + creators + events + live

Profile
  creator-owned photo/video grid and authorized historical detail

Mutuals Mode
  explicit opt-in creator media only when both parties have Mutuals enabled
```

Home/Bits gesture lock: visible controls own Like, Comment, Save, Share, Support, and Not interested.
Gestures never create Mutuals, purchase access, join an event, grant an entitlement, or transfer
funds. A contextual commercial action may be rendered after an item is selected, but it cannot
change selection or order.

## Feed Modes And Viewing Controls

- `Latest`: all currently eligible launch media, newest publication first. This is the default.
- `Following`: the same order, limited to creators the viewer actively follows.
- `default_feed_mode` is only `latest | following`.
- `nsfw_preference` is independent and remains `both | sfw | nsfw`.
- `Both`, `Safe only`, and `Adult only` are viewing filters, not ordering modes.

The deprecated `recommended` request value may be accepted only as a compatibility alias that
normalizes to `latest`; responses and newly stored preferences use `latest`. No compatibility path
may restore scoring.

## Discover

`GET /v1/discover/search`, `/hashtags`, `/hashtags/{slug}`, `/creators`, `/events`, and `/live`
remain protected read models. Grouped search uses an independent scope-bound opaque cursor for each
group. The web client advances only the requested group, merges by stable identity, rejects stale
query/account responses, stops non-advancing cursors, and exposes accessible load, retry, and
exhausted states.

Content results use the canonical content projection and delivery decision. Live results use the
canonical room access, safety, replay, and Livepeer credential decision. Provider identifiers and
unsigned stored delivery resources are never exposed as playback.

## Hashtags And Mentions

Hashtags and mentions remain metadata and notification primitives, not ordering inputs.

- `#tag` and `@handle` are parsed server-side from captions/comments.
- Hashtags are normalized lowercase and may be blocked or restricted by audited policy.
- Mentions resolve active profiles and are suppressed by blocks and mutes.
- Hashtag pages and search may filter their own result sets chronologically.
- Creator AI may suggest caption metadata only after creator confirmation.
- Neither hashtags nor mentions can override access, age, or moderation policy.

## NSFW/SFW Viewing Controls

WeVid is 18+ only. Rating is per media item and viewing preference is per verified adult.

- App access remains unavailable before required age readiness.
- New verified users default to `latest` and the configured safe viewing baseline.
- Create requires `Safe for everyone`, `Adult`, or `Explicit` on media.
- Adult/Explicit drafts may remain private and resumable before adult-publisher verification;
  submission/publication rechecks that contextual capability.
- Creator KYC controls earning readiness, not ordinary SFW publication.
- Moderation can correct labels and restrict unsafe or repeatedly mislabeled media.

## Read Model

```text
content_items
  -> current canonical eligibility
  -> surface/media-format filter
  -> latest or active-follow filter
  -> (published_at, id) keyset page
  -> current access and delivery projection
```

No engagement projection, wallet fact, checkout fact, purchase history, creator earnings, referral,
membership, or entitlement value participates in ordering. Entitlements remain an access input only.

## User And Admin Controls

Required user controls:

- Latest and Following tabs
- independent NSFW/SFW preference
- hide creator or topic
- block/report creator
- stable load-more/continuation behavior

Admin may inspect feed health, correct labels, block unsafe content/hashtags, and review report rates.
Admin cannot sell or manually assign ordering priority, bypass age/access policy for viewer resources,
or expose private signals.

## Feed API

```text
GET /v1/content/feed?mode=latest&surface=home
GET /v1/content/feed?mode=following&surface=bits
PATCH /v1/feed/preferences { "defaultMode": "latest|following", "nsfwPreference": "both|sfw|nsfw" }
POST /v1/feed/impressions
GET /v1/discover/hashtags/:slug
GET /v1/discover/search?q=...&contentCursor=...&creatorCursor=...&hashtagCursor=...&eventCursor=...&liveCursor=...
```

Responses include the content projection, creator relationship, access/safety state, engagement
display state, and opaque continuation cursor. `rankingVersion` is a compatibility field whose
chronological value is `chronological_v1`; it does not imply scoring.

## Retired Ranking History

The previous `deterministic_v1` implementation created a server-side session containing at most 512
ranked IDs for 30 minutes. A rollback-only 100,000-row PostgreSQL plan measured 100,520 function
rows, about 1.0 million shared-buffer hits, temporary spill, and roughly 8.5 seconds because the
canonical eligibility function materialized the eligible set before joining the bounded candidate
window. These figures remain historical evidence for why that architecture was retired. They are
not a launch target, fallback design, or permission to restore a fixed feed ceiling.

## Tests

- an unverified user cannot enter the protected feed
- Latest orders by `published_at DESC, id DESC`
- Following uses the identical keyset order and has no fallback
- pagination preserves ties, rejects wrong scope/account, and traverses beyond 512 items
- a newer insert after page one does not shift the bounded walk
- a revoked item is omitted when a later page is read
- Home/Bits exclude retired text and poll formats
- Safe only and Adult only remain independent of feed mode
- blocked, hidden, reported, expired, or unauthorized media does not appear
- Home/Bits retain at most 60 mounted cards while preserving visible/focused anchors and Back state
- grouped Discover cursors remain independent and stale responses cannot overwrite current results
- content/live discovery never exposes an unauthorized Bunny or Livepeer resource
- money, purchase, entitlement value, and engagement do not affect ordering
