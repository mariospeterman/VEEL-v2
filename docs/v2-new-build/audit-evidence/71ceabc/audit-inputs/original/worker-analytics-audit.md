# Worker and Analytics audit — 71ceabc

Scope: complete `apps/worker` except four money/subscription files owned by payments_worker_audit; all six API analytics source files and two analytics API tests; complete analytics behavior doc. Full file coverage in `worker-analytics-coverage.json`. No repo edits. Review includes all worker tests, including portions overlapping payment reviewer.

Validation: actual AnalyticsQueryService source transformed with Node24 stripTypeScriptTypes and exercised using a repository fixture; output `analytics-suppression-repro.json`. `worker-relational-repro.json` contains minimal SQLite relational reproductions of the same SQL selection/join defects. Those are isolated logical reproductions, not claims that the fully migrated Postgres suite ran. Full provider and migrated-DB/browser proof remain root-run gates.

## Confirmed findings

### WA-01 — P1 — Arbitrary push endpoints become worker-side HTTPS requests (joint with content reviewer)

Evidence: `apps/api/src/modules/notification/notification-routes.ts:126` device creation requires only truthy endpoint/p256dh/auth. `apps/api/src/modules/notification/notification-device-repository.ts:15` encrypts input verbatim. `apps/worker/src/notification-delivery.ts:143` forwards the endpoint to `webPush.sendNotification`. Independently checked exact selected upstream `web-push-libs/web-push` tag `v3.6.7`, `src/web-push-lib.js`: it parses arbitrary hostname/port/path into `https.request`; it has no push-service host/IP policy, and buffers `responseText += chunk` without a response-size bound. Its request timeout is socket inactivity, not a total deadline.

Impact/preconditions: configured Web Push/VAPID and encryption key; a normal authenticated account can register a syntactically valid encrypted Web Push key pair for a controlled HTTPS URL and cause outbound requests when receiving notifications. Internal-network SSRF is subject to deployment reachability/TLS, so do not claim credential theft or arbitrary internal response disclosure. A controlled public HTTPS endpoint alone can stream a very large or indefinitely trickling response. That risks memory exhaustion and a never-finishing notification task; `index.ts` waits for all queue tasks and serializes ticks, so one hung tick blocks later recurring work.

Fix: maintained Web Push library remains appropriate; add one canonical normalized endpoint validator with HTTPS, no credentials/fragments/unapproved ports, exact supported push-service host policy and egress/private-address enforcement, including DNS rebinding protection. Apply at enrollment and send; use a strict wall-clock deadline and bounded transport response behavior. Tests must reject internal/metadata/private/link-local endpoints and arbitrary attacker hosts, and prove a stalled push cannot stop live safety/payment/publication queues. Official upstream: https://github.com/web-push-libs/web-push/blob/v3.6.7/src/web-push-lib.js .

### WA-02 — P1 — Reassigning a browser subscription leaks pending old-account notifications

Evidence: `notification-device-repository.ts:75` conflicts on provider+endpoint and updates `user_id = excluded.user_id` while retaining the same device ID and old queued attempts. Worker `notification-delivery.ts:284` joins only device ID and `device.state = 'active'`; it never checks `device.user_id = due.user_id` or notification owner. It then reads current subscription secrets and old notification title/body/action URL (`:312`).

Repro: account A has an undelivered attempt; same browser signs into B and re-registers the endpoint; worker sends A's queued notification using B's current active subscription. Minimal relational proof shows attempt owner A and current device owner B both selected. This needs no hostile cross-user knowledge.

Fix: atomically invalidate/cancel old pending attempts when device owner changes; lease/send only if notification owner, attempt owner and current device owner match. Model session/account switches explicitly. Regression must queue A, re-register B, and prove no A payload reaches B.

### WA-03 — P1/P2 — Old unread notifications permanently starve new push delivery

Evidence: `notification-delivery.ts:229` selects unread notifications with active devices and preferences, orders oldest first and applies LIMIT at `:248`, then `ON CONFLICT(notification_id,device_id) DO NOTHING` at `:249`. It does not exclude existing attempts before LIMIT. Delivered attempts do not mark notifications read.

Repro: with limit2, unread n1/n2/n3, tick1 inserts n1/n2; tick2 selects n1/n2 conflicts and inserts zero; n3 never enqueues until old notifications become read. The minimal relational reproduction returns exactly that result. At default WORKER_BATCH_LIMIT25, any oldest25 unread entries with existing attempts can stall all later notifications globally.

