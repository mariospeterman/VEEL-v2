# WeVid content/social API audit — 71ceabcfaa8a5258e1b935a391ff4e6e7330c682

Scope: content/media, discovery, social engagement/privacy, events/access passes, live, messages/commercial requests, Mutuals, notifications, organizations/managed creators, performer consent. All112 assigned source files and16 dedicated tests were read fully. Shared API megatests were only searched/read in relevant sections; full review is not claimed. Static findings are source-verified; provider-live behavior is not asserted proven. Targeted reduced-schema PostgreSQL proofs ran; existing full-repo suites remain root-owned. Read coverage is recorded separately.

## Confirmed findings

### CONTENT-01 — P1: ready media cannot enter publication review

`apps/api/src/modules/content/content-core-routes.ts:467` calls `findOwnedContentForUpload` before submitting publication. That query in `content-media-repository.ts:794` requires `ci.state in ('draft','processing')`. Successful provider sync/webhook changes state to `ready` (`content-media-repository.ts:906`, `1063`), while `publishOwnedContent` requires ready media (`content-publish-repository.ts:110`). A normally completed image/video upload therefore receives404 before its review submission can execute. Text/poll can work because their state may remain draft. Fix: distinct publication-authorized owned lookup or use existing update/read method; allow ready content according to publication state rather than reusing upload lookup. Test actual create→upload→sync ready→publish route against database, not a mocked repository.

### CONTENT-02 — P1: video upload initialization ignores durable idempotency

`content-upload-routes.ts:222` requires Idempotency-Key but calls Bunny `createUploadSession` at299 and `createMediaAsset` at306 without the key/request hash/receipt. Every response-loss retry creates another provider video and media asset. Changed payload reuse is accepted too. Image upload has a durable reservation flow; normal video upload does not. Fix: reserve actor/draft/logical-operation before provisioning, retain exact provider video/session, replay/re-sign same VideoId and reject changed inputs, with durable compensation. Tests: simultaneous same-key requests, lost response, expired signing credentials, changed-file same-key, attach failure.

### CONTENT-03 — P1: Bunny receipt can commit without replayable event

`content-media-repository.ts:915-959` writes `provider_webhook_receipts`, then `provider_events` through separate autocommit statements. Failure/crash between them permanently suppresses redelivery because existing receipt returnsfalse at935; worker replay cannot recover an event that was never written. Live path uses a transaction and checks processed state. Fix receipt+event atomic transaction; redelivery repairs missing event and applies unprocessed event. Test failure after receipt write and after event write before apply. Root should consolidate with similar payment webhook issue if found.

### CONTENT-04 — P1: reaction toggles reapply delayed replayed commands

`engagement-content-actions-repository.ts:21-53` (like),75-106(save), `engagement-comment-repository.ts:343-368` (commentlike): persistent receipt is upserted but always feeds mutation. Only last_idempotency_key deduplicates. Sequence A=like, B=unlike, replayA toggles back toliked; receipts are not enforcing lifetime replay. Fix execute only newly claimed command and return canonical state on replay; consider explicit desired-state PUT/DELETE with sequence policy. Test A/B/A and concurrent distinct commands plus immediate A/A.

### CONTENT-05 — P1: discovery bypasses canonical media access/projection/signing

`discover-repository-mappers.ts:22-60` has a competing content access mapper; it classifies anything other than locked/paid/content_unlock asfree (subscriber_only/live_pass/teaser handling diverges). It exposes stored `playback_url` asfull and poster_url regardless of locked composition policy. `discover-routes.ts` returns repository resources directly, never `withSignedPlayback`. `discover-repository-mappers.ts:77-128` invents safetyState from roomstate and returns raw live playback; `discover-directory-queries.ts:120-184` omits media safety release, replay-release authorization and usage. This definitely leaks canonical private delivery metadata and bypasses quota/signing decision. Actual unauthenticated byte exposure depends on CDN/JWT configuration: correctly protected origins reject unsigned requests, giving broken playback instead; do not claim provider authentication can be bypassed if enabled. Fix discovery return safe metadata or use shared content/live projection and signing authority. Test blocked/rejected/quarantined/paid/subscriber media, exhausted viewing allowance, direct URL denial.

### CONTENT-06 — P1: mixed-search pagination sends timestamp cursor to UUID query

`discover-repository.ts:45-60` forwards one `input.cursor` to content, creators, hashtags, events and live queries, and returns only content.nextCursor (a timestamp). On next search page, `discover-directory-queries.ts:174` casts that timestamp toUUID, producing PostgreSQL22P02 and failing Promise.all/search. Creator and hashtag continuation is also semantically wrong. Fix typed independent cursors or dedicated paginated result groups; validate query shape. Test more than12 content items and paginated mixed search against real SQL.

