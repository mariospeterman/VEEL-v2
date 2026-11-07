# API integration-test audit

Repository: `mariospeterman/VEEL-v2`, commit `71ceabcfaa8a5258e1b935a391ff4e6e7330c682` (`71ceabc`). Audit date: 2026-11-04. Source checkout: `/workspace/scratch/0635fbdaf32f/wevid-audit`. Source files were not modified.

## Coverage and execution boundary

All seven `apps/api/test/*.integration.test.ts` files were read in full, including bodies, helpers, assertions, and cleanup: **9,740 lines**. This is full textual review, not filename or grep-only coverage. The accompanying JSON records the exact hashes and ranges. The parent agent owns repository lint/typecheck/unit/build execution. This sub-audit did not execute these seven Vitest suites against a Supabase/Postgres service or any real age, media, wallet, RPC, subscription, or live provider.

An additional isolated **PGlite PostgreSQL** proof applied all **118 forward migrations** and tested the Didit fixture against the resulting schema. It reproduced SQLSTATE `23514`; canonical equal-ID and NULL-provider-ID controls inserted successfully. This proves a current schema/fixture incompatibility. PGlite compatibility bootstrap supplies auth functions and an empty realtime publication; it does not prove hosted Supabase or provider operation. Raw result: `/workspace/scratch/0635fbdaf32f/integration-fixture-proof.json`; reproducible script: `/workspace/scratch/0635fbdaf32f/db-proof-runtime/integration-fixture-proof.mjs`.

| File | Lines | What the fully read test actually exercises |
| --- | ---: | --- |
| authenticated-happy-path.integration.test.ts | 7,227 | Cross-module API injection against Postgres, fixture age/media/live/chain adapters, wallet lifecycle helper tests, SQL assertions and broad cleanup |
| auth-lifecycle.integration.test.ts | 176 | Wallet-auth repository purpose/creation behavior and identity-count invariants against Postgres |
| didit-verification.integration.test.ts | 96 | Direct verification repository application of a normalized, already-authenticated webhook decision; currently invalid identity fixture |
| admin-staff.integration.test.ts | 221 | Staff role permissions and organization invitation/membership lifecycle, expiry/concurrency, last-owner guard |
| analytics-core.integration.test.ts | 373 | Duplicate-safe backfill projections, reconciliation and manually enqueued late-fact recovery |
| policy-content-eligibility.integration.test.ts | 606 | SQL recipient-readiness policy and viewer-relative content predicate, with isolated published fixtures |
| mcp-profile-bridge.integration.test.ts | 1,041 | Scoped-token connection/domain repository, upload-capability leases/quotas/concurrency, provenance/readiness/quarantine and cleanup |

## Confirmed test-harness issues

### INT-01 — P2 — Didit integration fixture cannot run on the current migrated schema, and its normal integration gates omit it

**Evidence:** `apps/api/test/didit-verification.integration.test.ts:25` creates two independent UUIDs; line 30 inserts them as `users.id` and `users.supabase_user_id`. Migration `packages/database/migrations/0107_canonical_access_identity.sql:32` enforces `supabase_user_id IS NULL OR supabase_user_id = id`. Every distinct fixture pair violates this constraint before reaching the claimed verification behavior. The isolated proof applied all 118 migrations and reproduced code `23514`, constraint `users_legacy_supabase_id_canonical_check`.

`package.json:59` explicitly enumerates six integration files and leaves this file out. `.github/workflows/ci.yml:121` explicitly enumerates five and leaves both this file and `auth-lifecycle.integration.test.ts` out. The ordinary unflagged test run skips these suites. Consequently green default tests and the dedicated CI integration job do not exercise this stale fixture.

**Fix:** use canonical user IDs, preserve provider subjects through the supported identity model, and include every current integration suite through a single authoritative discovery/configuration mechanism rather than diverging hand-maintained lists. Add the auth-lifecycle suite to CI as well. Preserve this test's intended assertion that valid documentary adult-publisher evidence derives age access; add a separate route-level signed-webhook activation test. Do not treat normalized repository events as proof of Didit's live signature/response contract.

**Acceptance:** run every integration file against a fresh database with all migrations applied; verify Didit reaches capability assertions; fail the gate if expected suites are skipped or omitted.

### INT-02 — P2 — Didit bypasses the database-target safety guard used by every other integration suite

**Evidence:** `apps/api/test/didit-verification.integration.test.ts:12` chooses `TEST_DATABASE_URL ?? DATABASE_URL`, accepts any host, ignores `API_INTEGRATION_DATABASE_URL`, and does not reject `NODE_ENV=production`. The opt-in flag controls execution but provides no acknowledgement of the chosen database. Other suites require loopback or, for the long happy journey (`:5499`), explicitly reject production mode and demand a second remote-target acknowledgement.

