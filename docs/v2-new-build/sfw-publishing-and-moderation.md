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
- `private.content_safety_release_ready` and the database triggers remain the final release guard. Migration `0106` requires the latest normalized container-integrity, malware, known-hash, classification, and staff-review signals to be attributable and clear, and immediately blocks public access if a later required signal is not clear.
- Public profile queries require ready, public, approved, and `publish_state = 'published'`.
- Owner profile media includes private drafts and uploader-safe staff messages.
- Creator publication submission and moderation-appeal state changes use the shared Postgres transaction boundary so canonical safety state and audit evidence commit or roll back together.
- Appeals are owner-authorized, replay-safe, audited, and return the canonical safety case to the staff queue. A replay key is bound to the content id and normalized reason; changed-input reuse fails with a conflict.
- Staff decisions close the active appeal in the same transaction. An accepted appeal restores release-eligible blocked content to published, while the database release guard still requires approved safety and provider-ready media.
- Rejected and appealed owner states take precedence over the generic blocked projection so the creator can see the decision and reach the appeal workflow.

## Provider Boundary

Bunny Stream creation and TUS authorization stay server-side. The browser receives only a short-lived upload session. The worker deliberately returns `review_required` until the exact automated classifier/hash path is staging-approved. Local and PR validation use deterministic provider fixtures; no fixture is treated as provider approval.

Launch 03A is `CODE_COMPLETE_PROVIDER_BLOCKED` until `pnpm proof:bunny-sfw` succeeds with the staging library, staging webhook/domain controls, private playback, Shield upload scanning enabled, written confirmation that direct Stream TUS traffic is covered, and real positive/negative malware, known-hash, and classifier fixtures. The written confirmation and fixture run are recorded as the release-manifest-bound `STAGING_MEDIA_SAFETY_PROOF_ID`. Production release remains fail-closed.

## Operations And Recovery

Staff can approve, request changes, keep in review, or reject/block with an uploader-safe message. Every decision is audited. Moderation jobs retain lease recovery, retry, and dead-letter visibility in the existing admin operations surface. Appeals do not release media and cannot bypass provider or performer readiness.

## Verification

- OpenAPI contracts cover owner publication state and appeals.
- Migration `0092` adds the safe decision projection and scoped appeal replay key. Migration `0093` binds that key to a validated request hash. Migration `0106` makes complete normalized automated and human evidence mandatory for release while preserving evidence on rollback.
- API route tests cover safe projection, appeal handoff, and mandatory adult-publisher reauthorization for representation-only edits in every editable content state.
- Real local Postgres tests cover SFW creation without KYC, private quarantine, rejected/appealed owner projections, changed-input replay rejection, transactional appeal resolution, blocked-content restoration after an accepted appeal, and existing cross-product journeys.
- Playwright covers the preview-first responsive Create surface, paginated creator media workspace, appeal submission, and absence of provider jargon on desktop and mobile.
