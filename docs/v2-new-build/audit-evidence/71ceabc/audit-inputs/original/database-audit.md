# WeVid database and contracts audit — 71ceabc

Scope: exact commit `71ceabcfaa8a5258e1b935a391ff4e6e7330c682` in `mariospeterman/VEEL-v2`; canonical files in `/workspace/scratch/0635fbdaf32f/wevid-audit`. Local Mac uncommitted changes unavailable. Read AGENTS.md and current Supabase security docs. All118 forward SQL migrations were fully read semantically in bounded text chunks and executed successfully in PostgreSQL WASM/PGlite0.5.15 with real pgcrypto, stubbed auth.uid/auth.jwt and a publication, with no hosted Supabase services. This is meaningful SQL/schema validation, not a substitute for exact hosted PostgreSQL/Supabase integration proof. All public tables in resulting186-table schema have RLS. No public anonymous write policy found. Generated OpenAPI type file was structurally inspected, not semantically reviewed line by line.

## DB-01 — P1 — Direct Supabase RLS bypasses permission-level staff RBAC

Confirmed code and targeted PostgreSQL RLS reproduction.

- `packages/database/migrations/0030_compliance_tax_foundation.sql:427` explicitly grants `authenticated` SELECT on tax profiles, tax profile versions, buyer location evidence, receipts, DAC7/CARF data, compliance exports, and related sensitive tables.
- `0030...sql:434-460` policies use only `private.is_staff_member()` for these tables.
- Effective function remains `0091_canonical_identity_session_security.sql:184-200`: any active staff membership whose Supabase recovery identity is active satisfies it. It does not check the specific role/permission or current application session. Migration0116 introduces permission-level API RBAC without replacing this RLS function/policies.
- `apps/api/src/modules/admin/admin-permissions.ts:94` grants `event_ops` event/payment/support permissions, excluding `admin.compliance.read`. `admin-compliance-routes.ts:10` correctly requires that permission. Nevertheless a linked event_ops recovery JWT can use exposed Data API to read unrelated tax records, bypassing that API permission decision. `supabase/config.toml:12` exposes public schema.
- Targeted PGlite proof: exact effective is_staff function + tax_profiles grant/policy allowed event_ops to read another user's row; suspended staff correctly returned none. Evidence `db-rls-proof.json`.

Fix: revoke direct authenticated grants for server-only financial/admin/identity/compliance tables; expose only minimal explicitly authorized projections where a real browser use exists. If direct staff reads are retained, enforce the same canonical role-to-permission registry in DB, with active account/session semantics; do not retain an unrestricted any-staff shortcut. Add pgTAP or equivalent real-role tests for every sensitive table across owner/admin, finance, support, event_ops, ai_ops, normal user, unlinked recovery subject, and revoked session.

## DB-02 — P2 — Authenticated Supabase subjects can enumerate private content and private account counters

Confirmed code and targeted PostgreSQL RLS reproduction.

- `0094_social_graph_feed_projections.sql:300-305` grants authenticated SELECT on `user_social_counts` and `content_engagement_counters`.
- `0094...sql:319-323` SELECT policies are `USING(true)`.
- These projection rows are inserted for every user/content item, including private draft items (`0094...sql:127-155`), so any valid Supabase subject, including one with no canonical WeVid account or age verification, can enumerate content UUIDs and engagement counts, and account UUIDs/follower counts.
- PGlite proof with unlinked subject returns a content counter row. Evidence `db-rls-proof.json`.

Fix: keep counter tables server-only and return authorized aggregate fields through canonical API projections, or scope policies to canonical eligibility/protected-app/privacy rules without creating recursive RLS. Add denied-read tests for drafts/private content, blocked profiles, incomplete age and unlinked subjects.

## DB-03 — P2 — OpenAPI3.1 uses OpenAPI3.0 nullability semantics

Confirmed contract mismatch.

- `packages/contracts/openapi.yaml:1` declares3.1.0;328 schema occurrences use `nullable:true` (e.g `AgeStatus.provider` line4192, `VerificationSession` request organizationId line4199, profile avatarUrl line4394).
- OpenAPI3.1 Schema Objects use JSON Schema2020-12 typing; `nullable` does not expand `type:string` to permit null. Backward-compatible openapi-typescript happens to generate `string|null`, so TypeScript compilation can mask standards-based validators/client incompatibility.

