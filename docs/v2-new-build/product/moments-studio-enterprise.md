# Moments, Studio, and Enterprise

Status: accepted
Scope: temporary media distribution, individual creator workspace, and organization workspace boundaries
Last updated: 2026-08-24
Source of truth: yes for Convergence 09B product behavior

## Product Boundaries

`/app/studio` is the individual creator workspace. Every eligible creator can use its publishing,
content-library, readiness, and monetisation entry points. Free, Plus, Ultra, and Studio are
backend-owned platform tiers; the Studio tier adds individual professional capabilities such as
advanced analytics and scheduling limits where configured. A tier never buys reach, ranking,
recommendation weight, message priority, or access to people.

`/app/enterprise` is the organization workspace. It contains accepted organization memberships,
permission-scoped coworkers, KYB readiness, managed-creator agreements, consolidated analytics, and
confirmed-allocation evidence. Enterprise authority comes from the exact active organization
membership, capability, permission, agreement, and compliance projections. It is not inferred from
the Studio tier, creator KYC, a wallet, or browser state. WeVid holds no organization or creator
balance and owns no payout queue.

`/app/profile` is the media-first public identity hub. Published media remains primary; readiness,
analytics, pricing, compliance, and operational state live in Studio. Existing organization links to
the former combined Studio surface redirect safely to Enterprise without preserving a duplicate
workspace.

## Moments

A Moment is a `content_items.distribution_mode`, never a second content system. It accepts the same
image, video, or carousel composition, safety evidence, moderation, access rules, signed provider
playback, engagement, reports, and retirement path as a post. A published Moment receives a
server-owned 24-hour `expires_at`; the canonical eligibility function excludes it afterward.

Home presents a bounded live/Moment tray. `/app/moments` is a keyboard- and touch-compatible
sequential viewer that reuses the canonical content renderer and feed-impression authority. Reply in
Messages pre-fills the canonical shared-content field in an existing conversation; the existing
message-request, consent, block, mute, and attachment policies remain authoritative.

## Scheduled Publication

Creators may select a future local date/time in Create. The browser submits only an ISO timestamp.
After moderation and release evidence are complete, `content_items.publish_state = scheduled`
creates one `content_publication_jobs` row through a database trigger. The bounded lease worker
rechecks creator state, content state, moderation, rights/safety, composition, and provider readiness
at release time. It may publish, retry with bounded backoff, or dead-letter; it never bypasses a
release predicate.

Admin operations includes scheduled-publication queue counts and permission-scoped, reason-required,
audited dead-letter recovery. Creator Studio shows scheduled, retry-attention, and published states.
Changing or cancelling a schedule updates the one canonical job; there is no browser timer or second
calendar truth.

## Acceptance

- OpenAPI exposes distribution, expiry, schedule, and scheduled owner state without provider payloads.
- Migration `0117` applies on the full chain, creates/cancels jobs transactionally, rejects non-media
  Moments, rolls back, and reapplies.
- Unit/API tests cover schedule propagation, invalid Moment shape, worker outcomes, and Admin recovery.
- Desktop and mobile browser proof covers Home tray, viewer, Create, Profile, Studio, Enterprise, and
  Messages handoff.
- Shared provider and cloud proof remains fail closed in the staging acceptance matrix.