**Effect:** enabling the integration flag for the intended local database can instead run Didit writes against an inherited fallback deployment URL. The current fixture error aborts its first insert on current schema; correcting INT-01 would expose the target inconsistency. This is a harness safety/configuration defect, not evidence that production data was modified.

**Fix:** share one guard and URL precedence across all suites. Prefer an explicit integration URL and a disposable local database; if remote test targets are intentionally supported, require a named test target/explicit acknowledgement and refuse production mode. Ensure cleanup/connection closure executes even when setup or assertions fail.

### INT-03 — P2 — The long journey's fixed users and broad cleanup make independent runs interfere

**Evidence:** `authenticated-happy-path.integration.test.ts:48` and `:49` define constant buyer/creator UUIDs across every run. Although most content/reference IDs contain a unique run ID, initial/final `cleanupRun` selects *all users* with those two subjects (`:6440`) and then *all organizations* in which they are members/inviters (`:6446`), *all content* owned by them (`:6490`), and further associated records. Setup also shares deterministic settlement-wallet fixtures. Two independent runs on one database can erase or repurpose each other's rows. The optional remote execution path supports a shared target, so this is not only a theoretical choice of unsupported environment.

The policy integration suite additionally mutates the global default `recipient_monetisation_policies` row (`policy-content-eligibility.integration.test.ts:85` and subsequent updates), then restores its snapshot in `finally` (`:552`). Separate concurrent test processes can observe temporary policy or restore stale snapshots. CI's current `--no-file-parallelism` plus a disposable local service mitigates within-job execution; it does not isolate independent invocations.

**Fix:** allocate unique canonical users and wallets per run; delete only IDs owned by that run. Keep global-policy tests in isolated disposable databases or serialize at the database level with an explicit test-run lock. Make the supported concurrency assumptions clear in the runner/docs. Use nested `try/finally` so a cleanup error does not prevent closing the app/client or restoring env state.

**Acceptance:** start two integration runs concurrently against the documented supported test target and ensure neither changes the other's fixtures; confirm cleanup touches only the run's owned records. For intentionally serialized global-policy tests, verify competing runs are explicitly prevented or isolated.

## Evidence gaps to add to the repair task, not independent runtime bugs

Provider fixtures and direct SQL seeding are legitimate domain-test techniques. A skipped external provider check is not itself a product bug. The following gaps explain why these suites cannot certify the full user/provider journey and where regression tests should accompany independently confirmed runtime fixes.