### CONTENT-07 — P1/P2: widespread pagination skips lookahead rows; timestamp ties lack ID cursor

Discovery content (`discover-content-queries.ts:147-151`), hashtags/creators/events/live (`discover-directory-queries.ts:27,57,112,179`), comments (`engagement-comment-repository.ts:110-114`), notifications (`notification-repository-mappers.ts:11-15`), access passes (`event-access-pass-methods.ts:272-276`), organizations (`organization-repository.ts:491-495`), Mutuals feeds/lists (`mutuals-repository.ts:150,185`) emit `rows[limit]` as nextCursor but strict next-page `<` or`>` excludes that unsent row. Timestamp-only cursors also drop tied entries; live cursor compares id while sorting state+created_at, causing independent omissions/duplicates. Fix cursor from last returned row, deterministic composite ORDER BY/cursor matching, lookahead only determines hasMore. Test all page boundaries, tied timestamps, random UUID order and state changes. Do not patch each with another helper implementation; reuse one contract pattern.

### CONTENT-08 — P1: DML CTE projections read stale base snapshots

Event create (`event-core-repository.ts:97`) reads base events joined selected_event after INSERT CTE; inserted base row is invisible within that statement. It commits event/pass types then eventFromRows throws configuration error. Retry succeeds. Event update (`:151`) projects old base event values. Same pattern appears live reserveRoom/createRoom/attachProviderRoom (`live-room-repository.ts:166,306,378`) and engagement preferences (`engagement-preferences-repository.ts:78` via `preferencesSelectSql` joining base viewer_feed_preferences). First live room reservation likewise persists but returns503. SQL semantics confirmed with database audit agent; root can run minimal PGlite proof. Fix project RETURNING CTE columns or perform followup SELECT within same transaction. Tests must call repository with real engine and verify first-call response and second-read state.

### CONTENT-09 — P1: Mutuals feed selects nonexistent schema column

`mutuals-repository.ts:115` selects `ci.media_kind`; content_items has media_type, never media_kind. Full migration search confirms media_kind only exists on MCP media capability. SQL fails42703 even with no rows. Fix explicit mapping from canonical media_type into contract mediaKind. Add real migrated-schema query smoke to Mutuals endpoint.

### CONTENT-10 — P1: privacy/visibility policy diverges across surfaces

`discover-directory-queries.ts:45-55` lists all active profiles without profile.visibility or actor/block filtering; its events/live queries omit block policy too. `mutuals-repository.ts:99-142` and `mutuals-interest-repository.ts:16-42` do not use eligible_content, blocks, creator userstate/age or viewer NSFW preference and join all media assets including retired. `live-room-repository.ts:385-399` findRoom lacks creator active/block policy and live chat reads expose blocked/muted authors. This lets blocked/private profiles/content metadata appear and blocked relationships match or read live; current content authority correctly excludes them elsewhere. Fix one shared eligibility/access predicate per resource, apply on reads and writes, normalize safe previews; test cross-surface block/private/NSFW/expired-creator-state matrices.

### CONTENT-11 — P2 conditional cleanup: dormant subscriber-only projection branch

`content-repository-mappers.ts:89-117` includes a subscriber_only product branch, but payment_product_type does not permit that value. Visibility=subscribers alone correctly gates eligible_content and mapsfree if there is no separate accessrule. Therefore do not claim all membership media are broken. This branch is evidence of obsolete access vocabulary; verify any valid creator_subscription/access_type compatibility records and consolidate canonical access vocabulary. Test active/expired/revoked membership, creator-owned content and separate one-time unlock. This item is conditional cleanup rather than a reproduced launch blocker.

### CONTENT-12 — P1: requester can change creator terms while accepting them

`message-commercial-repository.ts:423-443`: requester accept_terms takes terms_proposed→accepted, then unconditionally uses input.agreedAmountMinor/expectedDeliveryDays/clarificationRule/cancellationRule to overwrite agreed terms. A requester can accept a creator quote of100 with agreedAmountMinor1; payment authority reads1 from accepted request. Later actions can rewrite contract fields too. Fix only creator propose_terms can change terms, accepting binds exact current terms version/hash; requester changes must become counteroffer requiring creator acceptance. Test altered-price/terms accept rejected and stale version conflicts. No need to solve this with custody.

### CONTENT-13 — P1: member can post to paid live chat without Event Access

