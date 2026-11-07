# Database audit independent verification — 4 November 2026

Source: `mariospeterman/VEEL-v2` at `71ceabcfaa8a5258e1b935a391ff4e6e7330c682`, isolated `wevid-complete` checkout. Application source remains unchanged. This is a focused independent verification of the earlier complete database review, not a claim of a second full semantic reading of all migrations.

## Result

The existing database/rollback findings remain supported. Re-execution independently reproduced every central result below. One additional affected surface should extend **DB-07**, rather than become a new unrelated count: direct content/media RLS also permits expired adult Moment metadata when existing authenticated SELECT grants remain.

## Re-executed evidence

| Boundary | Independent result | Evidence |
|---|---|---|
| Exact full forward migration chain | 118 applied, 186 public tables, all RLS enabled | verification-db-migration-proof.json |
| Exact original reverse chain | 79 downs pass, 0039 fails SQL42601 at unsupported `DROP TABLE IF EXISTS` | verification-db-rollback-proof.json |
| Populated upgrade histories | 0046, 0056 and 0077 fail SQL23514 on valid legacy values before old constraints are removed | verification-db-populated-upgrade-proof.json |
| Private-comment read with repository-only explicit grants | Permission denied on parent content_items, SQL42501 | verification-db-populated-upgrade-proof.json |
| Same private-comment read with retained legacy-style public grants | Unlinked authenticated subject reads private post comment body and UUID | verification-db-existing-supabase-grants-proof.json |
| Exact effective staff helper and tax grant/policy, reduced fixture | event_ops reads unrelated tax row; suspended membership denied | verification-db-rls-proof.json |
| Exact counter grant/policy, reduced fixture | Unlinked authenticated subject reads engagement counter row | verification-db-rls-proof.json |
| Exact 0117 up/down, reduced prerequisite fixture | Expired Moment absent before down, eligible after; expiry metadata dropped | verification-rollback-moment-proof.json |
| Direct content/media RLS, all 118 migrations | Unlinked subject with protected-app=false reads expired adult caption, distribution/expiry fields and provider asset reference | verification-direct-content-rls-proof.json, verification-direct-content-rls-proof.log |

All execution used PGlite 0.5.15 PostgreSQL WASM with pgcrypto and explicit auth.uid/auth.jwt fixture functions. No hosted Supabase Auth/Storage/Realtime stack, production database or live provider was used. Original proof files were preserved; independent copies use `verification-` prefixes. Scripts read the exact `wevid-complete` source. The RLS and expiry reduced fixtures retain their previously stated boundaries. Successful SQL execution does not certify live provider behavior.

## Extend DB-07: existing grants also expose expired/adult content metadata

**Priority:** P1 conditional on retained authenticated SELECT grants and Data API exposure. This is the same direct-read eligibility/grant root cause as DB-07.

**Source:** `packages/database/migrations/0053_content_publish_state.sql:17–28` leaves the effective content_items SELECT predicate at ready + published + public + approved, or creator/staff. Lines 31–49 do the corresponding media_assets parent predicate. No later forward migration replaces those policies. The canonical Moment expiry wrapper at `0117_moments_and_scheduled_publication.sql:118–136` restricts `private.eligible_content`, not these direct table reads. Neither direct policy calls `has_protected_app_access`, checks Moment expiry, or applies the full current delivery policy.

**Executed proof:** Install the documented legacy-style authenticated public-table grants before replaying all 118 exact migrations. Seed one adult image Moment with its publication two days ago and expiry one day ago, using synthetic normalized adult-publisher/declaration/safety/scan facts. Seed through the final-schema release predicates; **no triggers were disabled or functions replaced**. Actual `private.content_safety_release_ready` returned true. Then switch to an unrelated authenticated JWT subject that has no WeVid mapping. `current_app_user_id` returns NULL and `has_protected_app_access` returns false, yet SELECT on content_items returns its adult caption, UUID, Moment mode and expired timestamp; SELECT on media_assets returns its provider/object identifier.

**Limit:** This proves final-schema direct-read policy behavior with synthetic test data and retained ACLs. It does not prove that any deployed project has those grants or that a media URL is playable. Provider object references are not described as credentials. No claim of bypassing signed playback or downloading media is made. The canonical API still applies its own eligibility. Do not generalize this fixture into a provider upload/moderation E2E result.

**Fix:** Inventory current ACLs and exposed schemas; revoke browser access to server-only content/media/access-rule tables and route reads through canonical authorized API resources. If direct reads have an approved use, expose minimal projections enforcing the same current age, block, publication, expiry, safety and access decisions. Make the intended grants/default privileges explicit so provisioning and historical ACLs do not change behavior. Extend real-role regression tests to expired Moments, removed/revoked safety evidence, adult content without protected access, blocked actors, private/unpublished parents, counters and media references.

## Current official documentation correction

The report's generic statement that Supabase is “moving toward” opt-in default grants should be made date-specific. The April 28, 2026 breaking-change notice describes the October 30 rollout and says existing tables retain their current grants; subsequent new tables require explicit opt-in. Existing ACLs still require inspection. A new default does not retroactively establish that historical tables are safe. Do not call legacy auto-grants the universal current baseline.

Primary sources rechecked:
- https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically
- https://supabase.com/docs/guides/api/securing-your-api
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://www.postgresql.org/docs/17/sql-alterpublication.html
- https://www.postgresql.org/docs/17/ddl-rowsecurity.html

The lightweight changelog.md request was attempted but the search tool rejected its markdown content type; the official HTML breaking-change index and linked notice were used instead. The primary PostgreSQL publication syntax independently confirms the unsupported 0039 IF EXISTS form.

## Remediation instruction assessment

The existing instruction correctly requires real SQL role/concurrency tests, forward and populated upgrades, safe supported rollback boundaries, current schema generation, OpenAPI 3.1 nullability repair and preserving applied history. Retain those requirements. Two explicit additions improve execution reliability:

1. Name DB-02 and DB-07's exact tables: `user_social_counts`, `content_engagement_counters`, `comments`, `content_items` and `media_assets`; direct counter USING(true) and visible-comment policy are not covered merely by repairing API staff permissions.
2. Require actual ACL/default-privilege inventory, intentional existing-grant revocation and deterministic new-project grants; include the expanded expired-Moment/adult direct-read case. Preserve DB-07's conditional deployed-grants classification.

Keep the instruction's existing distinction between intentional retention/refusal and accidental rollback defects. Do not “repair” 0106 evidence retention using CASCADE. A migration appended after 0118 cannot unblock a populated database that fails before reaching 0118; the reviewed bridge/pre-upgrade procedure remains necessary.

## Coverage verification and honest limits

All 244 database package files match both the earlier `wevid-audit` checkout and their exact bytes/SHA-256 in `WeVid_Coverage_71ceabc.json`; zero mismatches. This validates source identity, not the truth of a prior human/agent review declaration. All 118 forward migrations were independently executed in full multiple times; rollback execution stopped at the documented 0039 failure. Effective policy/function catalog was regenerated and inspected for affected surfaces; only the two counter policies have literal unconditional true in the final catalog, and there are no application functions in public in that catalog.

I fully reread the key migrations underlying these findings and database package runtime/config/checker files, inspected relevant portions of later safety/identity/composer migrations, the test helper/security/rollback assertions and actual integration seed helpers, and reviewed the prior reports/proof scripts. The 1,316-line migration test file was not independently reread line-by-line in this verification pass; the prior dedicated full-read record remains the evidence for that coverage. No new full-coverage claim is added. Machine-readable file/hash check and verification methods are in verification-database-coverage.json.
