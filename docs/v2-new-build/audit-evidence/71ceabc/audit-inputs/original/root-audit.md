# Integration, configuration and authority findings — 71ceabc

This is an audit only of the clean remote snapshot. No local Mac worktree changes were available.

## ROOT-01 — P1 release blocker — Pinned runtimes precede current official security fixes

Evidence: `.node-version`, `.nvmrc`, `Dockerfile:2` and the stack ADR pin Node 22.16.0; `apps/web/package.json:42` pins Next 16.3.2; `apps/api/package.json` pins sharp 0.35.3. The current lock also selects an old sharp in the Next graph. Official Node release v22.23.4 (2026-10-21) includes high-severity security fixes. The official Next 2026-10-14 advisory recommends patched versions and sharp >=0.35.5 for the Linux image issue; the 2026-11-03 advisory provides Next 16.4.5. Specific exploit reachability depends on features and deployment; no exploit against WeVid was attempted. The August zero-audit statement is historical evidence, not a current security assurance.

Fix: verify current official advisories and exact installed dependency graph, upgrade within a supported compatible release line, regenerate the lock with the pinned package manager, update toolchain/Docker/CI/doctor/docs together, and run the full compatibility/security gates. Do not blindly upgrade every major or force unsafe overrides. Primary sources: https://nodejs.org/en/blog/release/v22.23.4/ ; https://nextjs.org/blog/nextjs-security-update-october-14-2026 ; https://github.com/vercel/next.js/releases/tag/v16.4.5 (official release fallback; November blog retrieval unavailable during independent verification).

## ROOT-02 — P3 cleanup / narrowed hypothesis — Redundant identity compatibility lookup

Evidence: `apps/api/src/modules/profile/profile-routes.ts:75` passes `viewer.userId` into `findCreatorProfileByHandle`; `profile-creator-repository.ts:14` resolves it through users.supabase_user_id. Independent second review established that migration0107 normalizes every nonnull compatibility value to users.id and current wallet creation fills both columns with that canonical ID. Ordinary wallet users therefore do resolve correctly, without Supabase recovery. The permitted null compatibility case would fail this legacy lookup, but no normal creation path producing it was found. The initial generalized failure hypothesis is withdrawn.

Cleanup: accept canonical users.id directly after compatibility review and test permitted null-column fixtures. Do not invent distinct recovery-provider IDs in this compatibility column; they belong in recovery identities. This is not counted as a confirmed current normal-wallet workflow defect.

## ROOT-03 — P2 — Legacy creator dashboard adds unlike currencies and labels everything SOL

Evidence: `profile-dashboard-repository.ts:78` sums payment ledger amounts without grouping by currency/mint/decimals; product summaries do the same. `profile-dashboard-mappers.ts:39` labels the result SOL and casts aggregates to Number. A creator receiving both SOL atomic units and USDC atomic units gets a meaningless SOL total; aggregates can also exceed safe Number precision. This still has a registered public API and typed client, even if newer Studio uses Analytics Core.

Fix: route dashboard metrics through the existing canonical registry or a shared asset-aware authoritative projection. Group by chain/mint/currency/decimals, preserve integer strings, and format display values with exact decimal conversion. Remove unused duplicate queries/contracts only after proving consumers have migrated. Test mixed SOL/USDC receipts and large totals.

## ROOT-04 — P2/P3 — Public profile has a duplicate incomplete offer presenter and unfiltered latest-plan selection

Evidence: `profile-user-mappers.ts:45-67` hardcodes periodDays 30, periodSeconds 2592000, currency USDC and provider official_solana_subscription_program, with planPda null rather than projecting all canonical plan fields. Current creator-offer creation also fixes the period to 30 days, uses USDC and does not populate a plan PDA; those values alone do not prove wrong billing terms for an ordinarily created current offer. `profile-creator-repository.ts:40` nevertheless takes the latest creator plan without filtering its state, and this remains a second incomplete subscription presenter beside canonical subscription resources. The confirmed issue is inconsistent selection/duplicated authority; variable-period/currency/PDA misrepresentation is a compatibility risk to verify, not an established current normal-path failure.

Fix: use the canonical current-offer mapper/selector and accepted immutable terms; exclude disabled/latest-draft offers from new purchases. Verify actual allowed configuration before assuming every hardcoded field can vary. Tests should compare profile, checkout and subscription offer projections for the same plan.

## ROOT-05 — P1/P2 operator blocker — Canonical staging migration path cannot apply pending migrations

Evidence: `scripts/staging-migrations.mjs:18` calls `supabase:history:check` before dry-run/apply. `scripts/check-supabase-migration-history.mjs:186` exits nonzero whenever any local migration is missing remotely. A fresh staging database or a valid deployed prefix with the next pending migration therefore cannot reach push through this path. Additionally root package scripts hard-require `node --env-file=.env` while the staging setup creates only `.env.staging`; a valid staging-only setup fails before using inherited configuration if .env does not exist.