`live-chat-repository.ts:83-113` accepts any active profile subscription for paid_event regardless members_included_in_paid_event. Mapper correctly grants membership access only for profile_members or explicit paid-event inclusion (`live-repository-mappers.ts:6-9`). Thus membership subscriber without pass can POST messages even though UI/room denies. Fix same canonical live-access predicate for room, reads, writes and payment. Test paid event inclusionfalse membership no pass→403; inclusiontrue→allowed.

### CONTENT-14 — P2: normal history and creator live history are permanently truncated

`message-read-repository.ts:78` lists all conversations without pagination (unbounded query+per-thread unread aggregates), while messages limit50 (`:164`) with no cursor input/output. Users cannot retrieve earlier messages. Commercial interactions also limit50 with no cursor. `live-control-repository.ts:40-41` limits ownedrooms20 and always nextCursornull. Fix bounded deterministic keyset pagination, unread counter projection and lazy loading; test51 messages,21 live rooms, large inbox.

### CONTENT-15 — P1/P2: historical management agreement authorizes future analytics

`managed-creator-repository.ts:73-96` authorizes org member if any accepted/superseded/terminated agreement grantsanalytics_view, then aggregates every confirmed allocation onrelationship. New accepted agreement removing analytics_view does not revoke future analytics; an old superseded agreement still passes. Historical accounting visibility may be intended but must be scoped to the agreement/time and permitted data, not all later relationship activity. Fix current agreement for current data, explicitly authorized historical scope for immutable accounting records. Test permission removal then later allocation.

### CONTENT-16 — P2: organization owner can activate invitation without invitee consent

`organization-repository.ts:311-331` updateMember accepts invitedtarget and sets stateactive directly, bypassing respondToMembership consent path; route permits patch active. Fix reject invited→active except invitee acceptance; allow ownerrole/status changes according to lifecycle. Test invitation remains pending despite owner PATCH.

### CONTENT-17 — P2: idempotency scopes omit target identity across org/management/performer actions

Organization mutation routes hash normalized body without organizationId/membershipId; receipts keyed actor/action/key and return original membership. ManagedCreator respond/propose/terminate similarly omit relationshipId from requestHash; performer createRequest has no requestHash at all and returns any originalactor/key request. Reusing key with same body against a different resource is silently treated as success for old target instead of409. Fix target IDs/action/version in canonical normalized fingerprint; retain existing receipts with safe compatibility behavior. Test sameactor samekey/body differentresource409. Also generic metadata contentupdate and publish/eventpatch validate keys without durable replay; these should join shared command policy, not another store.

### CONTENT-18 — P2: feed performs full eligible-corpus hash+sort twice each page and resets on any reaction

`content-feed-repository.ts:26-49` hashes sorted string_agg of every eligible item and live engagement/follow state; then eligible corpus is recalculated and window-ranked at53-92 before limit. Any like/comment/share anywhere in eligible corpus invalidates cursor and returns409. Frontend agent confirms feed-experience409 handler replaces page with freshhead/first item. This is an intentional stale-cursor design but incompatible with stable high-volume infinite scrolling; global scans/sorts/hash strings are unbounded. Fix bounded candidate windows/materialized ranking session or versioned score snapshot with deterministic cursor, immediate reauthorization per item, independent engagement counters. Capture EXPLAIN ANALYZE and concurrent-engagement scroll/load tests at realistic volumes.

## Joint notifications findings

Ownership/worker agent verified notification endpoint→web-push SSRF/memory risk and cross-account device reassignment leakage. My fully read route/repository confirms registration accepts arbitrary truthy endpoint/keys (`notification-routes.ts:147-167`) and on conflict changes device.user_id (`notification-device-repository.ts:85-104`) while retaining id. Worker agent owns final finding details and official package source evidence; root should consolidate once.

## Not findings / validation boundaries

- Provider-mode disabled paths and absent credentials are release gates, not automatically code bugs.
- Live staff/adverse suspension is atomically persisted to room.suspended + safety hold; `private.live_safety_release_ready` requiresroom.live. Do not report an unsupported healthy-heartbeat-overrides-staff-suspension issue.
- Raw discovery URL exposure is confirmed; whether actual bytes can be fetched without authorization depends on provider CDN/JWT protection. Both unsigned playback failure and provider misconfiguration need tests.
- Bunny Stream TUS signing shape matches current official guidance; duplicate/recovery lifecycle issue is app-side. Bunny embedtoken alone does not secure direct CDN artifacts; exact provider settings and newest policy must be proven in staging.
- Public/provider-legal approval, moderation classification accuracy, original-file retention/export and storage deletion effectiveness require external evidence.

## Required targeted regression matrix

