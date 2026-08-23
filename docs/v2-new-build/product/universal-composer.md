# Universal Composer

Status: accepted
Scope: one creator draft and rendering lifecycle for photo, video, carousel, text, and poll posts
Last updated: 2026-08-22
Source of truth: yes for Convergence 02 product behavior

Owns:
- creator format selection, draft recovery, ordered assets, text posts, polls, and shared rendering behavior
- the provider-safe image boundary and provenance projection for these formats

Defers to:
- OpenAPI for request and response shapes
- migrations for constraints and transactional behavior
- media-safety docs and ADR 0003 for quarantine and release evidence
- provider docs and adapters for Bunny Stream, Bunny Storage, Optimizer, and Shield behavior

Does not own:
- access, payment, entitlement, classification, moderation, performer consent, or publication approval truth

Launch scope:
- single photo, existing Bunny Stream video, photo carousel, mixed image/video carousel, plain structured text, and polls

Non-goals:
- a timeline editor, arbitrary HTML, browser-owned ordering, direct provider credentials, custom transcoding/CDN, or a second content table

## Product Contract

The canonical `/app/create` route starts with three choices: **Photos or video**, **Write
something**, and **Poll**. The selection progressively reveals only fields relevant to that format.
Every path creates or resumes one server-owned `content_items` draft and uses the same audience,
rating, people/rights, review, publication, and owner workspace.

```text
choose format
-> create/resume server draft
-> add text or ordered assets
-> preview
-> caption/question
-> audience and rating
-> people/rights declaration
-> submit for review
```

Local storage contains presentation recovery only: the current format choice, unsent field values,
local file handles/fingerprints where the browser permits them, and the canonical draft id. It never
becomes publication, moderation, asset order, poll count, or provider truth. Autosave uses an
optimistic draft revision and reports conflicts instead of silently replacing newer server state.

The visible submission action is singular. Video transfer may pause/resume through the existing
Bunny Stream TUS boundary. Image transfer may retry, but the UI must not claim byte-resume unless the
selected provider path proves it. Reorder, replace, and remove operations persist through the API;
the browser does not manufacture final positions.

## Canonical Data

`content_items.media_type` remains the format discriminator. Existing `bit`, `clip`, `vod`, and
`live_replay` are video renderers; `image` is a single photo; `carousel`, `text`, and `poll` extend
the same authority. Text content is stored as bounded plain structured text. Hashtags, mentions, and
links are parsed into safe application tokens at the API/read boundary; user HTML is never rendered.

`media_assets` is the only asset list. Assets have a server-owned zero-based position, image/video
kind, validated MIME, dimensions, duration, alt text, SHA-256 checksum, cover/focal metadata,
required-for-release state, and provenance. A content item has at most ten assets and at most one
cover. Single-photo posts accept one image, existing video formats accept video, carousels accept a
mix, and text/polls accept none. Drafts may be incomplete; publication validates the completed
shape.

Poll records are subordinate to a `content_items` row. A poll has one question, two to four ordered
options, an optional close time, and one current vote per user. Vote writes are idempotent and update
the old/new option counters in the same Postgres transaction. Option text/order becomes immutable
after the first vote. Counts and viewer choice come from the backend projection; the browser never
increments them optimistically as truth.

Authenticated feed and detail reads project this composition from the canonical rows in one query:
bounded plain text, every normalized asset in server-owned position order, and the poll options,
transactional counts, close state, and current viewer choice. Only the frontend-safe OpenAPI fields
leave the API; provider payloads, private provenance details, checksums, and storage references do
not. The top-level poster/playback projection remains the compatibility path for the selected release
asset, while every ordered video asset carries its own normalized playback resource for the shared
carousel renderer. Feed and detail routes pass both projections through the same backend signer,
deduplicate signing of the selected asset, and never serialize a stored Bunny playlist URL; signer
failure returns normalized blocked playback. Paid or otherwise gated cards redact body text, poll
state/options, and per-asset delivery URLs until the
viewer has canonical access; the creator remains authorized through the canonical app user id.

## Safety And Release

Every media asset begins private and unavailable for public rendering. All assets marked
`required_for_release` must have complete provider readiness and the canonical normalized automated
plus human release evidence before the content can publish. One approved cover cannot stand in for
an unreviewed carousel asset. A rejected, missing, replaced, or position-conflicted required asset
keeps publication fail-closed.

Text and poll content use the same `media_safety_cases`, report, appeal, and staff review authority;
they do not bypass moderation merely because no provider media exists. Performer declarations and
adult-publisher eligibility remain independent contextual gates. Creation never implies KYC or
earnings readiness.

## Image Provider Boundary

Official Bunny documentation reviewed on 2026-08-20 establishes:

- Bunny Storage accepts raw file bodies at an opaque zone/path and authenticates with the
  server-only storage-zone `AccessKey`.