Fix: normalize null schemas to `type:[string,'null']`, appropriate unions/oneOf for refs and enums, while preserving enum/null validity. Validate representative real success/error bodies with a3.1-compatible validator and regenerate clients. Do not simply delete nullable or add null only to type when enum still excludes it.

Official primary specification: https://spec.openapis.org/oas/v3.1.0.html , Schema Object4.8.24 / Data Types4.4. Tool reference `turn29view0`.

## DB-04 — P2 — Schema blueprint conflicts with effective migrated database

Confirmed examples; broad inventory is approximate until a true catalog diff.

- `schema-blueprint.sql:68` says profiles.visibility default public; effective `0091...sql:158-159` default private.
- Blueprint retains nonexistent `settlement_ledger`, `payment_transactions`, `payment_splits`, `commissions` etc, whereas migrated authorities include payment_ledger_entries, payment_settlement_attempts, app_sessions, verification_records, media_safety_cases and Analytics Core tables. Static table inventory finds82 effective names absent from blueprint and16 blueprint-only names, before detailed column/constraint diff.
- Blueprint is explicitly marked a non-generated plan, but AGENTS/docs treat schema/contracts as architecture authorities and docs-check compares enums against it. This allows incompatible instructions to look authoritative.

Fix: choose migrations plus generated schema snapshot as executable DB authority; replace blueprint with generated current schema or clearly archive it as design-only. Update doc check to compare generated effective catalog/schema rather than just a few copied enums. Preserve migration history; do not rewrite applied migration SQL for cleanup.

## Verification limitations and follow-up

`node packages/database/scripts/check-migrations.mjs` passed. All118 forward migrations passed isolated PGlite SQL replay. Full repository integration tests with actual Supabase Auth/Storage/Realtime and exact deployed PostgreSQL remain necessary. `packages/database/test/migrations.test.ts` largely asserts SQL substrings; it does not prove RLS outcomes. Existing API integration tests cover many canonical rules but must also exercise requests using direct `anon`/`authenticated` roles to expose the above bypasses. Do not classify provider-blocked states as implementation failures or claim deployment readiness from these results.

Other confirmed cross-scope findings relayed to owners (deduplicate in final issue register): events create/update sibling-DML CTE re-reads base-table old snapshot; Mutuals references nonexistent content_items.media_kind; subscription collections have no DB trigger writing canonical commerce/compliance ledger; organization settlement addresses may coincide with creator recipients, so verifier must aggregate identical recipients; analytics source TTL timestamps are not enforced by retention jobs.

Current official Supabase sources used: https://supabase.com/docs/guides/api/securing-your-api (updated Oct22,2026; `turn13view2`), https://supabase.com/docs/guides/database/postgres/row-level-security (updated Nov3,2026; `turn13view1`), https://supabase.com/docs/guides/database/postgres/column-level-security (`turn19view1`). These distinguish grants from RLS and require explicit minimal exposure.

## DB-05 — P2 — Migration0039 rollback is syntactically invalid PostgreSQL

Confirmed by execution and PostgreSQL17 official syntax.

`packages/database/migrations/0039_realtime_projection_publication.down.sql:1-3` uses `ALTER PUBLICATION supabase_realtime DROP TABLE IF EXISTS ...`. ALTER PUBLICATION DROP TABLE does not support IF EXISTS. After118 forward migrations,79 reverse migrations executed successfully (0118 through0040) and0039 failed with PostgreSQL42601 `syntax error at or near exists`. Evidence `db-rollback-proof.json`. Newer0112 migration already demonstrates catalog-guarded removal; use that pattern and run rollback/up tests against an isolated PG17 database, including publication-present/absent states. Do not edit already-applied forward migration history as a shortcut.

Primary official reference: https://www.postgresql.org/docs/17/sql-alterpublication.html (`turn30view0`).

Additional test: python-jsonschema4.25.1 Draft202012Validator validates the exact OpenAPI AgeStatus.provider schema for a string and rejects null, confirming DB-03; evidence `contract-nullability-proof.json`.

