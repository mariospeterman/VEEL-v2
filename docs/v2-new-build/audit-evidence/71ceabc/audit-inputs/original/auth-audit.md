# WeVid API identity, age/verification, admin and MCP audit

Snapshot: `mariospeterman/VEEL-v2` main `71ceabcfaa8a5258e1b935a391ff4e6e7330c682`. Reviewed on 2026-11-04. Read-only audit; no repository code changed. This is a scoped review, not a claim of exhaustive full-repository inspection. Coverage is recorded separately in `auth-coverage.json`. Local Mac uncommitted changes are unavailable.

## Confirmed defects and material gaps

### AUTH-01 — P1 — Generic age approval omits normalized age facts and onboarding activation, while session projects ready

Evidence: `apps/api/src/modules/age/age-routes.ts:39` deliberately routes Didit events through `/v1/webhooks/verification/didit`. `apps/api/src/modules/auth/wallet-auth-repository.ts:616-618` creates wallet users with `state='provisional'`. `apps/api/src/modules/verification/verification-repository.ts:357-370` inserts primary verification records without `threshold_age` or `result_over_threshold` (nullable columns, no defaults). The rest of `applyVerificationWebhookDecision` updates sessions/records/audit only; it does not activate the user or publish the profile. By contrast `age-repository.ts:292-304` records threshold18 and the normalized age decision, then `:309-321` activates eligible provisional users and sets profiles public for the dedicated age webhook path. Migration searches found no general verification-record activation trigger (only performer synchronization).

The read paths disagree: `age-repository.ts:187-205,231-232` treats a nonexpired primary `status='valid'` record as age verified without checking the omitted boolean. `session-routes.ts:82-86,122-135` allows a provisional profile with this age status and wallet to project ready. Creator dashboard/onboarding reads at `profile-dashboard-repository.ts:200-203,429-432` require `result_over_threshold is true`, so the same record projects failed age there; ordinary active-account product guards reject the provisional user.

Executed source probe: actual `createPostgresAgeRepository` canonical SELECT plus actual `registerSessionRoutes` handler against a minimal PGlite schema seeded with the exact generic-webhook omitted-field shape. Database state was provisional, threshold and result null; age status was verified; HTTP200 session was `allowed:true, reason:ready`; the creator age predicate was false. Auth/profile/wallet dependencies were supplied explicitly. This proves the contradictory read behavior, not full live-provider webhook integration. Output: `/workspace/scratch/0635fbdaf32f/auth-onboarding-proof.json`.

Impact: the preferred Didit path can report a ready app session while a new account remains provisional/private, creator onboarding remains age-failed, and active-account product APIs are unavailable. Persona/Veriff age decisions processed by the generic verification webhook have the same normalization/activation divergence. The content review separately traces the omitted normalized age fact into performer readiness; deduplicate the shared writer defect while preserving its distinct performer consequence.

Fix: one transactional verification decision application boundary with purpose-specific normalized facts and side effects. Persist threshold and true/false/unknown age results from authenticated provider evidence; activate eligible provisional users without reviving blocked/deleted users; preserve intentional profile privacy; and derive app/session/dashboard/product access from one authority. Prove new wallet → profile → signed Didit approval → consistent session/dashboard/content/feed/message readiness against real Postgres. Never infer an age fact from an arbitrary generic approval without checking the configured provider workflow and purpose.

### AUTH-02 — P1 — Verification validity is incorrectly tied to provider launch-session TTL

Evidence: `verification-provider-adapters.ts:171` sets Sumsub expiresAt to 600 seconds, `:295` sets Yoti to 900 seconds, Didit to 24 hours; these are launch/token/session lifetimes. `age-repository.ts:303` and `verification-repository.ts:367` copy `session.expires_at` directly into the valid verification record; `verification-repository.ts:393` also copies it to derived age evidence. Read paths expire valid records at that time (`age-repository.ts:183`, `verification-repository.ts:195`).

Impact: a successful user loses age/KYC capability after 10–15 minutes or 24 hours; an asynchronous approval received after session expiry is expired immediately. This destroys a low-friction onboarding experience.