| Boundary | Existing proof | Missing acceptance proof |
| --- | --- | --- |
| Authentication and canonical identity | Long journey injects canonical IDs; additionally clears/restores compatibility `supabase_user_id` for session/onboarding/dashboard checks (`:650` onward); later helper tests exercise real repository rotation/device revocation | Real wallet signatures and recovery-provider callback through HTTP; fresh/stale real cookies; canonical identity with NULL compatibility column while browsing creator profiles and all viewer-relative surfaces. Fixed equal IDs mask canonical-vs-provider lookup mistakes. |
| Age verification | Fixture waterfall plus HTTP signed Sumsub fixture and repository assertions; Didit direct normalized event after INT-01 repair | Provider sandbox session creation/callback contract and one complete activation route per configured provider; adverse/replayed/partial identity evidence with durable state assertions. No claim that a provider was contacted follows from a fixture result. |
| Video creation → release → playback | Media-provider `isConfigured()` is false, `createUploadSession()` deliberately throws (`:108`); seeded media rows and provider scan facts drive downstream gates | Actual video upload-session route, provider ready callback, ordinary publish/review route and playable authorized delivery. The fixture cannot catch failures that occur before seeded content exists. |
| Image creation → release → visible feed | At `:1920` onward uploads a real Sharp-generated image to an in-memory adapter; proves rotation, EXIF stripping, checksum, persistence and replay conflict | The created image is subsequently retired; it is not published and fetched/rendered as viewer media. Add a complete signed image delivery/expiry/denial test plus browser rendering. Sanitization success does not prove storage bytes are reachable through the product. |
| Publishing and live events | `approveSeededContent` (`:5928`) inserts declarations/cases/scans and directly publishes fixtures; event/live rows are seeded; live-provider room creation/status deliberately throw (`:218`) | Normal create/upload/review/publish APIs, event/live creation, provider status callbacks, broadcast/playback lifecycle and cleanup. Keep existing read-gate fixture tests but add the missing write journey. |
| One-time Solana settlement | Rich SQL durable-artifact checks; API flow invokes a settlement verifier that returns `confirmed: true` for any signature except one reserved invalid signature (`:129`) | Real locally controlled/devnet transactions through the official parser/verifier: wrong recipient/amount/mint/network/memo/reference, partial split payment, repeated signature, failed/expired/unconfirmed transaction. Mocked confirmation does not prove transaction evidence. |
| Subscription authorization | Verifier echoes supplied facts and accepts them (`:157`); transaction builder base64-encodes an arbitrary fixture string (`:207`) | Transaction deserialization, exact supported program/instruction/accounts/fees/amount, wallet sign/submit, independently verified on-chain authorization and revocation. |
| Subscription collection/recovery | Initial collection runs synchronously with immediate mocked confirmation (`:4795`); later fixture renewal/replay assertions prove portions of worker/domain behavior | First-charge claim/lease race, crash after broadcast, uncertain RPC outcome, delayed reconciliation and cancel/revoke while leased; exactly-once receipt/ledger/compliance artifacts and retained evidence. Subscription assertions count events/collections; they do not assert parity with one-time settlement artifacts. |
| Engagement idempotency | Concurrent repeated like key A/A (`:1172`) and repeated comment-like A/A (`:1257`) | A/B/A sequence after a second state-changing intent, delayed retry, failed response plus retry, concurrent distinct keys, fresh read/count parity. Immediate duplicate proof is narrower than durable replay safety. |
| Analytics | Six-viewer cohort with one media asset, manually enqueued backfills, repeated/late facts and typed parity | Below-threshold suppression on *every* exposed field, multiple media assets per content, normal automatic hourly/incremental freshness, independent role permissions on platform metrics. `withoutAutomaticIncremental` (`analytics-core.integration.test.ts:363`) intentionally turns off enqueueing, so it cannot verify the production enqueue boundary. |
| Content eligibility | Direct canonical private SQL predicate; replica-mode insert (`policy-content-eligibility.integration.test.ts:372`) explicitly isolates reads from release writes | Same denied/allowed cases through discovery, mutuals, profile, playback, live and message surfaces to establish a single predicate in practice. Disabling triggers for a narrowly scoped read fixture is intentional, not itself a product security bypass. |
| MCP and external client compatibility | Scoped-token connection (`mcp-profile-bridge.integration.test.ts:54`), thorough repository concurrency, quotas, leases, provenance and readiness | Actual OAuth authorization-code/code-redemption/PKCE transport, simultaneous redemption, user-approved connection, client protocol contract and signed delivered image bytes. No real external MCP client session was run by these repository tests. |
| Frontend experience | These files use Fastify injection or repositories/SQL | Responsive web UI, actual navigation, mobile/desktop browser wallet and age flows, playback, upload progress, keyboard/accessibility, no blank screens, errors/retry, performance and memory. Browser end-to-end proof must be reported independently. |
| Service roles and RLS | Admin test proves application/repository role permissions and organization owner protection | Direct authenticated/anon Data API/RLS abuse matrix and realtime access; API RBAC success is not equivalent to hosted Data API policy proof. |

## What was checked and not reported as a bug

- The apparent missing `sql.end()` in the long journey is **not a leak**: `app.close()` calls `apps/api/src/app-lifecycle.ts:37`, whose close hook ends the injected Postgres client. The other standalone repository tests explicitly close their clients. A cleanup exception can still skip a later close; this is addressed as harness resilience under INT-03, not a proven normal-path leak.
- Rate limiting is intentionally replaced with an always-low integration store for the long cross-module test. The code documents that dedicated route tests own thresholds. This is not evidence that production rate limiting is disabled.
- Direct database fixtures, scoped-token MCP tests, and replica-mode read-gate fixtures are valid isolated tests. They should retain clear names and claims; supplement them with complete journeys rather than deleting valuable lower-level coverage.
- CI serializes the selected integration files. Cross-file interference was not reproduced in CI; INT-03 concerns shared fixed identities/global state and independently concurrent invocations.
- No assertion here establishes that the entire product is secure, compliant, fast at production load, or compatible with live providers. Those claims require the specific acceptance evidence listed above and the parent's runtime/domain audit.

## Suggested task ordering

1. Repair INT-01/02 and consolidate integration suite discovery and database-target guards.
2. Isolate fixtures/global policy execution and cleanup (INT-03), then run the entire enabled suite against a fresh fully migrated disposable database.
3. For every independently confirmed runtime finding in the parent audit, add the narrow failure regression first and remove its fixture masking from the relevant acceptance journey.
4. Keep domain/Postgres fixture tests fast. Add separately named provider-contract, locally controlled chain/devnet, hosted Supabase security and responsive-browser acceptance gates; disclose unavailable credentials or provider downtime as blocked proof, never a fabricated pass.
