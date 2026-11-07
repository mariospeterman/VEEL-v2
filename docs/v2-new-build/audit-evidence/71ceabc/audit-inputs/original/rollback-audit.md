# Rollback migration semantic audit

Snapshot: `mariospeterman/VEEL-v2` at `71ceabcfaa8a5258e1b935a391ff4e6e7330c682`. All 118 `packages/database/migrations/*.down.sql` files were read in full, including every executable statement and retention guard. Exact paths, sizes, line counts and SHA-256 hashes are in `rollback-full-coverage.json`. Repository files were not edited. Supplemental database package files were also read in full: README, schema-blueprint, check-migrations script, package/config files and index. `migrations.test.ts` received a separate full 1,316-line review recorded in `migration-test-coverage.json`.

## ROLLBACK-01 — Expired Moments become permanently eligible again after 0117 downgrade

**Severity:** P1 for a production downgrade with retained Moment content. This is a rollback-path privacy defect, not a claim that the current forward eligibility function ignores expiry.

**Evidence:** `packages/database/migrations/0117_moments_and_scheduled_publication.down.sql:5–7` drops the expiry-aware `private.eligible_content` wrapper and renames the old base function back into its place. Lines 12–13 convert scheduled publication states to `submitted_for_review`, but do nothing to Moment rows. Lines 22–29 then drop `distribution_mode` and `expires_at`. The forward wrapper in `0117_moments_and_scheduled_publication.sql:129–132` is the only additional Moment-expiry boundary; the old function has no such fields or condition.

**Reproduction:** Start with an otherwise eligible public image whose `distribution_mode = 'moment'`, `publish_state = 'published'`, and expiry is in the past. Current canonical eligibility correctly excludes it. Run the unmodified 0117 down migration. The row remains published, becomes eligible through the old function, and its expiry/moment metadata is destroyed. Even a currently unexpired Moment becomes permanent after downgrade.

**Executed proof:** `rollback-moment-proof.mjs` executes the exact unmodified 0117 up and down SQL in PostgreSQL WASM (PGlite) on a reduced prerequisite schema. The base-eligibility fixture models an already-authorized published row; moderation/access implementation is not duplicated. Assertions passed: zero visible rows before downgrade; one visible row afterward; neither `expires_at` nor `distribution_mode` remains. Machine-readable result: `rollback-moment-proof.json`. This is an actual SQL execution proof of the downgrade transformation, not a hosted Supabase or full application/provider end-to-end test.

**Fix:** Prefer application rollback while keeping the additive 0117 schema and expiry predicate. If schema downgrade is a supported operation, refuse it while Moment rows exist unless an explicit data migration has preserved their privacy semantics. At minimum unpublish/hold all Moment content before removing fields, retain its expiry evidence, and document the resulting owner recovery behavior. Never silently convert time-limited content into permanent public posts. Add a populated migration test proving expired and unexpired Moments cannot become permanent public content through downgrade.

## Existing rollback findings, not counted again

- The database audit already owns the invalid `ALTER PUBLICATION ... DROP TABLE IF EXISTS ...` syntax in 0039 down. Its original execution passed 79 later down migrations before stopping there. Do not duplicate this as a new finding here.
- The database auditor's diagnostic rerun, with a runtime-only correction of 0039, passed 112 downs and stopped at 0006 because 0106 deliberately retains the `content_items.release_media_asset_id` foreign key/evidence. Do not “fix” that by adding `CASCADE` or erasing safety evidence. An empty-schema blanket rollback is incompatible with the stated retention policy; it is not an appropriate production recovery objective.
- Historical schema-blueprint drift is already owned by DB-04. Full reading confirms it mixes historical proposed tables with partial modern additions, lacks current canonical fields, and is not a runnable substitute for the sequential migrations. Consolidate/archive it rather than maintain a competing schema source of truth.

## Supported recovery boundaries

Several down migrations intentionally cannot run after live data exists. Their explicit refusals are appropriate fail-closed retention behavior, not launch defects:

| Migration | Intentional boundary |
| --- | --- |
| 0076 | Revoked exposed wallet sessions are not restored. Users authenticate again. |
| 0079, 0116 | PostgreSQL enum additions remain; unsafe enum removal is intentionally avoided. |
| 0095 | Refuses loss of live message-request decisions or durable action receipts. |
| 0096 | Refuses loss of consent, earnings, reservation or incompatible checkout facts. |
| 0106 | Holds releases for review and preserves media-integrity evidence, asset bindings and release pointers. |
| 0112 | Refuses retained new messaging/live/realtime traffic. |
| 0113 | Refuses retained consumer-social/privacy activity. |
| 0114–0115 | Refuses retained private-draft origins, media capabilities or source-kind provenance. |
| 0118 | Refuses retained landing analytics facts unless explicitly archived/migrated. |

Other historical downs narrow state/nonnull constraints or delete whole tables. For example 0051 requires all provider stream IDs to be nonnull, 0066 requires legacy MCP token fields to be nonnull, and 0090 restores the earlier payment split invariant and org-role vocabulary. Legitimate newer data can therefore prevent a downgrade. These are concrete compatibility limits, not additional independently counted production vulnerabilities. Production runbooks must specify the supported application/schema version range, preflight populated data, retain financial/consent/security evidence, stop relevant writers/workers, and prefer forward repair or compatible application rollback. Disposable local database reset is a separate operation.

The static `check-migrations.mjs` only verifies paired filenames, selected foundation text, forbidden regexes and a few index/uniqueness strings. The 89 tests in `migrations.test.ts` likewise perform text/regex assertions with no SQL execution. They cannot establish valid rollback syntax, successful dependency order, populated-state compatibility, final application-query compatibility, RLS role behavior or safe retention. Keep useful architectural checks, and add actual supported PostgreSQL migration/recovery and role tests; do not assert that passing static checks proves the repo is recoverable end to end.