Fix: separate launch/session expiry, decision observation time, evidence validity/recheck policy and revocation. Derive decision validity from a counsel/provider-approved evidence policy, not an SDK token TTL. Test approval after launch expiry and continued capability after the former launch TTL.

### AUTH-03 — P1 — Sumsub stores the external user ID as an applicant ID, then matches webhook applicant IDs against it

Evidence: `verification-provider-adapters.ts:135` calls `/resources/accessTokens/sdk` using `userId='user:<canonical-id>'`; `:160` reads response.userId; `:168` and `:169` store it as both providerReference and providerApplicantId. Both `age-webhook-adapter.ts:76` and `verification-webhook-adapter.ts:60` prefer `body.applicantId` over externalUserId. The repository queries provider-session/applicant/inquiry fields for that different value (`age-repository.ts:263`, `verification-repository.ts:321`).

Impact: authentic Sumsub verdicts normally become unmatched and are acknowledged/ignored rather than granting/revoking the correct subject.

Fix: store both documented external-user and real applicant identifiers explicitly; resolve the mapping from the official API or an authenticated callback using externalUserId + purpose/level. Do not call an external ID an applicant ID. Official sources: https://docs.sumsub.com/reference/authentication and https://docs.sumsub.com/docs/user-verification-webhooks (web refs `turn28search7`, `turn15search4`).

### AUTH-04 — P1 — Persona creation requires a one-time link that the request never asks Persona to create

Evidence: `verification-provider-adapters.ts:340` request meta includes only redirect-uri. `:347` requires `meta.one-time-link`, throwing a provider 502 if absent. `apps/api/test/app.test.ts:1335` supplies a fabricated create response containing the link regardless of request flags.

Impact: configured Persona onboarding/verification fails against the documented API despite the mocked test passing.

Fix: send the current documented `meta.auto-create-one-time-link=true` flag and pin the supported Persona API version, or call `generate-one-time-link` as a separate supported action. Replace the fixture with the official minimal response and assert the required request flag. Sources: https://docs.withpersona.com/2025-12-08/updates/changelog/2026/1/18 (`turn28search2`) explicitly states the flags; https://docs.withpersona.com/api-reference/inquiries/create-an-inquiry (`turn28search0`); https://docs.withpersona.com/api-reference/inquiries/generate-a-one-time-link (`turn28search1`).

### AUTH-05 — P1 — Verification updates use delivery order rather than authoritative provider event order

Evidence: `age-repository.ts:282` and `verification-repository.ts:345` unconditionally change session state and append a new verification record for every distinct event. No comparison against the current provider observed/version time occurs. Reads select the most recently inserted record by created_at/id (`age-repository.ts:193`, `verification-repository.ts:209`).

Impact: a delayed authentic approval can revive a subsequently failed/revoked verification; a stale pending event can also remove current valid access. Multiple old provider sessions can overwrite newer verification evidence for the same subject/purpose.

Fix: persist authoritative event identity and observed/version time, serialize decisions by subject/purpose, apply monotonic or provider-state reconciliation rules, and preserve explicit adverse holds. Do not reuse the Bunny/Livepeer delivery-sequence helper without verifying each identity provider's event semantics. Sources explicitly warn about later RED verdicts and stale retries: https://docs.sumsub.com/docs/receive-verification-results (`turn15search5`); https://docs.didit.me/integration/webhooks (`turn23view0`, delivery order).

### AUTH-06 — P1/P2 — Fast or out-of-order webhooks can be permanently lost before session persistence

Evidence: age and verification routes call the provider before inserting the local session (`age-routes.ts:169`, `verification-routes.ts:195`). `age-repository.ts:270` and `verification-repository.ts:331` mark unmatched events ignored and return success. `applyProviderWebhook` commits the event receipt first; future retries hit ON CONFLICT and return duplicate before rematching. Only hashes are retained for these identity events, with no recovery payload/reference queue sufficient for replay.

Impact: webhook arriving between provider session creation and local persistence leaves a permanently pending account; redelivery is acknowledged but cannot apply.

Fix: reserve a durable local logical session before the external call; persist an outbox/handoff state and subject reference; retain minimized authenticated normalized event facts for retryable unmatched reconciliation. Add fault tests for callback-before-insert and DB failure after provider creation.