Fix: anti-join existing attempts before ordering/limiting; retain unique constraint for concurrency; add suitable covering indexes and deterministic ordering. Test more than a batch of delivered-but-unread notifications plus new notifications and multiple worker instances.

### WA-04 — P2 — Queued push ignores later preference revocation

Evidence: preferences/category flags are checked only when enqueuing (`notification-delivery.ts:231`); lease query at `:283` joins only the device. The preference PATCH does not cancel queued attempts. User disabling push/category after enqueue still receives queued/retried pushes.

Fix: apply canonical current user/preference/device-owner checks immediately before dispatch; cancel ineligible attempts with a clear internal reason. Test opt-out, category opt-out, account deletion/suspension, device revoke, and queued retry.

### WA-05 — P1 — Analytics cohort suppression discloses the suppressed count in sampleSize

Evidence: `analytics-service.ts:194` always returns raw sampleSize even when value/numerator/denominator are null. For creator social counts, `queryCreatorDaily` uses the metric's own numerator/value column as sample column (`analytics-repository.ts:288`, `:319`). Thus follower_starts=3, minimum cohort5 yields `{value:null,sampleSize:'3',privacyDecision:'suppressed_minimum_cohort'}`. Offer impression counts have the same problem. Unit test `analytics.test.ts` explicitly expects raw sampleSize, so passing tests preserve the leak.

Actual runtime reproduction of the source confirmed the exact output in `analytics-suppression-repro.json`.

Fix: return null, a safe bucket, or threshold-safe indicator for suppressed sampleSize; update the generated contract and consumers. Add regression where value equals sample count and protect adjacent-window/dimension differencing according to the stated privacy policy. Do not expose a supposedly hidden denominator through another field.

### WA-06 — P1 — Platform metric query checks staff membership but bypasses analytics RBAC

Evidence: `analytics-repository.ts:69` authorizes any active staff_memberships row, independent of role. By contrast `/v1/admin/analytics/health` checks `admin.analytics.read`, and canonical `admin-permissions.ts` intentionally excludes trust_safety/support/event_ops/ai_ops from that permission. Those roles can still query platform commerce/lifecycle/onboarding metrics through `/v1/analytics/query`. The auth reviewer independently confirmed this conflict.

Fix: reuse canonical admin analytics permissions in metric scope authorization; apply any purpose/audit requirements consistently through web and MCP consumers. Update conflicting analytics documentation that currently says merely active staff. Real-Postgres regressions should cover every staff role and cross-role denials, not only owner/ops and non-staff.

### WA-07 — P2 — Multiple media assets multiply credited watch time and completion counts

Evidence: `analytics-projections.ts:253` sums heartbeats after a left join to every duration-bearing media_assets row for a content ID at `:258`. The viewer projection repeats it at `:381`/`:386`. There is no selected release asset/retired filter or pre-aggregation to one asset. Multiple upload/replacement/carousel video assets fan out each heartbeat. `max(duration_ms)` also selects a different asset than the playback target.

Repro: one session, one canonical10second heartbeat, two duration-bearing assets => reported20seconds, and potentially false completion for a session that never completed. Isolated relational proof confirmed10->20. Current integration test creates exactly one asset and misses this.

Fix: aggregate heartbeats per session before joining metadata, and choose the exact asset/composition target used by the session. Explicitly handle replacements, retired assets and multi-video carousels. Reconcile credited time against canonical usage facts, not just row counts.

### WA-08 — P2 — Viewer replays count different content as a replay

Evidence: `analytics-projections.ts:390` groups viewer playback solely by bucket_date,user_id, then sets replays=`greatest(qualified_session_count-1,0)` (`:399`). Unlike creator playback (`:263`), it drops content/target identity.

Repro: a viewer watches one qualified session each for two different videos on the same day; both creator projections have zero replays, but viewer.content.replays reports1. With N distinct clips it reports N-1.

Fix: compute additional sessions per viewer+target+day before summing the viewer daily result. Add consistency tests for unique content, repeated content, live vs VOD, and mixed targets.

### WA-09 — P2 — Minute scheduler enqueues analytics only once per hour

Evidence: `analytics-projections.ts:92` truncates the idempotency slot to hour, and `:105` ignores every subsequent enqueue in that hour. A completed hourly job is never requeued; full repo search found no late-fact automatic enqueuer. Registry freshness targets are60/120seconds, and docs call these near-realtime targets. New facts after the hourly execution remain absent until next hour; UI is stale for most of the hour.

