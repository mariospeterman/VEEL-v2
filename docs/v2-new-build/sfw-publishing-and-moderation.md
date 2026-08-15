# SFW Publishing And Moderation

Status: accepted
Scope: Launch 03A safe-for-work creation, quarantine, review, publication, and creator appeals
Release state: CODE_COMPLETE_PROVIDER_BLOCKED

## Product Behavior

An age-ready universal user can publish lawful safe-for-work video without creator KYC or earnings setup. The Create surface is preview-first: choose a video, add a caption and audience, declare who appears and confirm rights, then upload with one primary action. Draft fields are restored locally after a safe close. Uploads can pause/resume through the official TUS client.

The browser uses plain product language. Bunny, TUS, provider status, scan internals, and raw safety evidence are never shown. Adult/explicit creation remains outside this slice and fail-closed.

## Canonical Lifecycle

`content_items`, `media_assets`, `content_safety_declarations`, and `media_safety_cases` remain the existing authorities. The owner projection maps their canonical states to:

`draft → upload_pending → processing → in_review → published`

Review can instead produce `changes_requested`, `rejected`, `appeal_pending`, or `blocked`. These are read-model labels, not a second state machine.

- Every draft receives a people-and-rights declaration.
- Every provider object remains private/unreleased.
- Provider playback readiness never grants moderation approval.
- `private.content_safety_release_ready` and the database trigger remain the final release guard.
- Public profile queries require ready, public, approved, and `publish_state = 'published'`.
- Owner profile media includes private drafts and uploader-safe staff messages.
- Appeals are owner-authorized, replay-safe, audited, and return the canonical safety case to the staff queue.

## Provider Boundary

Bunny Stream creation and TUS authorization stay server-side. The browser receives only a short-lived upload session. The worker deliberately returns `review_required` until the exact automated classifier/hash path is staging-approved. Local and PR validation use deterministic provider fixtures; no fixture is treated as provider approval.

Launch 03A is `CODE_COMPLETE_PROVIDER_BLOCKED` until `pnpm proof:bunny-sfw` succeeds with the staging library, staging webhook/domain controls, private playback, and the approved media-safety provider path. Production release remains fail-closed.

## Operations And Recovery

Staff can approve, request changes, keep in review, or reject/block with an uploader-safe message. Every decision is audited. Moderation jobs retain lease recovery, retry, and dead-letter visibility in the existing admin operations surface. Appeals do not release media and cannot bypass provider or performer readiness.

## Verification

- OpenAPI contracts cover owner publication state and appeals.
- Migration `0092` adds the safe decision projection and scoped appeal replay key.
- API route tests cover safe projection and appeal handoff.
- Real local Postgres tests cover SFW creation without KYC, private quarantine, public-profile exclusion, request-changes, idempotent appeal, and existing cross-product journeys.
- Playwright covers the preview-first responsive Create surface and absence of provider jargon.
