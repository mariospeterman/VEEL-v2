# ADR 0003: Provider-Native Media Safety And Consent

Status: accepted
Scope: Bunny Stream, Bunny Shield, Livepeer, moderation, performer consent, reporting
Last updated: 2026-08-22
Source of truth: yes

Owns:
- media safety cases, provider scan evidence, performer declarations/consent, and release gating

Defers to:
- OpenAPI, migration `0088`, provider contracts, counsel, and official provider documentation where narrower

Does not own:
- age-access policy, creator earning KYC, payment settlement, raw identity evidence, or provider account approval

## Decision

`media_safety_cases` is the canonical release decision. `content_items.moderation_state` is a read projection. Provider readiness, provider scan signals, creator labels, and staff actions are inputs; none is independently sufficient to publish media.

The release predicate requires:

1. a provider-playable media asset;
2. an active safety case in `approved` state with `provider_release_allowed=true`;
3. an active creator declaration;
4. valid adult-publisher identity plus scoped performer consent for adult/explicit media.

Provider “clear” signals are normalized into `provider_media_scan_events` and still route to a staff release decision. Migration `0106` makes that evidence enforceable: the latest attributable container-integrity, malware, known-hash, and content-classification signals must all be clear for the same playable media asset before staff can approve. Approval selects that exact asset as the canonical release projection and records a normalized manual-review signal bound to it; public reads never substitute another upload. A later adverse required signal for the selected release immediately removes already-published content from public access, while valid adverse evidence remains effective even when a companion provider signal is malformed. A known-hash match also opens an idempotent reporting-review workflow. Automated systems do not issue irreversible user sanctions.

## Upload Decision

Bunny Stream TUS remains the VOD upload provider. The video object is private/quarantined until the release predicate passes. Bunny Stream provider readiness only sets media processing state.

Bunny Shield upload scanning is not assumed to cover direct `video.bunnycdn.com/tusupload` traffic. Official Shield documentation confirms upload scanning for request bodies routed through Shield, including malware and PDQ-based known-hash checks, but it does not establish direct Stream TUS coverage. Therefore:

- `BUNNY_SHIELD_UPLOAD_COVERAGE=not_configured` is the default;
- direct Stream TUS cannot be marked covered without written provider confirmation and a staging incident fixture;
- staging requires `BUNNY_SHIELD_UPLOAD_COVERAGE=stream_tus_provider_confirmed`, a live Shield configuration check, and a release-manifest-bound `STAGING_MEDIA_SAFETY_PROOF_ID`; configuration or playability alone is not coverage evidence;
- `MEDIA_MODERATION_MODE=disabled_fail_closed` routes ready assets to review;
- a dedicated Shield-covered upload gateway is an allowed future option only if it preserves resumable uploads and does not duplicate Stream storage/transcoding.

Disable Bunny Stream Early Play for quarantined uploads. Enabling Keep Original requires a retention/deletion review because the source file becomes a distinct provider-held copy.

Image uploads use the same canonical safety case but a separate narrow Bunny Storage boundary.
The API detects and re-encodes JPEG, PNG, or WebP, applies decoded-pixel and dimension limits,
normalizes orientation, strips metadata, computes the sanitized checksum, and durably reserves an
opaque object path before the server-only upload. Storage acceptance only advances the asset to
`stored_private`; it does not set provider playability or satisfy scan, classification, or human
review evidence. The path defaults disabled and remains candidate pending exact staging proof of
Shield coverage, private token-authenticated delivery, Optimizer behavior, deletion, recovery, and
credential rotation.

Draft image/video removal retires the canonical composition row first, preserves normalized
evidence and audit history, then invokes the documented Bunny deletion endpoint. Provider failure
is a durable retry state rather than a composition rollback.

## Live Decision

Livepeer remains the live/replay provider. Official APIs support multistream targets and the stream `suspended` property. The preferred safety path is a provider-supported moderation rendition/target plus server-side suspension, but it remains candidate until staging proves:

- target creation before the broadcast session;
- rendition selection and reconnect behavior;
- webhook delivery and replay protection;
- suspension blocks ingest and playback within the accepted response window;
- restart/recovery and replay handoff remain fail closed.

`LIVEPEER_ADULT_LIVE_ENABLED=false` remains the default. A thumbnail is only a fallback signal, not continuous moderation.