Fix: reconcile the desired freshness, measured load and schedule. Use a minute/watermark/dirty-bucket schedule or honestly document/hour-label hourly analytics; do not blindly create a full two-day global rebuild every event. Test new facts arriving after first tick in same hour and empty periods, and measure at realistic volume.

### WA-10 — P2 — Telemetry retention timestamps are never enforced

Evidence: migration0110 defines30day profile/offer receipt expiry and90day onboarding event expiry (`0110_analytics_core.sql:150`, `:166`, `:186`); worker and full-repo search contain no purge consumer. Database reviewer confirmed all118 migrations contain no pg_cron or retention procedure for these tables and no expiry indexes. `expires_at` is a timestamp, not TTL enforcement. Analytics continues reading expired raw facts on backfill.

Fix: implement bounded, indexed retention work with explicit aggregate-before-purge rules and approved retention durations. Handle late backfills without destructively rebuilding historically aggregated days from already-purged raw facts. Test expiry, idempotence, legal hold where relevant, DSAR, and reconstruction boundaries.

### WA-11 — P2 — Reconciliation can call offsetting metric errors 'matched'

Evidence: `analytics-projections.ts:772` adds source counts across all metric families and compares only the combined totals (`projectedRowCount - sourceRowCount`). A deficit in impressions and equal surplus in profile opens cancel to variance0 and produce `matched`/healthy. Evidence details retain per-family values but health ignores the individual differences. Watchtime, ratios and money amounts are not independently reconciled.

Fix: compute and expose per-metric/source variance and derive health from all required checks, e.g. nonzero absolute variances cannot cancel. Add tests with equal/opposite mismatches, join multiplication, native currency amounts, and partial-source omissions.

### WA-12 — P2 — Analytics lease recovery ignores maximum attempts after crashes

Evidence: `analytics-projections.ts:124` selects all expired leased jobs without `attempt_count < max_attempts` or a terminalization sweep, and increments each attempt. maxAttempts is used only inside a caught projectWindow failure. A job repeatedly killed/lease-expired can be reclaimed indefinitely, unlike other queues' exhaustion handling, and old-window ordering can keep it at the front.

Fix: atomic dead-letter sweep for exhausted expired leases and cap reclaim eligibility; preserve audited admin recovery. Test process death after lease at max attempt, lost lease fencing, and multi-worker contention.

## Cleanup / documented gaps (not newly discovered security bypasses)

- Worker README says provider replay is operator-requested and not polled by recurring scheduler. `index.ts` explicitly schedules it on every tick. Reconcile docs with operator-requested *enqueue* plus recurring processing, if that is intended.
- All queue tasks share one active tick (`Promise.all` + global serialization). Even with failures caught, one slow/hung queue delays next live-safety cycle. WORKER_BATCH_LIMIT supports250; serial notifications each with10second socket timeouts can exceed five-minute leases by a large factor. Bound per-queue concurrency/deadlines and scheduling isolation; test total runtime relative to lease/90second monitoring heartbeat. Do not replace the whole Postgres queue without measured need.
- Media moderation runtime always injects createFailClosedMediaModerationAdapter, even with provider keys. This intentionally routes all media to review_required with automated_media_moderation_not_launch_approved. It is a provider/readiness gap, not permission to invent a scanner or mark uploads safe. A launch-approved adapter/evidence path and manual staffing/proof are required for a working upload-to-publish journey.
- Cleanup provider is created only from the Bunny upload adapter, while queue type permits livepeer. Verify whether canonical media retirement can enqueue Livepeer assets before adding an adapter; do not claim support merely from the union type.
- Staff purposeCode is validated and returned but no query-level purpose audit was found in analytics source. If query purpose is a compliance requirement, use canonical minimized audit with metric/scope/window and no raw audience rows.
- Do not claim browser onboarding success telemetry is canonical authentication/age proof. The public route accepts every event including protected_app_entered, and projection groups sources together. Existing docs explicitly classify these as observational; keep them separate from audited lifecycle completion if those metrics are used operationally.

## Examined and not reported as defects

- Scheduled publication success relies on migration0117 trigger to mark the job completed; absence of an explicit job update in the worker is not a defect.
- Live health auto-release looked able to override rejection, but the content reviewer confirmed current staff/adverse-event paths atomically suspend room and hold session; private.live_safety_release_ready then fails. Preserve this with concurrency/invariant tests; no confirmed bypass reported.
- Moderation complete means evidence job complete, not content approved. summarizeEvidence intentionally preserves human review and known-hash reporting holds.
- Provider replay uses sanitized payloads and reuses canonical handlers; no duplicate business authority should be introduced for fixes.
