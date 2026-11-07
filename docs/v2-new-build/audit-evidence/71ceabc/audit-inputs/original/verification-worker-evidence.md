# Independent worker, analytics and evidence validation — 4 November 2026

Source: `mariospeterman/VEEL-v2` at `71ceabcfaa8a5258e1b935a391ff4e6e7330c682`. This is a focused second review of prior audit work, not a new assertion that this reviewer independently reread every tracked file. No application source, provider, database or production setting changed.

## Evidence integrity

Executed `python3 verification-evidence-integrity.py`. The checkout has exactly 1,069 tracked paths, and the aggregate coverage manifest has the same set with no duplicate, missing or extra paths. All lengths and SHA-256 values match, including the migration symlink's link text. Classification matches the report: 1,024 full-text attestations, 34 binary-metadata classifications, eight structural SVG inspections, two generated artifacts and one canonical symlink.

Every one of the original 107 Evidence_Manifest entries matches both local bytes and archive bytes. The original ZIP has no unlisted entries apart from its manifest, its manifest copy matches, and CRC validation succeeds. `unit-tests-results.json` records 629 total, 619 passed, 10 pending and zero failed. These recorded totals were independently checked; this reviewer did not rerun the complete default suite.

The file hashes demonstrate snapshot consistency and complete file accounting. The semantic-review statuses remain the prior domain reviewers' attestations. Hash checks cannot prove that a person/model actually read or understood source. `collate_coverage.py` records those attestations and avoids upgrading partial/relevant-section reads to full semantic coverage merely because a path exists. Large-file coverage is supported by the separate dedicated test, contract, SQL and long-document manifests. Retain this distinction in user-facing claims.

One metadata correction: the original `validation-summary.json` refers to nonexistent `production-dependency-audit.log`. The actual advisory evidence is `production-dependency-audit.json`; the associated stderr file is empty. Correct the summary/reference when rebuilding the archive. This does not change the recorded failing advisory result.

## Findings independently confirmed

- **WA-01 through WA-04:** Full reads of notification routes/device repository/delivery worker confirm arbitrary endpoint enrollment, endpoint-owner reassignment under an unchanged device ID, missing current owner/preferences checks during lease, and LIMIT before excluding existing attempts. The installed `web-push@3.6.7/src/web-push-lib.js:340-416` forwards parsed hostname/port/path to HTTPS, buffers all response chunks, and uses socket timeout handling. Deployment network/TLS restrictions still determine internal SSRF reachability; no internal endpoint or external service was contacted in this review.
- **WA-05:** Re-executed the actual compiled AnalyticsQueryService with a dependency fixture after checking its source matches this checkout. A suppressed metric returns `value:null` and `sampleSize:"3"`. This reproduces the existing privacy defect; it is not live database/provider proof.
- **WA-06 through WA-12:** Full reads of analytics service/repository and projection worker confirm membership-only platform scope checks, heartbeat fanout across multiple media assets, viewer replay grouping without target, hourly idempotency slots despite minute scheduling, absent retention consumption within these workers, aggregate variance cancellation, and uncapped expired analytics leases. The earlier full-repository retention search remains the evidence for absence outside these files. This reviewer did not reexecute the entire migration catalog or load benchmark.
- **RES-01:** Actual compiled Fastify injection returned HTTP 500 with `VERIFICATION_INTERNAL_SENTINEL` unchanged in its client JSON. Dependency source matches the audited checkout. No real secret was used.
- **RES-03:** Full reads of API entrypoint, app lifecycle and app setup confirm that signal-triggered app.close/draining is absent from the server entrypoint, although close hooks exist.
- **ROOT-05/06:** Full reads of staging scripts confirm rejection of pending migration suffixes before apply, and journey statuses copied from the committed manifest. Reexecuting deriveJourneyResults with a PASS journey and no run evidence returns PASS with `cleanup:"not_run"`.
- **SUP-01:** Reexecuted the exact enterprise proof script with isolated process/fetch objects and nonexistent KYB/contract IDs. It makes only the three projection GETs and emits PROVIDER_PROVEN. There was no network request and no authentic provider evidence.

Runtime repro code and exact outputs: `verification-worker-proofs.mjs` and `verification-worker-proofs.json`. The independent repro runtime was host Node v24.22.1; it is supplemental to the prior pinned Node 22.16.0 baseline. Assertions pass because they establish that the defects remain reproducible, not because the application is repaired.

## Additional WA-02 repair detail

Owner checks only at enqueue/lease/send leave stale asynchronous outcomes insufficiently scoped. `notification-device-repository.ts:75-93` can reassign/reactivate the same device ID and replace subscription keys. An already leased attempt can later return 404/410, and `notification-delivery.ts:348-367` revokes the current device by ID alone after fencing only the attempt token. That late outcome can revoke the newer registration. This is a source-traced concurrency extension of WA-02, not a separately executed multi-connection PostgreSQL result.

Extend the repair instruction: bind delivery inputs and outcomes to the captured device owner and subscription generation/version. Cancel obsolete attempts on reassignment or key replacement; ignore stale delivery/revocation outcomes for a superseded registration. Test A lease -> B re-registration -> delayed A failure; B must remain active and must receive no A payload. Include device revocation/re-enrollment and subscription-key rotation races. Network sends cannot be recalled after dispatch, so document the actual dispatch linearization boundary and minimize sensitive push payloads accordingly.

## Instruction assessment and scope

The current Codex instruction already gives concrete repairs for all reviewed original worker/analytics/error/staging defects. Its narrow canonical authorities, bounded scheduling/egress, real SQL concurrency tests, honest blocked states and per-metric privacy/reconciliation requirements are appropriate. Add the subscription-generation outcome fencing above. Do not replace the existing Postgres queues or maintained push transport without measured need.

Full source reads in this second pass: notification routes/device repository/delivery worker; analytics service/repository/projection worker; worker entrypoint; API app/server/lifecycle; staging-acceptance-status, staging-acceptance, staging-migrations, check-supabase-migration-history; enterprise proof script; coverage collation script. Also read all three assigned audit reports, supplemental proof report, evidence README/manifests/summary, targeted original proof outputs and the relevant complete instruction sections. Other worker modules, all tests, domain code outside these paths and current external provider documents were not independently reread in this pass. Prior full-file coverage remains separately attributed.