### AUTH-07 — P1 — Recovery exchange manufactures recent authentication from reusable bearer-token validation

Evidence: `session/supabase-auth.ts:55` only calls getClaims and returns provider subject/email, dropping provider authentication/session times and session identity. `wallet-auth-repository.ts:468` always sets `authenticatedAt:new Date()` when exchanging the same reusable recovery JWT. `/auth/sessions/logout-all` revokes only app_sessions (`wallet-auth-repository.ts:567`), leaving a still-valid linked provider token able to issue another app session. Sensitive wallet/recovery/staff mutations rely on this synthetic recent timestamp.

Impact: an old or stolen still-valid recovery JWT can repeatedly obtain fresh-auth privileges and recreate sessions after the user chooses logout-all. Local frontend sign-out does not revoke already-issued JWT validity.

Fix: bind recovery exchanges to a verified live provider session, preserve actual authentication/step-up time, reject exchanges older than the relevant security epoch/session revocation boundary, and require fresh proof for credential/staff changes. Define all-device logout semantics explicitly and prove them with a captured pre-revocation recovery credential. Supabase sources: https://supabase.com/docs/guides/auth/managing-user-data (`turn11search11`) and https://supabase.com/docs/guides/auth/sessions (`turn11search2`). This is separate from the DB agent's direct Data API/RLS bypass finding.

### AUTH-08 — P1 — MCP OAuth authorization codes can be redeemed concurrently more than once

Evidence: `mcp-routes.ts:266` reads code status, `:273` tests usedAt, `:283` marks used, then `:285` issues the token in a different DB call. `mcp-repository.ts:618` updates used_at with coalesce without AND used_at IS NULL/row-count enforcement; `:625` inserts a token for codeId without an unused-code predicate. `0066_mcp_oauth_completion.sql:105` permits multiple tokens for code_id; `0074` adds only a nonunique index.

Impact: two simultaneous valid exchanges can mint multiple tokens from a one-time code. A failure between the separate mark and insert also strands the code.

Fix: one transactional compare-and-set consume + token issue operation with exact client/redirect/PKCE/resource/expiry checks and a defense-in-depth unique redemption constraint. Concurrent redemption proof must show exactly one success, others invalid_grant; failure injection must not strand a consumed code with no issued token.

### AUTH-09 — P1/P2 — Public avatar storage bypasses the existing image safety boundary

Evidence: `profile-routes.ts:330` avatar endpoint needs only a valid application session. `:372` trusts requested contentType, `:373` base64-decodes raw bytes; `:398` uploads them directly into a public Supabase bucket and returns its public URL. Validation checks MIME string/base64 shape/size, not file bytes, decode dimensions, metadata stripping or content safety. `content/image-sanitizer.ts` already exists and is reused by MCP media upload, but not avatars.

Impact: unverified/provisional accounts can publish arbitrary claimed-image bytes and unreviewed public imagery through the avatar path, with orphaned repeated uploads. This undermines the media safety model and adds storage/abuse costs.

Fix: reuse the canonical image decode/re-encode/size policy, enforce the profile media SFW policy and upload quotas, keep temporary objects private until accepted, update the profile transactionally, and garbage-collect abandoned/replaced objects. Provider safety and deletion evidence remain required for launch.

### AUTH-10 — P1/P2 — Many admin and profile mutations check an Idempotency-Key but never enforce it

Evidence: `admin-repository-feature-flag.ts:26`, `admin-repository-privacy.ts` updateDataRequest/updateRefundDispute, `admin-repository-support.ts` updates, `admin-repository-moderation.ts` updateReport/updateContentModeration use the key only in audit metadata or some evidence insert. They lack a durable actor/operation/request-hash receipt. Profile PATCH checks header presence (`profile-routes.ts:267`) then calls upsertMyProfile without the key; avatar likewise creates a random object each retry.

Impact: replaying an earlier request can reapply stale state after a newer decision, create duplicate audit evidence, or create extra public avatar objects. Changed payload reuse is accepted rather than 409. The current status document's lifetime-idempotency completion claim is overstated for these methods.