PAY02 worker proof: exact subscription repository function from the audited commit was transpiled with Node stripTypeScriptTypes and executed through a tagged-SQL adapter against all118 migrations. Two leaseDueCollections calls one second apart returned one collection each, creating two unexpired processing rows with attempt_count1 and distinct period-start/idempotency keys for a single verified subscription whose initial current_period_ends_at is null. Evidence `subscription-initial-period-proof.json`; payment agent owns the issue/fix.


## DB-06 — P2 — Populated upgrades fail before replacing obsolete CHECK constraints

Confirmed by replaying the exact migration history with valid pre-migration rows inserted immediately before each change. Empty-database replay alone misses these failures.

- `0046_admin_moderation_report_states.sql:2-7` updates `reports.state` from `dismissed` to `rejected` before dropping the old `reports_state_check`, which excludes `rejected`.
- `0056_event_access_purchase_request_state.sql:4-24` updates `ticket_granted` to `access_pass_granted` before dropping the original renamed-table constraint `ticket_purchase_requests_state_check`, which excludes the new state.
- `0077_universal_account_media_safety.sql:69-77` updates the old default `viewer_feed_preferences.nsfw_preference` from `recommended` to `both` before dropping its old CHECK, which excludes `both`. Thus even one ordinary legacy feed preference blocks the upgrade.

All three exact migrations fail PostgreSQL23514 against valid existing rows. Removing only the synthetic fixture lets the untouched migration run and the chain continue through0118. Evidence `db-populated-upgrade-proof.json`; executable script `db-proof-runtime/populated-upgrade-proof.mjs`. This is an upgrade/recovery defect, not a claim that a database already at0118 still has obsolete constraints.

Fix: preserve already-applied migration history. Document a reviewed pre-upgrade repair/bridge path for databases behind these revisions; where an unapplied migration may be corrected under the project's migration policy, drop/expand the old CHECK before transforming rows, then validate the new CHECK in one transaction. Add representative populated-upgrade fixtures, including these old enum-like values, to migration validation. A new migration after0118 alone cannot repair a database that cannot reach0118.

## DB-07 — P1 conditional on retained Supabase grants — Direct comments/content/media bypass current eligibility

The current effective `comments_select_visible_author_creator_or_staff` policy (`0027_engagement_feed_safety.sql:211-223`, explicit comments SELECT grant at:182) allows any `moderation_state='visible'` row without checking the parent content's visibility, publication, expiry, age, blocks, or entitlement. No later migration replaces this policy. A comment that remains visible when its parent is made private/unpublished is therefore not protected by the canonical content API decision.

The exact118-migration schema was replayed twice. With only explicit repo grants, the query returns42501 because the policy subquery needs SELECT on `content_items`. With documented existing Supabase default table grants installed **before** replay, an unlinked authenticated JWT subject, with no canonical account/age entitlement, can read the body and content UUID of a private draft's visible comment. Evidence `db-existing-supabase-grants-proof.json`; raw-grant baseline `db-populated-upgrade-proof.json`. This is not a claim that deployed grant defaults were inspected. Supabase's date-specific rollout notice says the new-table opt-in setting was scheduled for existing projects on 30 October 2026, while existing tables retain their current grants: https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically . Legacy grants are not the universal current new-project baseline. The repo does not establish a universal explicit ACL/default-privilege baseline, so historical grants must be inspected. A later independent full-schema fixture also reproduces expired adult Moment caption/expiry/provider-reference reads under retained SELECT grants; see verification-database.md and verification-direct-content-rls-proof.json. This extends DB-07's metadata exposure scope, not a proven signed-playback bypass.

Fix: keep comments server-only unless direct browser reads are required; otherwise require the same canonical parent-content eligibility and protected access rules. Make default privileges and all required grants explicit in migrations so new and existing Supabase projects have the same intended surface. Test direct-role reads after unpublishing/privatizing a previously commented post, for expired content, blocked users, unlinked subjects, and incomplete age assurance.

Investigated but not promoted: the performer verification trigger can copy `verification_records.status='invalid'` into a performer CHECK that excludes invalid. The database mismatch is reproducible, but the current normalized provider-decline webhook maps to `blocked`, so a reachable current declined-performer callback failure was not established.