Convergence 05 strengthens the candidate boundary without promoting it: every room carries the exact `this_live_stream_is_sfw` declaration but begins `monitoring_pending` and locally quarantined. Stream creation binds the configured source-profile moderation multistream target. Viewer playback and chat release only after the signed `multistream.connected` acknowledgement for that exact target and a fresh worker-owned `GET /stream/{id}` observation confirming active, healthy, recent provider state converge with the canonical room. The one-time `stream.started` lifecycle callback is never treated as a recurring heartbeat. Disconnect, error, inconsistent target identity, provider uncertainty, or health expiry denies local delivery first and then enters a durable worker suspension queue. Provider failure never reopens local delivery. Staff resume also returns to monitoring-pending instead of fabricating approval. Adult live remains disabled regardless of credentials.

Recorded replays are a new quarantined content revision, not permission to reuse the live playback projection. `recording.ready` creates a private replay, separate provider asset, safety case, and moderation job; playback is issued only after provider readiness plus canonical approval and publication.

## Data Minimization

Veel stores normalized decisions, payload hashes, opaque provider references, confidence/ruleset metadata, consent scope/version, and reporting state. Veel does not store raw provider payloads, illegal-media copies, identity documents, selfies, biometric templates, or browser-visible provider secrets in this domain.

## Provider State Matrix

| Path | State | Launch evidence still required |
| --- | --- | --- |
| Canonical DB release guard and manual review fallback | staging-approved | Admin browser QA and CI |
| Normalized automated-evidence completeness guard | staging-approved | Real provider positive/negative fixtures |
| Bunny Stream TUS/private playback | candidate | Real account, private quarantine, Early Play disabled, token/domain smoke |
| Bunny Shield direct Stream TUS coverage | candidate/unproven | Written provider confirmation plus positive/negative staging fixtures |
| Bunny Shield event-log reconciliation | candidate | Auth, pagination, incident semantics, reporting reconciliation fixture |
| Bunny Storage private image ingestion | candidate/code-complete boundary | Storage/Shield credentials, sanitization fixture, signed Pull Zone delivery, Optimizer, deletion/recovery, and rotation proof |
| Livepeer moderation multistream | candidate | Real target/session/webhook smoke |
| Livepeer emergency suspension | candidate | Measured ingest/playback block and recovery test |
| Adult live | disabled | Counsel/policy approval and launch-approved monitoring/suspension |

No candidate row can be treated as production protection.

## Official Documentation Checked

Livepeer behavior was rechecked on 2026-08-23 before the Convergence 05 adapter and webhook changes.

- Bunny Shield upload scanning: https://docs.bunny.net/shield/upload-scanning
- Bunny Shield upload-scanning configuration API: https://docs.bunny.net/reference/get_shield-shield-zone-shieldzoneid-upload-scanning
- Bunny Shield event logs: https://docs.bunny.net/api-reference/shield/eventlogs/get-shieldevent-logs-
- Bunny Stream TUS uploads: https://docs.bunny.net/stream/tus-resumable-uploads
- Bunny Stream dashboard and Early Play/Keep Original: https://docs.bunny.net/stream/dashboard
- Bunny Stream encoding/content tagging: https://docs.bunny.net/stream/encoding
- Livepeer multistream: https://docs.livepeer.org/developers/guides/multistream
- Livepeer add multistream target: https://docs.livepeer.org/api-reference/stream/add-multistream-target
- Livepeer update stream/suspension: https://docs.livepeer.org/api-reference/stream/update
- Livepeer terminate stream: https://docs.livepeer.org/api-reference/stream/terminate
- Livepeer create stream/JWT/multistream fields: https://docs.livepeer.org/api-reference/stream/create
- Livepeer retrieve stream health fields: https://docs.livepeer.org/api-reference/stream/get
- Livepeer webhook signatures: https://docs.livepeer.org/developers/guides/setup-and-listen-to-webhooks
- Livepeer webhook event configuration: https://docs.livepeer.org/v2/solutions/livepeer-studio/docs/api-reference/webhooks/update
- Livepeer OBS ingest: https://docs.livepeer.org/developers/guides/stream-via-obs
- Livepeer live thumbnails: https://docs.livepeer.org/developers/guides/thumbnails-live

## Rollback

Migration `0106_media_release_evidence.down.sql` restores the earlier release predicate but deliberately retains additive container-integrity events, their media-asset bindings, the selected-release pointer, and the scan type so rollback cannot erase audit evidence. Content held by `0106` remains held. Migration `0088_media_safety_and_consent.down.sql` removes the wider domain only as part of a coordinated full-domain rollback. No rollback fabricates prior approvals; production rollback must keep affected content unpublished until a replacement safety authority is explicitly approved.