Fix: migrate each logical operation to a shared durable receipt + request hash + transaction pattern. Replays must return the original result without changing subsequent state; changed payload with same scoped key must conflict. Do not apply arbitrary expiry to receipts for lifelong logical operations.

### AUTH-11 — P1/P2 — Admin pagination silently skips rows; priority-sort cursors are also incomplete

Evidence: `admin-repository-mapper-utils.ts:8` returns 50 items but selects row[50] (the unreturned 51st row) as the next cursor. List queries use `< cursor`, so that row is never returned. Timestamp-only ordering also lacks an ID tie-breaker. `admin-repository-moderation.ts` listContent/listReports sort by urgency first but filter only created_at; `admin-repository-support.ts` listSupportPolicies sorts/filters updated_at while cursorFor prefers created_at.

Executed probe against the actual TS helper: 101 strictly dated rows produce page1 IDs1..50, cursor ID51, page2 IDs52..101; ID51 is absent. No DB/provider credentials needed.

Fix: use last returned row as the exclusive boundary and encode every ORDER BY field plus unique ID in an opaque versioned cursor. Test >2 pages, equal timestamps, priority transitions, and created_at differing from updated_at. Treat safety/compliance queue completeness as a correctness requirement.

### AUTH-12 — P2 — Admin overview always reports zero open reports

Evidence: `admin-repository-access.ts:159` executes `select 0 as open_reports`; `:249` projects it into operations health. `admin-repository-event-ops.ts:281` similarly hardcodes zero in the Mutuals safety summary.

Impact: safety reports are invisible in the high-level health summary even when the queue contains active reports.

Fix: query/project the canonical report states and document the operational definition; test nonzero submitted/reviewing/escalated counts.

### AUTH-13 — P2 — Feature-flag listing truncates configuration and is reused for exact policy decisions

Evidence: `admin-repository-feature-flag.ts:13` limits to pageSize=50 and returns nextCursor:null. `admin-route-auth.ts:148` featureFlagEnabled reads that page and searches by key.

Impact: flags outside the newest 50 become inaccessible to the admin UI and can be treated as disabled despite an active canonical row. This is fail-closed for the current CARF route but still incorrect configuration behavior.

Fix: add exact-key policy lookup and proper paginated management listing; never use a truncated management page as policy authority.

### AUTH-14 — P2 — MCP connection quota is process-local and never evicts expired buckets

Evidence: `mcp-routes.ts:64` defines module-global toolCallBuckets Map; `:1097` consumes it without cleanup or distributed storage. The API separately requires distributed production rate limits, but those default IP limits do not enforce the documented per-connection tool quota across replicas.

Impact: effective quota scales with replica count; long-lived processes retain one entry per historical connection and restart resets quota.

Fix: use the existing distributed rate-limit boundary keyed by connection + tool sensitivity, bounded TTL storage, and consistent 429/retry semantics. Keep an in-process implementation for explicit tests/development only.

### AUTH-15 — P2 hardening, reproduced — Didit freshness checks trust an unsigned header instead of binding freshness to signed content

Evidence: `didit-webhook.ts:14` reads x-timestamp and checks that value; HMAC at :23 authenticates only canonical body. Executed the actual standalone TS function with a correctly signed body whose timestamp was 24 hours old and a replaced current x-timestamp: accepted=true. Exact duplicate event dedupe limits replay of already stored events, but unseen/delayed events and missing-order protections remain exposed.

Fix: verify the signed payload timestamp (and any required header/body consistency) using the current supported official SDK/algorithm, plus durable event idempotency/order checks; support documented rotation overlap safely. Official provider sources are inconsistent: https://docs.didit.me/integration/webhooks (`turn23view0`) still illustrates header tolerance, while the official https://github.com/didit-protocol/plugin-wordpress (`turn23view2`) explicitly checks signed-body timestamp with header only fallback and rejects refreshed-header replays. Confirm the deployed contract with signed real fixtures; do not claim the provider specification unambiguously mandated our proposed change.

### AUTH-16 — P2 — Generic verification session creation is not atomic

Evidence: `verification-repository.ts:83` resolves subject and inserts verification_sessions, then inserts verification_records in a separate await on sql, outside a transaction. Its age counterpart already uses sql.begin.