Use full migrations and actual repository SQL: ready→publish; A/B/A reaction replay; receipt/event partialfailure; first event/live create and update response; discover page2; thirteen-item directory and tied timestamps; Mutuals schemaquery+blocked users+concurrent reciprocal interest; active membershipplayback; paid-event chatmembership; tampered acceptterms; data/privacy permissions afterrevocation; deviceownership switch. Then continuous browser journey auth→age→profile→content→engagement→payment→entitlement→analytics→admin review on mobile and desktop with provider errors and recovery.

### CONTENT-19 — P1: real private image uploads have no delivery URL path

`media-upload-adapter.ts:55-65` requires BUNNY_STORAGE_PULL_ZONE_URL/TOKEN_KEY for uploadconfig, but neither is used elsewhere in application delivery code (repository-wide search). reserveImageAssetUpload/completeImageAssetUpload (`content-media-repository.ts:306-387`) create/store asset with null poster_url; complete only marks providerready. `withSignedPlayback` signs video playback only. Actual frontend image renderer (`apps/web/app/content/content-renderer.ts:36-38,139-140`) requires asset.posterUrl. New images therefore remain unrenderable after upload/review, regardless of supplied keys. Public seeded posterURLs in tests conceal this. Fix canonical authorized short-lived signed private-image CDN resource from stored provider object reference; do not publish bearer tokens in DB or make zonepublic. Include thumbnails/srcset/expiry renewal and entitlement/revocation checks. Test real unseeded image upload→review→feed/detail/carousel image bytes render, unauthorized origin denial, tokenexpiry and deletion.

## Runtime proof completed

`../content-runtime-proof.mjs` executed on actual PostgreSQL WASM(PGlite), using reduced schemas matching query shapes. Output `../content-runtime-proof.json`: event INSERTCTE response0rows/persisted1; UPDATECTE returnsold/persistsnew; reaction A/B/A active/inactive/active; Mutuals nonexistentcolumn42703; timestamp→uuid cursor22P02; page1 returns1..12,cursor13,nextpagestarts14. These prove SQL mechanics and known invalid names/casts, not full repository/provider/staging E2E. All112 assigned sourcefiles fully read; full shared megatest read not claimed.

## CONTENT-20 — P1 — Approved external performer verification never records the over-18 fact required for release

**Evidence:** `apps/api/src/modules/performer/performer-routes.ts:125–134` starts `performer_eligibility` verification. `performer-repository.ts:198–205` stores the session's threshold age18. But `apps/api/src/modules/verification/verification-repository.ts:315–318` does not select the threshold and its primary record insertion at357–370 omits both `threshold_age` and `result_over_threshold`. These record columns are nullable with no default (`packages/database/migrations/0069_normalized_verification_domain.sql:87–88`). The performer synchronization trigger copies the missing result into `performer_subjects.result_over_18` (`0090_monetisation_performer_enterprise_authorities.sql:225–235`). Consent response checks only `verification_status='valid'` (`performer-repository.ts:322`), while canonical adult-content readiness requires `result_over_18 is true` / rejects a result distinct fromtrue (`0090...sql:857,888`).

**Reproduction/impact:** An external performer completes the provider flow and accepts the invitation. The UI can show valid verification and accepted consent, but the performer age fact remains null and the content stays ineligible for adult publication. This is a fail-closed product defect, not a demonstrated unsafe-release bypass. The generic primary-record omission also affects Didit age/adult-publisher records; consolidate that consequence with the auth auditor's canonical verification/onboarding findings rather than count it twice.

**Executed proof:** `performer-verification-proof.mjs` uses the exact performer synchronization function/trigger from0090 on a reduced PostgreSQL schema and inserts the webhook's relevant production field list. Result `performer-verification-proof.json`: verification_status=`valid`, result_over_18=`null`, satisfies_age_readiness=`false`. The complete provider/browser journey was not executed.

**Fix:** Normalize and persist the provider-attested threshold and over-threshold result for each relevant verification purpose, binding the configured approved workflow and its required evidence. Do not treat a generic top-level Approved status as sufficient proof of adulthood. Require the same canonical readiness in consent acceptance and publication, or clearly represent pending age evidence until it exists. Add a real database/provider-contract test from external performer invitation→verification webhook→acceptance→adult publication, plus underage/missing-evidence and adverse decision cases.

**Related conditional hardening:** `verification-repository.ts:483–486` requires Didit document/liveness/face-match evidence for adult_publisher_eligibility and creator_kyc but excludes performer_eligibility, even though Didit's adapter selects the same adult-publisher workflow for performers (`verification-provider-adapters.ts:435–438`). Align purpose-specific evidence requirements and prove the provider workflow contract. Because the current missing-age result already blocks canonical publication, this review does not claim that omission currently permits unverified performer content to be released.
