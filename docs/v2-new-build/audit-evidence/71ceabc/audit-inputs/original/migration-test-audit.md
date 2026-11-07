# Migration test full-read review

Snapshot: `mariospeterman/VEEL-v2` at `71ceabcfaa8a5258e1b935a391ff4e6e7330c682`.

File: `packages/database/test/migrations.test.ts`; all 1,316 lines / 80,867 bytes read in five complete, non-overlapping bounded chunks. SHA-256: `e425b1cd41b21fceb11499fabcb877f79962d5a202cfd6c3d555e2ef3b99f2a9`.

This file has 89 tests. Every test loads SQL text from disk and checks a filename, substring, regular expression, or substring ordering. There is no PostgreSQL connection, SQL execution, schema introspection, role switch, query execution, or seeded mutation in this file. These checks can remain useful architectural smoke checks; passing them establishes text properties only. No tests were executed in this subtask, and no repository source was changed.

No additional production defect is asserted here. The following are test coverage gaps to consolidate with the existing migration and product findings, rather than count as separate production vulnerabilities.

## MIGTEST-GAP-01 — Paired rollback files are not verified as runnable SQL

**Evidence:** lines 161–168 enumerate `.sql` files and assert that each up filename has a `.down.sql` counterpart. The 0039 publication test at lines 992–999 reads only the up migration. Only 33 of 118 rollback files are explicitly loaded by any content assertion in this file; the remaining 85 receive existence checking alone.

**Consequence:** a complete-looking rollback inventory passes this suite while a rollback contains invalid SQL. The database auditor's already-confirmed 0039 down syntax failure is a concrete example; this report does not duplicate that finding. Text checks also cannot establish dependency order, transactional behavior, or intended data-retention refusals.

**Recommended validation:** execute supported rollback paths against a disposable instance of the supported PostgreSQL/Supabase environment, including populated fixtures. Document explicit boundaries and assert expected refusal where historical facts must be retained. Do not convert intentional fail-closed retention into a requirement for destructive blanket rollback.

## MIGTEST-GAP-02 — Security and correctness names are accepted without testing their behavior

**Evidence:** RLS tests at lines 763–779 assert `enable row level security`, selected policy names and identity snippets. Media release tests at lines 185–215 assert function/trigger names and strings such as `count(*) = 4`. The realtime/live-safety test at lines 81–115 asserts permission fragments, monitoring names and fail-closed labels. No test in this file connects as `anon`, `authenticated`, another user, staff, or service role; invokes those functions; or attempts an authorized and unauthorized read/write.

**Consequence:** policy definitions can contain the expected snippets while predicates, grants, function execution privileges, sibling policies or later replacements change their actual effect. A source comment containing a required substring also satisfies `toContain`. Function names and negative secret-field regular expressions cannot prove the security claims in test titles.

**Recommended validation:** add a small real-database role matrix for canonical identity, RLS read/write permissions, media release evidence, realtime topic access, creator readiness and retention. Exercise revocation/adverse evidence and prove access stops. Reuse canonical fixtures and independently assert observable allow/deny outcomes.

## MIGTEST-GAP-03 — 32 forward migrations have no explicit content test in this file

**Evidence:** the file explicitly reads 86 distinct up migrations out of 118. The coverage JSON includes the full omitted list. Examples include 0076 session revocation, 0079 worker leases, 0082 checkout/USDC, 0094 social projections, 0095 realtime, 0097 live controls, 0103 commercial policy, 0104 provider event ordering, 0116 staff permissions and 0117 moments/scheduling. All receive filename-pair checks, which do not inspect their content or effects.

**Consequence:** the test file's broad title and long list of architectural checks should not be interpreted as complete migration behavior coverage. This is a coverage accounting fact, not evidence that those omitted migrations are incorrect or untested elsewhere in the repository.

**Recommended validation:** make the migration integration gate apply every forward migration and verify final schema invariants and essential behavior across the final schema. Prefer useful invariant tests over adding a substring test for every omitted file. Keep a clear distinction between source review, static tests, real database migration execution and provider end-to-end acceptance.

## MIGTEST-GAP-04 — Final-schema/API query compatibility is outside this test oracle

**Evidence:** the helper at line 9 only returns file text. Schema checks such as content foundation (lines 335–343), social/privacy (lines 61–79) and composer (lines 1271–1315) assert creation strings; the suite never prepares or executes application repository SQL against the final migrated schema.

**Consequence:** application queries that reference nonexistent columns, depend on incorrect DML-CTE visibility, or implement incompatible cursor types can coexist with a fully green migration-text suite. Existing content audit examples include the Mutuals `content_items.media_kind` query and event/live create CTE response bugs. Those remain product findings owned by the content/database auditors; this report adds no duplicate bug count.

**Recommended validation:** execute representative repository operations and read projections on the final disposable database: empty and nonempty feeds, create/read-after-write, pagination with equal timestamps, canonical identity mapping, explicit SQL enum/state mapping and concurrent idempotency replays. Use normal API journeys where possible so query compatibility and resulting behavior are checked together.

## Read coverage

Full semantic read: lines 1–260, 261–520, 521–780, 781–1040 and 1041–1316. The machine-readable manifest records exact hash, file length, every explicitly referenced migration, and migrations without explicit content assertions. Repository remained unchanged.