Impact: failure during the second insert leaves a pending session without its canonical pending record; route returns failure after an external billable session exists. Repeating creation can create more external/local sessions.

Fix: transactionally reserve local session/record/receipt and use a durable provider handoff as described in AUTH-06; protect changed-input reuse.

### AUTH-17 — P2 — Concurrent replay of a consumed wallet proof returns an unhandled 500

Evidence: `wallet-auth-routes.ts:136` calls createSessionFromChallenge; its catch :151 handles AccountNotFound/config errors but omits WalletAuthChallengeInvalidError. Repository correctly throws that error for a concurrent loser (:329) after both HTTP requests passed the pre-read consumedAt check.

Fix: map the error to the documented invalid-proof/conflict response, preserving single-use behavior. Test concurrent exchange and retry after a successful response was lost.

### AUTH-18 — P1/P2, PostgreSQL parser reproduction — Admin live-room listing has ambiguous SQL columns

Evidence: `admin-repository-event-ops.ts:107` listLiveRooms selects unqualified `id`, `state`, `created_at`, and `updated_at` from `live_rooms LEFT JOIN live_safety_sessions`; both tables define these names. The cursor/order clauses also use unqualified created_at. Extracted the exact tagged query from source, substituted a null cursor and limit51, and executed it under PGlite against a minimal schema with the real overlapping columns: PostgreSQL error `42702 column reference "id" is ambiguous`.

Impact: the admin live page fails when a real database is connected, preventing provider/safety inspection. Mock route tests do not parse this SQL.

Fix: explicitly qualify/project the owner table's columns and use the full stable pagination boundary. Add a real-Postgres admin projection test, not a SQL substring assertion.

### AUTH-19 — P2 — Admin identity checks use a legacy table instead of canonical verification records

Evidence: `admin-repository-event-ops.ts:207` listIdentityChecks reads `identity_verifications`. New provider decisions in `verification-repository.ts` write only `verification_sessions` and `verification_records`; no runtime insert/update to identity_verifications was found under apps. The age listing immediately above correctly reads verification_records. The admin document says this route covers current identity/KYC/KYB provider projections.

Impact: new creator/adult-publisher/business decisions are missing from the admin identity page while obsolete records can remain visible, conflicting with the single verification authority.

Fix: project canonical verification records/sessions with purpose and subject type, migration-compatible legacy read only if explicitly identified as historical. Do not delete historical records needed for audit; stop using them as current state.

### AUTH-20 — P1/P2 — Concurrent admin organization-owner removals can leave no owner

Evidence: `admin-repository-organization.ts:264` updateOrganizationMember locks only the target membership row. Its scalar subquery counts active owners, then :300 rejects only if the count is already <=1. Two concurrent transactions removing different owners each observe two owners and hold different row locks; no shared organization/advisory lock serializes the invariant. Staff-owner changes correctly use a common governance advisory lock in admin-repository-staff.ts, providing an existing pattern.

Impact: an organization with two owners can end with zero active owners after concurrent authorized requests, contrary to the documented governance invariant.

Fix: serialize all owner-set changes on the organization row/common lock and recheck within the same transaction; use the shared authorization/idempotency boundary. Prove two distinct-owner removals leave one active owner. The normal user-facing org route refuses owner edits, so this finding is specifically the admin route.

### AUTH-21 — P2 — Current MCP connections/tool calls are absent from the admin AI/MCP audit projection

Evidence: `admin-repository-event-ops.ts:233` listAiSessions reads ai_sessions and `:251` listAiToolCalls reads ai_tool_calls. Current remote MCP activity is stored in mcp_connections/mcp_tool_calls (`mcp-repository.ts:771`); these are not joined/projected by either route. `admin-operations-dashboard.md:39` describes them as AI/MCP operations projections.

Impact: the actual external connector calls, failures, denied attempts and connection state cannot be inspected through the claimed canonical admin view.

Fix: one minimized operations projection across the two distinct transports (or retire the old generic assistant domain after checking scope), preserving separate identities where required. Expose actor/connection/tool/version/scope/result/timing only; never raw prompts, private content or tokens.