- The upload endpoint can verify a supplied SHA-256 checksum.
- Bunny Optimizer Dynamic Images produces cached derivatives by URL parameters without storing
  redundant manual sizes, when Optimizer and Dynamic Images are enabled for the Pull Zone.
- Bunny Shield upload scanning is private and scans raw streams, but does not sanitize files.

The selected code boundary is therefore one server-streamed image upload through a narrow WeVid
endpoint to private Bunny Storage. Storage credentials never reach the browser. The backend checks
declared and detected MIME, byte and decompressed-pixel limits, dimensions, checksum, orientation,
and strips EXIF/GPS/device metadata before an opaque object is eligible for release. Optimizer owns
responsive derivatives after release. No image provider path is production-enabled until staging
proves private upload, Shield coverage, sanitization, optimized delivery, deletion, recovery, and
credential rotation for the exact release artifact.

The implemented upload boundary accepts raw JPEG, PNG, or WebP bodies up to 20 MB. It re-encodes
the detected format with Sharp after orientation normalization, strips source metadata, limits
decoded pixels and dimensions, then binds the sanitized SHA-256 checksum to a durable idempotent
asset reservation before the server-only Bunny upload. Exact retries converge on the original
opaque object path; changed-input key reuse conflicts. A completed Storage upload remains
`stored_private` and explicitly non-playable until independent provider scan, classification, and
human release evidence exists. `BUNNY_STORAGE_IMAGE_UPLOAD_ENABLED=false` is the default and the
adapter also requires the Storage zone credential, regional endpoint, private Pull Zone, and token
key before accepting uploads. The token key is reserved for the protected delivery path and never
enters a browser bundle.

Draft asset removal is a two-authority operation, not a browser splice. The database first retires
the asset, removes it from the ordered active composition, advances the optimistic revision, stops
unfinished moderation jobs, and records a lifetime idempotency receipt plus audit event. Provider
deletion then uses Bunny Storage `DELETE` for images or Bunny Stream `DELETE` for videos. A provider
outage leaves an explicit durable `retry` cleanup state while the retired object remains private and
excluded from every read/release predicate; an already-absent provider object is treated as an
idempotent cleanup success. A lease-based worker drains due cleanup rows every minute with bounded
exponential backoff, so cleanup survives API restarts and concurrent workers cannot own the same
attempt. Normalized safety evidence is retained against the retired asset, while admin operations
show the normalized cleanup state without provider credentials or raw payloads.

Official references:

- https://bunny.net/docs/api-reference/storage/index
- https://bunny.net/docs/api-reference/storage/manage-files/upload-file
- https://docs.bunny.net/api-reference/storage/manage-files/delete-file
- https://docs.bunny.net/api-reference/stream/manage-videos/delete-video
- https://bunny.net/docs/optimizer/dynamic-images/overview
- https://bunny.net/docs/optimizer/limits
- https://bunny.net/docs/shield/upload-scanning

## Provenance

Every asset declares one origin: `human_created`, `ai_assisted`, `ai_generated`, or
`materially_ai_manipulated`. The normalized record may retain opaque source-lineage,
workflow/provider, human-review, visible-label, machine-readable-marking, and C2PA references. It
must never retain private prompts, provider keys, credentials, or raw provider payloads. The visible
label is derived from canonical provenance and moderation policy, not browser copy.

## Renderer Family

The Create surface uses one media selection step. A single image becomes an `image` draft, a single
video retains an explicit Bit/Clip/Long video choice, and any two-to-ten image/video selection
becomes one `carousel` draft. Images continue through the private server-streamed Storage boundary;
videos continue through the resumable Bunny Stream TUS boundary. The UI can pause/resume the active
video transfer, describes every ordered item, and never changes a saved draft's format merely because
an item is added or removed. Replacement therefore remains a canonical retire-then-add operation of
the same saved format, while a mixed composition must be selected before its carousel draft is made.
Video-session creation rejects non-video/non-carousel drafts before any provider call.

One content renderer family is reused by Home, Bits, detail, profiles, and share previews:

- image renderer;
- provider-owned video renderer;
- accessible carousel composing those image/video renderers;
- safe structured-text renderer;
- accessible poll renderer.

Carousel controls support touch, mouse, visible previous/next buttons, keyboard navigation, an
announced position indicator, reduced motion, adjacent-only lazy loading, and at most one active
video. Bits may admit only formats its surface contract can render without creating another content
or player implementation.

## Operations And Proof

Admin content review shows format, ordered asset count, per-asset readiness/evidence, provenance
label, poll report state, and the exact asset blocking release without exposing sensitive media or
provider payloads. Provider outages and incomplete image configuration remain explicit fail-closed
states.

Acceptance must prove photo, carousel, mixed carousel, ordering conflicts, concurrent updates,
metadata removal, rejected-asset release blocking, replacement/removal, text parsing, poll shape,
vote replay and concurrency, option locking, accessibility, resumable video, responsive rendering,
and provider staging or deterministic fail-closed behavior.