Fix: classify applied prefix, expected pending suffix, holes, unknown remote versions and actual drift separately. Allow an expected pending suffix; reject holes/unknown or changed applied migrations; retain explicit safe target and backup acknowledgement. Make staging scripts use their actual inherited environment or the selected optional env file. Prove a clean checkout with only .env.staging, fresh DB, current DB, one new migration, history hole and wrong project. Do not disable history checks or rewrite deployed history.

## ROOT-06 — P2 — Staging journey results are static labels rather than executed evidence

Evidence: `scripts/staging-acceptance-status.mjs:1` simply copies journey.status from the committed manifest, except optional-feature deferral. `staging-acceptance.mjs:47` calculates overall PASS from global commands and passes only configuration statuses to the journey mapper, never individual proof/browser outcomes. Consequently a journey can remain BLOCKED after it passes; the committed admin PASS remains PASS even when no admin journey ran or another command failed. The report's separate final staging check limits false launch promotion today, but per-part evidence is not trustworthy.

Fix: distinguish requirements/configuration status from run outcomes; derive each journey from named current-release evidence receipts and actual tests, retain not-run/blocked/failed explicitly, and require every enabled launch journey before overall STAGING_PROVEN. No blanket promotion from global command success. Regression: failed admin, skipped journey, stale receipt, passing wallet only, complete successful matrix.

## ROOT-07 — P2 — Chain/provider configuration permits contradictory independent truths

Evidence: `packages/config/src/index.ts:49-54` independently accepts SOLANA_CLUSTER, SOLANA_NETWORK and SOLANA_RPC_URL with devnet defaults; subscription and Helius have more independent cluster aliases. `packages/config/src/public.ts` separately accepts a public chain with optional RPC. There is no cross-field refinement in either schema. FE-10 proves a concrete embedded-mainnet/devnet transport mismatch. Backend consumers choose different fields for wallet chain and payment context.

Fix: one validated environment model with a documented compatibility mapping and derived cluster/network values; reject contradictions and verify RPC genesis/network for configured release environments. Do not infer a private RPC's network from its hostname. Distinguish public browser configuration from secrets and verify API/worker/web agree before accepting money. Keep legacy aliases only at one documented compatibility boundary and retire them safely.

## ROOT-08 — P2 product gap — Legacy AI endpoints report static canned results as executed work

Evidence: `apps/api/src/modules/ai/ai-route-policy.ts` returns fixed caption, hashtag, event, metrics and lookup text independent of actual source data; prepareToolResult records state executed. `ai-repository.ts` conflict reuse does not compare scope/tools/input hash. Core docs instead promise deterministic authorized data/tools and an optional external assistant bridge, not a hosted model gateway.

Fix: inventory live consumers, retire or explicitly disable canned legacy operations, and route supported read/actions to existing canonical MCP/domain services. An unavailable assistant must be honestly unavailable, not successful static content. Do not add an LLM key gateway or custom agent framework. Enforce request-hash conflict/replay for any retained mutation and use real backend facts for summaries.

## ROOT-09 — P2 validation gap — CI omits the dedicated real auth lifecycle suite

Evidence: root `test:integration:api` includes `apps/api/test/auth-lifecycle.integration.test.ts`, but `.github/workflows/ci.yml` postgres-integration invokes an explicit list without it. Both explicit lists omit `didit-verification.integration.test.ts`; that file's distinct users.id/supabase_user_id fixture fails the effective0107 check (independently reproduced PostgreSQL23514), and its remote-target guards are weaker than the other suites. Ordinary disabled integration discovery does not replace an enabled real-database run. See integration test audit for exact evidence.

Fix: define the canonical enabled integration file list once, include auth lifecycle, and have local/CI call the same safe isolated command. Do not enable remote DB writes by default or let a skipped integration count as a pass.

## Operational gaps, not bypasses

- Deployment workflows intentionally end in a hosting-adapter gate. Adding provider keys alone does not deploy the app. Select a supported provider/OIDC adapter only with owner scope, then prove exact-artifact staging promotion and rollback.
- `scripts/load-smoke.mjs` defaults to /healthz and provides a bounded baseline, not feed/payment/media/realtime scalability proof. Measure representative queries and long client sessions before making efficiency claims.
- The Storage restore tool proves file-tree parity, not the complete provider-object lifecycle; keep provider backup/retention/restore requirements explicit.
- Do not delete applied migrations, compliance evidence, provider holds or domain glue just because they are old. Remove superseded runtime/docs only after callers, data and replacement ownership are verified.