## Documentation reconciliation from three fully read domain docs

- `admin-operations-dashboard.md:27` says analytics/AI/MCP no longer accept broad active-staff access; platform analytics still does, and MCP uses a separate role-to-scope switch rather than effective explicit permissions. Link to the concrete runtime findings instead of preserving the blanket completed claim.
- Admin docs claim live provider/identity/MCP/report projections that AUTH-12/18/19/21 show are zero, stale, or broken. Mark behavior accurately until regression-backed fixes land.
- The admin requirement that owner governance preserve one active organization owner needs concurrent proof (AUTH-20), not only serial/mock assertions.
- `realtime-messages-activity.md` says staff/moderator access remains behind backend projections rather than broad client RLS; the DB review's broad staff SELECT policies contradict that claim. It correctly labels real Broadcast/VAPID staging as provider-blocked; retain that honesty.
- `safety-admin-ai.md` is last-updated 2026-06-01 and lists planned user/creator/admin tools not present in the current MCP tool registry. Distinguish supported tools from future scope; do not implement unused broad capabilities merely to satisfy stale prose.
- Realtime message diagram still describes a generic authorized change/new-message event whereas the stronger current prose correctly specifies private invalidation + API refetch. Align the diagram with implemented transport semantics.

## Additional review observations to validate before changing behavior

- Status mapping uses substring checks (`verification-webhook-adapter.ts:237`), including completed/passed/success. Persona distinguishes done versus optional decisioning states; a configured workflow requiring post-inquiry review must not grant at completed. Replace broad fuzzy mapping with provider/purpose-specific explicit allowed states tied to approved workflow configuration. Source https://docs.withpersona.com/2023-01-05/accessing-inquiry-status (`turn17search8`). This is a conditional policy gap, not proof that all Persona completed inquiries are unsafe.
- VerificationProviderHttpError retains raw response.text in public error.body; routes log `{error}`. Confirm logger serialization in the installed version and redact/normalize provider diagnostics rather than storing arbitrary response bodies. No evidence of an actual production leak was available.
- Admin permissions are checked before repository transactions; most mutating repository actor queries do not re-check current permission after acquiring locks. Add revocation-race tests and transactional authorization where permission revocation must take immediate effect. Do not duplicate a role table per repository.
- New `admin-permissions.ts` explicit grants are not the only authority: retryDeadLetterJob hardcodes owner/admin/ops; MCP has a separate staff-role-to-scope switch. Reconcile intended product semantics with one capability registry rather than blindly deleting defenses.
- Registered permission admin.users.restrict has no corresponding user-restriction mutation route in the reviewed admin routes. Verify this against the product/admin docs and surface as a feature gap if user suspension is required.
- The raw-message wallet auth path is signed/nonce-bound and backend-verified; it should be preserved until a measured official capability migration is ready. Current Solana docs recommend off-chain-message v1 with signMessage fallback and an explicit hardware-wallet transaction alternative: https://solana.com/docs/frontend/messages-and-auth (`turn11search0`). This is compatibility work, not evidence that present raw signatures are insecure.

## Cross-agent findings and boundaries

- DB reviewer is proving broad staff RLS access through recovery/Realtime JWTs despite API permissions. Do not count this as independently reproduced here.
- Analytics reviewer confirmed platform query authorization checks any staff membership, which conflicts with specialized role permissions; canonical trust_safety/support/event_ops/ai_ops lack admin.analytics.read. They own the analytics finding.
- Frontend reviewer owns the auth-confirm backslash open redirect and callback UX tests.
- Profile/AI and organization/performer domains were reassigned to root/content reviewer. Avatar/idempotency findings above remain part of this review.

## Validation performed and limitations

Actual source probes run successfully under Node24.22.1: admin pagination skip and Didit unsigned-header freshness bypass. These are audit-only probes; the production runtime is pinned to Node22 and the full pinned unit/browser/Postgres/provider suites must be run by the root/test owner. This reviewer did not run the complete unit suite, deploy, call live providers, access secrets, modify main, or inspect local Mac changes. Most identified defects are source-traced and should gain focused failing regression tests during remediation. Do not represent provider-blocked staging as PASS.
