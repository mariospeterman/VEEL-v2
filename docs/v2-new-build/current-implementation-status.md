# Current Implementation Status

Status: accepted
Scope: implementation status, known gaps, and next hardening priorities
Last updated: 2026-08-22
Source of truth: yes

Owns:
- honest current-state tracking for the v2 implementation
- fail-closed versus implemented boundaries
- near-term hardening priorities before broad feature expansion

Defers to:
- `build-plan.md`, OpenAPI, migrations, ADRs, and provider docs for exact behavior

Does not own:
- new product requirements, provider payload shapes, or schema details

Launch scope:
- implementation status through the current autonomous build sequence

Non-goals:
- claiming production readiness before provider credentials, staging smoke, deployment, and security gates are complete

## Controlling Rules

- Backend owns business truth; frontend owns route state, UX, cache, and safe pending indicators only.
- Money can buy content, Event Access, memberships, live access, subscriptions, and platform software features.
- Money must never buy people, visibility, matches, recommendations, ranking, moderation priority, message priority, or preferential social treatment.
- Blockchain is payment truth. Entitlements are access truth. Compliance ledger is reporting truth. Accounting export/integration is bookkeeping truth.
- WeVid remains noncustodial: no internal credits, balances, escrow, withdrawals, payout queues, or server-held user private keys.

## Merged Baseline And Next Planned Slice

Protected `main` owns stable merged truth only. Live branch, pull-request, head-SHA, CI, and review
state come from the one open pull request carrying `wevid-active-slice`; they are intentionally not
copied into this document. The machine-readable companion is `production-status.json`.

| Field | Current value |
| --- | --- |
| Latest merged baseline | `b5e190480032c38db485138206cb09e296d7053a` |
| Latest merged slice | Convergence 01 — policy and eligibility |
| Latest merged migration | `packages/database/migrations/0108_policy_content_eligibility_convergence.sql` |
| Latest merged evidence | `DESIGNED`, `CODE_COMPLETE`, `UNIT_TESTED`, `REAL_POSTGRES_PROVEN`, `BROWSER_PROVEN` |
| Known launch blockers | `STAGING_PROVEN`, `PROVIDER_APPROVED`, `LEGAL_APPROVED`, `OPERATIONS_APPROVED`, and `LAUNCH_ENABLED` remain outstanding. |
| Next planned slice | Convergence 02 — Universal composer |

Next planned production slice: **Convergence 02 — Universal composer**.

Readiness vocabulary is fixed to `DESIGNED`, `CODE_COMPLETE`, `UNIT_TESTED`,
`REAL_POSTGRES_PROVEN`, `BROWSER_PROVEN`, `STAGING_PROVEN`, `PROVIDER_APPROVED`,
`LEGAL_APPROVED`, `OPERATIONS_APPROVED`, and `LAUNCH_ENABLED`. “Accepted” describes a
design decision; it never means implemented, tested, approved, enabled, or launch-ready.

Merged Convergence 01 has one deterministic recipient-KYC policy resolver for global mode, active
account override, product, normalized jurisdiction, and active risk evidence; `risk_based` remains
non-universal, global `required` cannot be weakened by an exemption, and every decision includes its
reason, version, and effective/expiry evidence. Creator capability/onboarding/dashboard, one-time
payment, Profile Membership, and recurring-collection paths consume that authority and snapshot or
re-evaluate the decision as appropriate. One indexed viewer-relative SQL authority now gates feed,
detail, Discover/search/hashtags, profile media, share, unlock, and engagement reads without per-item
application loops. Ranking mode is only For You/Following; one persisted Both/Safe only/Adult only
preference drives Home, Bits, Settings, Discover, search, hashtags, and profile media. Safe/Adult/
Explicit creation remains one resumable draft lifecycle: Adult/Explicit upload and editing are allowed
before contextual adult-publisher verification, while final publication rechecks that independent
capability and never forces creator KYC or earnings. Migration `0108` rollback/reapply, 479 unit tests,
five real-Postgres journeys, production build/typecheck/lint/docs/deploy checks, and 25 desktop plus 25
mobile Chromium journeys are green locally. Firefox and clean-runner coverage remain protected-PR CI
gates. No provider API behavior changed; provider/staging gates remain unchanged. PR #86 merged as
`b5e1904`; exact-main CI `32399020903`, database `32399021003`, security `32399020923`, and release
artifact `32400011806` are green. Staging convergence `32400705957` verified the immutable artifact,
then failed closed at the recorded shared staging/provider/operations/legal configuration gate.

PR #85 merged at `5889b39`. Exact-main CI run `32352695267`, database-migration run `32352695320`,
security run `32352695299`, and immutable release-artifact run `32353578799` are green. Staging run
`32354283844` verified that exact manifest and its attestations, then failed closed before deployment
or migration on the recorded shared staging/provider/operations/legal configuration groups.

The merged entry slice server-resolves login/onboarding state, presents one immediate primary
`Connect wallet` action, preserves the first click while the wallet runtime loads, keeps the
configured embedded-wallet provider as a quiet secondary action, and confines Supabase email
or social identity to Settings recovery. Full web typecheck, focused unit/lint/docs/build checks,
fresh canonical migration application, API/web health, server-rendered response checks, and nine
production-preview Chromium entry/accessibility/PWA journeys are green. Pull-request clean-runner
and protected main CI are green; real wallet/provider evidence remains a pre-production staging gate.

The merged media release-evidence slice closes the remaining gap between normalized scan storage
and release authority. Direct Bunny Stream TUS stays unproven for Shield coverage, so production
approval must require complete normalized malware, known-hash, container-integrity, classification,
and human-review evidence rather than treating provider playability or a staff click as scan proof.
Migration `0106` enforces that predicate per selected media asset in Postgres, admin approval binds
the human evidence and public playback projection to that exact asset in the same transaction,
worker outcomes preserve each valid adverse signal even if a companion is malformed, and known-hash
matches immediately remove published media from public access and open a reporting-review workflow
without automatic user sanctions. Staging additionally
requires live Shield configuration proof and a release-bound direct-TUS coverage/fixture receipt.

The merged Launch 02B slice removes the last legacy identity lookup from the entry, app-access,
age, wallet, profile, and Enable Earnings journey. Those paths must accept the canonical
`users.id` resolved by the opaque application session and remain functional when the transitional
`users.supabase_user_id` value is null. Migration `0107` prevents that compatibility column from
ever containing a provider subject or a different user identifier while unrelated repositories are
migrated in later bounded slices. Supabase recovery subjects remain exclusively owned by
`user_provider_identities`. The full workspace check, fresh-chain migration plus real-Postgres API
integration, desktop/mobile Chromium, desktop Firefox, accessibility, PWA, and visible-browser
entry proofs are green. Real provider acceptance remains a pre-production gate.

The current green `main` merge at `2e9f40e` passed protected CI run `32345418645`, isolated
Postgres integration, database migration checks, security analysis, build, and the full Chromium,
Firefox, and WebKit browser smoke matrix. Release-artifact run `32346177861` built and attested the
web, API, and worker images and emitted the immutable manifest for that exact source. Staging
convergence run `32346806456` then verified the manifest and attestations and failed closed at its
configuration gate because the recorded shared staging/provider/legal values remain absent; no
deployment or migration was attempted. PR #84 additionally moved creator publication and moderation-
appeal state changes onto the shared Postgres transaction boundary. The reviewed maintenance queue also merged CI budget
hardening (PR #78), `jose` 6.2.9 (PR #74), Zustand 5.0.15 (PR #76), and Next.js 16.3.1
(PR #77). The isolated `@solana-program/system` 0.13.0 upgrade (PR #75) was rejected because it
requires `@solana/kit` 7 while the web provider boundary intentionally remains on Kit 6.10; that
change may return only as a coordinated provider migration.

The last fully attested release-evidence baseline at `4860133` passed protected CI, isolated
Postgres integration, database migration checks, security analysis, build, and full browser smoke. Release-artifact run
`32043723824` then built and attested the web, API, and worker images and emitted the immutable
manifest for that exact source. Staging-convergence run `32044089602` verified the manifest and
attestations, then failed closed before deployment because the shared staging/provider/legal
configuration groups listed above are absent. No staging migration, webhook change, or production
promotion was attempted.

These human/provider gates now block the active pre-production convergence slice: shared staging
credentials, provider dashboard/webhook/domain configuration, migration `0091` shared-project
proof, production hosting/DNS approval, mainnet wallet approval, and unsettled legal/compliance
decisions. Independent product slices were allowed to reach `CODE_COMPLETE_PROVIDER_BLOCKED`
while their production paths remained explicit and fail-closed; the core platform is now at the
dedicated convergence gate and cannot advance to a release candidate without this evidence.

Launch 09 local acceptance now includes migration `0099`, audited/idempotent organization
provisioning, explicit owner/team/creator consent, normalized organization-KYB authorization,
independent Enterprise entitlement, versioned managed-creator agreements, ownership-proven
settlement-wallet resolution, exact creator/management basis-point allocation, historical
confirmed-allocation reporting, prospective termination, admin operations counts, and Studio
management UI. Migration `0099` was applied to local Supabase/Postgres and passed rollback/reapply
proof; the real-Postgres journey and desktop/mobile production-preview browser proof are green.
Real KYB callbacks, approved commercial evidence, and Solana devnet allocation settlement remain
`CODE_COMPLETE_PROVIDER_BLOCKED` pre-production gates.

Launch 10 local acceptance now includes an immediate primary external-wallet entry, a quiet configured
secure-wallet secondary action with provider implementation copy removed, wallet/payment SDKs deferred to their interaction boundaries, a single keyboard-addressable
main region, corrected light/dark contrast and form labels, reduced-motion behavior, a privacy-safe
network-first offline fallback, install-grade manifest/icons, and representative authenticated Axe scans.
The Node 22 production-preview matrix passed 49 desktop/mobile Chromium tests and 24 Firefox tests;
Firefox intentionally skips the Chromium-only service-worker-control assertion. Playwright 1.60 cannot
run WebKit on the local macOS 12 host, so desktop/mobile WebKit remains a required Linux CI and real-device
staging gate rather than fabricated local evidence.

Launch 11 local acceptance now includes runtime-neutral public web configuration, self-hosted fonts,
non-root web/API/worker OCI targets, exact-source release manifests and attestations, build-once staging
and production promotion workflows, API/worker OpenTelemetry bootstrap, privacy-safe Web Vitals intake,
synthetic and bounded-load probes, strict configuration and evidence orchestration, executable database and
Storage-object restore parity proofs, and recovery/legal/incident runbooks. The production-mode wallet-first
entry was verified manually at desktop and 390px mobile widths. Playwright passed 77 of 78 applicable
desktop Chromium, desktop Firefox, and mobile Chromium checks; the remaining Firefox service-worker case
is intentionally Chromium-only. A real local Supabase/Postgres integration run passed four journeys; a
logical backup restored 147 public tables into a disposable Supabase-compatible target with critical and
non-empty row-count parity. The Storage proof validates exact relative object paths, byte counts, and SHA-256
content without logging object names. Synthetic readiness passed, and a 100-request/10-concurrency liveness probe
completed with zero failures and 60.6ms p95 after infrastructure probes were isolated from user rate-limit
budgets. The strict staging doctor and independent proof runner return non-zero for absent configuration,
unsafe flags, failed commands, missing evidence receipts, or release-digest mismatch. Hosting/OIDC, shared
staging credentials, immutable staging deployment evidence, real provider dashboards, OTLP destinations and
alert routing, real database/Storage restore receipts, counsel approval, and explicit production approval remain
pre-production gates.

## Launch Baseline And Architecture Lock

- Audited merged base: `origin/main` at `9081bd0f4fb8433e1f63422fd294ba8601c851b2` after squash-merged Launch 01 PR #42.
- Planning baseline: architecture 88%, database/security 93%, backend 82%, frontend about 50%, feature completeness about 65%, and public production readiness about 58%. These are planning estimates, not launch claims.
- Canonical owners remain `apps/web`, `apps/api`, `apps/worker`, `packages/database`, `packages/contracts`, `packages/config`, and `packages/ui`. No second backend, database, auth authority, payment authority, moderation system, contract system, or design system may be introduced.
- The universal-account model remains locked. Age access, adult-publisher eligibility, performer eligibility, creator earnings eligibility, KYC, KYB, Enterprise management, and admin authority are independent backend-owned capabilities.
- Locked target: three visible onboarding steps only: (1) Account + Wallet, (2) Minimal Profile, and (3) Age Verification. Step 1 ends with either an external Solana wallet or a Privy embedded Solana wallet. Both sign the same backend challenge and converge on one canonical application session. Supabase signup is optional recovery/linking and is not a fourth onboarding step.
- Locked identity relation: one WeVid user has one profile, one or more linked wallets with one primary wallet, and optional Supabase recovery identity, verification records, earning readiness, performer records, and organization memberships. Privy is wallet/authentication UX; the signed embedded wallet is the WeVid credential and no separate Privy subject authority is claimed. Recovery-subject collisions fail closed; matching email alone never authorizes an account merge.
- Privy is the only embedded-wallet launch runtime. Turnkey is not an active runtime or contract value. Native creator commerce is deferred and WeVid-owned: Product Offers plus lightweight Orders/Fulfillment reuse the existing identity, wallet, payment-intent, exact-split, settlement-verification, receipt, dispute, notification, and audit authorities. No full commerce engine is canonical. Slice 06 may add only exact-pinned `@solana-commerce/solana-pay` behind a narrow adapter; it is not installed in Launch 01.
- Launch 06 exact-pins the selected Commerce Kit Solana Pay package behind a narrow known-defect codec and converges Support, content unlock, paid message, Event Access, and paid-live purchase surfaces onto one shared review/consent/wallet/submitted/backend-confirmed checkout. Commerce Kit supplies query encoding and SVG QR presentation only; WeVid still owns intents, transaction composition, splits, settlement verification, receipts, and domain outcomes.
- Launch 06 local acceptance evidence includes the complete repository gate, migration `0001` through `0096` on isolated Postgres with `0096` rollback/reapply proof, two repeatable real-Postgres API integration runs, and 36 desktop/mobile browser journeys. Real Solana devnet wallet/RPC settlement, provider-domain wallet behavior, and approved KYC/tax policy evidence remain pre-production staging gates; the corresponding paths stay fail-closed until configured and proven.
- Git uses protected `main` plus short-lived slice branches. Pull requests produce preview preflight; merged `main` is the staging source; an approved immutable release artifact is promoted to production. Staging and production credentials, databases, providers, wallets, and observability remain isolated.

## Readiness Truth

| Area | Verified state | Launch blocker |
| --- | --- | --- |
| Architecture and data authority | Substantial and implemented through migration `0102`; server authority, RLS, idempotency, and provider adapters are present. | Shared staging migration and identity/session/provider proof still require isolated Supabase staging evidence. |
| Auth, wallet, age, and profile | Canonical opaque application sessions, explicit recovery exchange, read-only session GET, three-step onboarding, minimal handle profile, provisional privacy, age activation, multi-device session scope, and fail-closed provider boundaries are merged. | Privy and age-provider real staging evidence and distributed Redis environment proof remain absent. |
| One-time payments and access | Backend-owned SOL and supported one-time USDC intent, settlement, receipt, and entitlement paths exist. | Mainnet/provider evidence, operational reconciliation, and full consumer journey proof remain required. |
| Media and live | Bunny/Livepeer boundaries and quarantine/release authorities exist. | Automated moderation is not launch-approved; adult live is disabled; provider staging evidence is absent. |
| Recurring subscriptions | Official recurring-delegation transaction construction and verification, first-payment activation, exact-split worker collection, renewal/grace/revocation handling, cancellation, creator membership offers, consumer Join UX, admin readiness, and staging proof tooling are implemented locally. | Sales remain disabled until the official on-chain program, collector signer, supported mint, devnet authorization/collection signatures, and provider dashboard evidence are configured and proven. |
| Frontend | The public entry presents direct external-wallet connection plus a quiet embedded-wallet option, provider SDKs load at narrow interaction boundaries, the unified app shell and product workspaces are responsive, automated WCAG 2.2 A/AA blocking findings are clear on representative routes, and the privacy-safe install/offline contract is implemented. | Linux CI WebKit plus real target-device wallet/provider, push, installed-iOS, manual screen-reader/zoom, and staging Web Vitals evidence remain required. |
| Delivery and operations | Runtime-neutral non-root OCI targets, post-green-main attestations, exact-source manifests, build-once exact-artifact promotion workflows, OTLP bootstrap, synthetic/load tools, and database logical-recovery proof are implemented locally. | Hosting/OIDC remains unselected; shared staging credentials, provider dashboards/webhooks, immutable staging artifact evidence, OTLP destinations/alerts, Storage object backup, legal approval, and explicit production approval remain required. |

## Unsafe Capability Flags

- `AGE_VERIFICATION_ALLOW_MOCK_PROVIDER=false` outside local/test.
- `MEDIA_MODERATION_MODE=disabled_fail_closed` until real adapter and review evidence justify `launch_approved`.
- `LIVEPEER_ADULT_LIVE_ENABLED=false` until Slice 12 is independently approved.
- `SUBSCRIPTIONS_ENABLED=false` until recurring collection and verification pass Slice 08.
- `NEXT_PUBLIC_EMBEDDED_WALLET_RUNTIME_ENABLED=false` until the selected noncustodial provider passes target-domain/device staging proof.
- `API_RATE_LIMIT_STORE_DRIVER=process_memory` is local/test only. The production entrypoint and deploy gate require the implemented Redis adapter plus `API_RATE_LIMIT_REDIS_URL`; Redis errors fail closed. An injected external store remains available only to composed/test runtimes and is not accepted by the production preflight.

## Brand Compatibility Boundary

Public product copy and API metadata use WeVid and Support. Technical package scopes, `VEEL_*` test-tool env names, `VEEL-` historical receipt identifiers, the legacy `X-Veel-Webhook-Signature` compatibility header, migration history, and the existing `/video/Veel.mp4` asset path remain unchanged to avoid a destructive rename. Historical `tip` records are normalized to Support on active reads; deeper compatibility cleanup belongs to the monetisation slice.

## Slice Ownership For Remaining Onboarding Work

| Classification | Exact owner | Slice |
| --- | --- | --- |
| IMPLEMENTED LOCALLY | Canonical identity/session mapping, opaque-cookie authority, collision rules, shared recent-auth, OpenAPI-derived runtime request validation, Redis-compatible limiter boundary, three-step UI, provisional profile restrictions, and optional Supabase recovery exchange | 01 |
| BLOCKED ON STAGING | Continuous Privy authenticate/create-or-retrieve/sign/session proof and real age/recovery provider return evidence on approved target domains/devices | Launch gate |
| FAIL-CLOSED | Privy runtime, age providers, and recovery linking without complete provider/domain evidence | Current flags and server checks remain disabled/rejecting |
| DEFERRED | Enterprise, expanded Mutuals, WeVid-native physical Product Offers/Orders/Fulfillment, adult live, full AI/MCP, NFT/transferable passes, resale, and custom contracts | 09+, separately gated, or post-core |

## Implemented And Real

- Monorepo, pnpm workspace, CI/security workflow, docs checks, lint/typecheck/test/smoke scripts, GStack gates, and gitleaks local gate.
- Toolchain versioning is explicit through `.node-version`, `.nvmrc`, `packageManager`, and `engines`: Node.js `22.16.0`, pnpm `10.0.0`, Corepack activation, `pnpm bootstrap`, `pnpm run doctor`, and `pnpm check`. The canonical CI proof job is `pinned-toolchain-proof`.
- The production dependency graph no longer includes the unused `@solana/wallet-adapter-wallets` umbrella package or pnpm-auto-installed React Native/Metro peers. Next.js is pinned to `16.3.1`, Playwright is pinned to `1.62.1`, Fastify is pinned to `5.12.0`, `jose` is pinned to `6.2.9`, and Zustand resolves to `5.0.15`; required Solana codec/Stripe peers are explicit exact service dependencies, patched `axios`/`ws` resolutions are enforced, and UUID 8–10 consumers resolve to patched `uuid@11.1.1`. Supported queued upgrades were reapplied individually after official review: `pnpm/action-setup@v6` in PR #36, ESLint 10 in PR #37, `@fastify/rate-limit` 11 in PR #38, `fastify-raw-body` 6 in PR #39, `globals` 17 in PR #40, Supabase CLI in PR #58, Fastify in PR #60, Playwright in PR #59, Privy in PR #61, `jose` in PR #74, Zustand in PR #76, and Next.js in PR #77. PR #41 was rejected because it changed only one Rolldown native binding while the runtime and every other binding remained 1.0.3; PR #75 was rejected because it would have installed `@solana-program/system` against an unsupported `@solana/kit` major. `pnpm deps:check` guards both the vulnerable-resolution policy and exact Rolldown runtime/native-binding alignment. The current `pnpm audit --prod` reports one high advisory: unpatched `bigint-buffer` through official Solana SPL tooling; no critical, moderate, low, or informational advisory is reported. Exact reachability, mitigations, artifact evidence, ownership, review date, and production gate are recorded in [Production dependency security status](dependency-security-status.md).
- Privy `3.37.1` declares `@farcaster/mini-app-solana` as an optional peer and dynamically imports it only after its own Farcaster-environment detection. WeVid has no Farcaster login, query, referrer, or mini-app configuration and does not install or alias that peer; normal Privy email/social/passkey plus Solana wallet creation/signing does not execute the branch. Next webpack and Turbopack now narrowly ignore only that expected optional-import diagnostic inside Privy while every other missing module remains visible. Privy's official Solana peer packages are explicit exact web dependencies compatible with the pinned `@solana/kit` major. Owner: identity-provider dependency review. Review date: 2026-09-15. Removal condition: remove the narrow ignore when Privy publishes a compatible bundler-clean optional import, or install and stage-prove the peer only if Farcaster becomes an approved product surface.
- OpenAPI, route map, and Fastify route registration are checked for route drift. The canonical follow endpoints are present only with their migration, repository, abuse/idempotency controls, feed impact, and real-Postgres/browser proof; no contract-only current-viewer alias is restored because the session endpoint remains that boundary.
- Fastify API bootstrap with route registration, dependency construction, shared app-level Postgres client construction, close-hook lifecycle, env validation, raw-body support for signed webhooks, global rate limit, OpenAPI plugin, and Supabase boundary plugin.
- Shared backend helpers now cover the app-level Postgres client, explicit transaction boundary, common Idempotency-Key parsing/validation, stable idempotency request hashing, route-specific mutation rate-limit presets, and the first admin mutation route-policy guard for migrated route utilities.
- Content draft creation now keeps its actor/action/request-hash receipt for the lifetime of the logical operation. Migration `0100` upgrades existing `content.create` receipts to PostgreSQL `infinity`; exact retries return the original draft, changed-input key reuse returns `409`, and draft quota is consumed only once.
- One-time payment atomic values now stay lossless at every number-based boundary. The public contract and intent schema cap values at `Number.MAX_SAFE_INTEGER`; split calculation uses `bigint`; transaction construction rejects unsafe or inconsistent expected splits; verification fails closed before provider I/O; and migration `0101` independently constrains canonical settlement-ledger entries.
- Protected-mutation idempotency is now classified by the lifetime of the underlying operation. Durable domain mutations keep entity- or receipt-backed keys without expiry; checkout consent joins content draft creation in retaining its generic actor/action/request-hash receipt at PostgreSQL `infinity`. Finite retention remains only for intrinsically bounded auth/wallet challenges, capabilities, payment/subscription windows, and seven-day feed-impression observations. Migration `0102` promotes existing `payment_checkout_consent` receipts; exact retries remain accepted and return current canonical intent state, while changed-input reuse returns `409`.
- Root Supabase CLI project is initialized with committed `supabase/config.toml`, repo-local Supabase CLI pinned to `2.113.0`, and `supabase/migrations` linked to the canonical `packages/database/migrations` SQL files. Local/CI startup runs through the repository wrapper, which constructs an ephemeral workdir containing forward migrations only; canonical `*.down.sql` rollback files are never presented to the Supabase migration runner. Repository history now includes migrations through `0102`; migrations `0100` through `0102` were applied against the isolated local Postgres stack with rollback/reapply proof. `0100` also passed expired-receipt promotion and cleanup proof; `0101` accepted the exact safe maximum and rejected the first unsafe integer; `0102` promoted an expired checkout-consent receipt to lifetime retention and restored its former bounded value during rollback. The shared-project migration history and pending staging applications remain release blockers and must use approved migration procedures. Generic application `DATABASE_URL` is never used by remote migration commands.
- Opaque application-session verification boundary, explicit Supabase recovery verification/exchange, web recovery confirmation route, minimal profile mutation UI, external wallet challenge handoff UI, configured-session redirects, backend app-access redirects for protected app-shell pages, and backend session/profile readiness projections. Ordinary API transports send only the HttpOnly application cookie; browser Supabase credentials are confined to recovery exchange. Service-role and secret keys stay server-side.
- Age provider waterfall boundary, `/age` provider-session start UI, and normalized webhook/test paths, with unavailable providers failing closed when not configured. Local/test-only mock age and creator verification adapters exist behind explicit mock guards for end-to-end development; production provider paths still require real provider credentials, webhook secrets, callback allowlists, and provider dashboard configuration.
- External wallet challenge/link/revoke/status flow with backend signature verification and replay/expiry checks; landing onboarding and `/app/wallet` can now coordinate Solana wallet-adapter challenge signing while keeping wallet truth server-side. The landing wallet chooser filters to intentionally supported Solana wallet surfaces and the Privy embedded-wallet action is absent unless its runtime env is configured; onramp provider boundary fails closed unless configured.
- Home feed, content read model, media access projection, `/create` backend draft/upload-session handoff with persisted media asset id, TUS upload progress/pause/resume, creator-triggered provider status sync, Bunny/Livepeer provider status boundaries, and provider webhook normalization tests.
- Launch 04 adds the canonical follow graph, projected social/engagement counts, durable command and impression receipts, server-owned deterministic Home/Bits ranking, opaque frozen compound cursors, real mixed/vertical web feeds, active-item-only playback, keyboard-operable feed tabs, follow/profile integration, and desktop/mobile browser proof. Migration `0094` is reversible, indexes every new foreign-key access path, relocates `pgcrypto` from exposed `public` to `extensions`, and produces a clean local Supabase security/performance advisor result; the representative eligibility query completed its local `EXPLAIN (ANALYZE, BUFFERS)` proof in under one millisecond on the test dataset.
- Provider media readiness only updates playback/readiness projection; moderation approval and public access remain separate backend/admin-owned truth.
- Media safety has one canonical release authority through migrations `0088` and `0089`: uploader declarations, reusable verified performer subjects, content-scoped consent, quarantine/review cases, minimized provider-signal records, appeals/reporting workflow records, durable moderation jobs, release-enforcement triggers, and admin queue health/dead-letter retry visibility. The worker fails closed to human review until the exact provider path is staging-approved.
- Native SOL and one-time USDC payment intents, noncustodial creator split settlement facts, explicit exact-version checkout consent before capability/signature acceptance, short-lived capability-token Solana Pay checkout, exact-pinned Commerce Kit query/SVG-QR interoperability, server-composed unsigned split transaction, submitted-signature capture, exact backend settlement verification at configured finality, shared transaction boundaries for payment submission settlement and Event Access inventory reservation/issuance, content unlock entitlement grant after confirmed settlement, and one shared browser checkout for Support, content unlock, paid live, Event Access Pass, and paid messages.
- Payment intents store withdrawal-waiver and terms evidence only after an explicit authenticated consent action. Migration `0096` removes the historical automatic timestamp default, marks legacy confirmation payload evidence for review, cancels in-flight waiver-required intents that cannot prove consent, and adds a database transition guard so settlement cannot create new confirmed access with missing consent.
- Confirmed payment settlement now writes durable receipt, receipt line, compliance-ledger, in-app confirmation delivery, pending email-provider delivery, notification, and audit evidence in the same backend transaction used for entitlement/product settlement.
- Activity payment projections and `/app/activity` now expose backend-derived receipt/confirmation/withdrawal-review state and a real refund/access-issue review request form for exceptions. This is review-state only: no automatic refund, custody, balance, payout queue, or access revocation is executed from the user surface.
- Admin refund/dispute resolution now supports idempotent evidence-only remediation records for creator refund attestations, replacement access, access revocation, technical remediation, and no-refund denials. The evidence table is RLS-protected, audited through the admin mutation, tied to the payment intent, and constrained to `evidence_only_no_platform_custody_no_payout_queue`.
- Canonical Support with historical `tip` read/settlement compatibility, referral attribution/commission projection, correctly formatted asset amounts, activity/payment/wallet transaction projections, and an idempotent Enable Earnings mutation that validates a user-owned chain-specific recipient wallet, exact Creator Earnings Terms, policy-driven KYC/tax/age/profile readiness, product selection, safe replay, and audit without balances or withdrawal language.
- SFW live rooms now include public/profile-member/paid-event modes, DB-first reservation plus a single atomic provider-creation claim, exact SFW attestation, canonical continuous-monitoring jobs, moderation multistream configuration, masked and recent-auth one-response OBS reveal, separate short-lived player JWT, idempotent atomic chat, creator end, action-specific staff suspend/resume, and separately quarantined replay content. The create page, private host workspace, viewer player/chat/Support/Share/Report surface, and admin safety control consume those backend authorities. Adult live remains disabled and real Livepeer staging proof remains a pre-production gate.
- Auto-renewing platform plans and creator Profile Memberships use backend-owned product/access truth plus official Solana recurring-delegation primitives. The browser presents one Join action, signs the backend-built authorization transaction, and submits only the signature; it never accepts user-entered PDA, authority, mint, collector, or amount facts. The worker activates access only after the first finalized exact-split collection, then owns renewal, grace, cancellation, revocation detection, and retry. Creator offer setup reuses Enable Earnings readiness and one deterministic offer per creator. `pnpm proof:subscriptions` is the dedicated staging proof and currently reports `CODE_COMPLETE_PROVIDER_BLOCKED` until the collector secret and devnet proof signatures are provided.
- Remote MCP exposes OAuth protected-resource metadata, authorization-server metadata, authorization-code plus PKCE endpoints, revocation, consent approval, resource-bound bearer tokens, scoped tool allowlists, redacted audit rows, and staging proof scripts: `pnpm mcp:seed`, `pnpm mcp:oauth:pkce`, and `pnpm mcp:smoke`. The canonical runbook is `mcp-staging-proof.md`.
- Frontend smoke coverage covers desktop/mobile app shell, onboarding, age, content, create, discover, messages, activity, wallet, creator dashboard, subscriptions, Studio/org, settings, admin, live, Event Access, Mutuals, and assistant projections. Authenticated happy-path smoke covers `landing onboarding -> profile -> wallet -> age -> home -> create -> unlock` against a local mock API; launch authentication now uses the opaque application cookie, with bearer transport reserved for explicit test harnesses and recovery exchange.
- Frontend app-shell parity now uses the checked-in mockups and logo assets as the visual source for the primary web shell. The public `/` route is an onboarding-aware landing surface, while canonical protected app routes live under `/app/*` (`/app/home`, `/app/bits`, `/app/create`, `/app/messages`, `/app/profile`, and secondary workspaces). The app shell is fixed to one viewport with internal scroll panes, desktop rail, mobile dock, persisted light/dark mode, and subtle accent/noise treatment on primary actions. Shared web state components map API failures to safe auth/forbidden/not-found/validation/conflict/rate-limit/service/network states, so signed-out and protected data surfaces do not expose raw bearer-token or `HTTP <status>` backend messages to users. Content playback uses provider-owned rendering boundaries: Bunny Stream via backend-issued embed iframe URLs and official Player.js lifecycle events, and Livepeer via official `@livepeer/react/player` primitives. Qualifying free public VOD/live playback reports ordered idempotent usage heartbeats; the backend remains allowance authority.
- Real authenticated API integration coverage exercises wallet -> age -> profile -> exact-replay/conflict-safe Enable Earnings -> lifetime-replay/conflict-safe content create -> public-media playback accounting -> lifetime-replay/conflict-safe checkout consent -> confirmed settlement -> entitlement-backed unlock -> idempotent refund/dispute request -> concurrent capacity-one Event Access reservation with one cancelled orphan -> consented settlement -> access-pass activity -> paid message -> paid live -> signed playback/chat -> server-built subscription authorization transaction -> signature-only verification -> first-payment activation -> renewal collection -> provider replay against a configured Postgres/Supabase test database through Fastify routes, worker repositories, and Postgres repositories. It proves duplicate content-create delivery returns one draft with an infinite receipt, checkout-consent delivery retains an infinite receipt and rejects changed evidence, duplicate playback-heartbeat delivery is credited once, creator readiness cannot bypass current earnings terms, settlement cannot transition without explicit checkout consent, free and paid pass issuance read fresh post-lock snapshots, invalid signatures do not extend scarce inventory, recurring access does not activate from wallet authorization alone, paid-but-undeliverable Event Access creates an audited internal support case instead of silently claiming delivery, and a queued Bunny delivery re-applies the sanitized payload to the real media asset through the canonical repository while preserving the external delivery ID and internal event-row ID as separate authorities. The test uses real external-wallet Ed25519 signatures, a signed Sumsub-style age webhook, backend-created mutations, confirmed and rejected settlement-verifier boundaries, entitlement/access-pass/message/live room/subscription read-projection assertions, exact-split worker collection/replay outcome assertions, deterministic cleanup, and an explicit remote-DB guard. Run it with `VEEL_ALLOW_REMOTE_API_INTEGRATION_TESTS=1 pnpm test:integration:api` when the root `.env` points at the intended non-production test database.

## Fail-Closed Or Not Production-Ready

- Bunny provider-event recovery reconciles current provider playback data and restores the usable playback URL before a replay request can succeed; normalized `ready` evidence alone is insufficient.
- Solana provider-event recovery uses a state-and-signature compare-and-set guard at the payment write boundary, so concurrent normal evidence cannot be overwritten by stale replay work.
- Direct Bunny and Livepeer freshness uses a Postgres-owned pre-read cutoff, keeping direct observations and webhook receipts in one clock domain and conservatively deferring to deliveries received during or after a provider read.
- Real provider credentials, webhook endpoints, staging accounts, sandbox smoke tests, and production keys are intentionally placeholders until manually configured.
- Landing owns the three-step login/onboarding story and coordinates Privy or external Solana wallet challenge signing through backend-owned wallet endpoints. Supabase magic-link/OAuth UI appears only in Settings recovery and its callback exchanges a verified subject for the canonical WeVid session. Protected pages trust only the canonical application cookie (or explicit E2E harness token), then redirect incomplete backend `appAccessState` to onboarding or age remediation; a Supabase browser session alone never authorizes ordinary API access.
- The external Solana wallet runtime loads when the landing login/onboarding frame opens, so the primary Connect wallet choice opens its chooser directly. Privy remains unmounted until the configured secure-wallet action is chosen; that first click lazy-loads the official SDK and automatically opens its account flow without a second WeVid click. The runtime explicitly selects the Privy Solana wallet before signing, while external wallets remain owned by Solana Wallet Adapter. The authenticated app mounts both runtimes for wallet operations and provider logout. Profile logout uses official Privy logout, Solana disconnect, Supabase local sign-out, app wallet-session cleanup, and server cookie expiry before replacing the location with `/`.
- Landing login and onboarding stay locked to their GSAP story frame while provider runtimes initialize or wallet UI takes focus, with desktop and mobile smoke coverage preventing outer-story scroll drift.
- Age session creation has real backend HTTP adapters for Yoti, Persona, Veriff, and Sumsub behind the provider waterfall, with unconfigured providers failing closed. Didit V3 owns separate contextual creator-verification purposes, including signed and replay-safe webhook ingestion and documentary/liveness/face-match evidence; ordinary onboarding requests only over-18 access and contains no adult-publisher intent. Launch readiness still requires configured provider sandbox credentials, public callback/webhook proof, provider-contract and retention approval, and admin evidence review.
- Embedded wallet provider remains a boundary until a launch-approved noncustodial provider is configured and tested.
- Payment settlement is native SOL devnet first with server-composed creator split transactions for one-time creator monetization and a supported one-time USDC path. Recurring subscriptions are token-based only and fail closed without official Solana subscription/delegation verification; native SOL recurring subscriptions and real transactional email domain/API-key configuration plus staging deliverability smoke for withdrawal-waiver confirmations still need launch-scope completion. Provider replay now has canonical Bunny, Livepeer, and exact Helius/Solana side-effect recovery, database-sequenced newest-delivery guards plus direct-provider-observation precedence against stale VOD or live changes in either direction, already-applied side-effect no-ops, originating Solana provider-alias preservation, signature-bound intent priority with exact stored-signature matching for submitted and confirmed states, tokenized retry/dead-letter behavior, redacted admin visibility, and audited requeue. Live provider event receipt/application remains transactionally retryable on redelivery and retains normalized replay facts for operator recovery.
- Launch 04 follow/unfollow, projected counts, feed/profile viewer state, durable command/impression receipts, and deterministic Home/Bits ranking are merged. Follow stays social-only; blocks suppress/deactivate edges; purchases and money never affect people/feed ranking. Protected CI, isolated Postgres, review, and desktop/mobile browser proof passed on PR #45.
- Subscription renewals are implemented as auto-renewing backend/worker collections, but production collection remains fail-closed pending official program configuration, authority/delegation proof, launch-approved token plans, collector signing support, and the dedicated staging evidence command.
- Remote MCP production connector compatibility still requires public HTTPS staging deployment, exact redirect URI allowlists for each real client, MCP Inspector proof, Claude Code proof, Claude custom connector proof, OpenAI-compatible proof, revocation proof, and audit-row confirmation against the deployed database.
- Media creation has backend draft, admin-tunable draft/upload abuse policy enforcement with safe defaults, metadata/preview update, Event Access draft linking, persisted upload-session handoff, TUS browser upload/resume wiring, provider-status sync UI, entitlement-aware content playback rendering, explicit publish submission, and a separate `publish_state`.
- Launch 03A adds a preview-first SFW-only Create journey, required people/rights declaration, one-action draft-and-upload handoff, paginated owner publication/review workspace, uploader-safe request-changes/rejection reasons, request-bound replay-safe appeals, transactional appeal closure/restoration, and an explicit public-profile `publish_state = 'published'` guard. Representation-only edits to existing adult content re-check adult-publisher capability across every editable state. Code and real local Postgres proof are complete; Bunny staging and launch-approved classifier/hash evidence remain the provider gate.
- Launch 10 has converged the public entry, app shell, representative product workspaces, accessibility baseline, cross-browser smoke matrix, and PWA/offline contract. Final provider-backed visual journeys, manual assistive-technology/zoom checks, target-device iOS install/push behavior, and performance evidence belong to pre-production staging convergence.
- Admin dashboard is substantial; organization KYB/member, support policy/case, moderation/report, refund/dispute, data-request, and feature-flag mutations now share the admin mutation route-policy/idempotency/rate-limit guard, but final role matrix coverage and removal of any remaining compatibility aliases after migrations and clients are updated still remain.
- Launch 11 now has runtime-neutral public web configuration, a secret-excluding multi-target non-root OCI build, post-green-main GHCR publication and GitHub attestations, an immutable source/contract/migration/image manifest, exact-manifest staging and manual production promotion gates, shared API/worker OTLP bootstrap, privacy-minimized Web Vitals ingestion, synthetic and bounded-load checks, logical database restore proof, exact Storage-object restore parity proof, strict independent staging evidence orchestration, expanded redaction, and incident/rollback/legal runbooks. The workflows intentionally refuse to claim deployment until a hosting target and official OIDC adapter are selected. Shared staging credentials, provider dashboards/webhooks/domains, real provider journeys, collector/dashboard/alert destinations, real database/Storage restore receipts, final counsel-approved legal documents, production DNS/secrets, and explicit production approval remain `CODE_COMPLETE_PROVIDER_BLOCKED` external gates.
- Local macOS Vitest/Vite execution is covered by optional `rolldown` Darwin native bindings and `pnpm run doctor`, which resolves the pinned Node.js/Corepack toolchain even when the interactive shell points at an older Node. Tests must still run locally and in the pinned Linux CI proof before provider or frontend slices are considered validated.

## P0 Before Broad Expansion

1. Continue migrating money/access/admin/safety mutations onto the shared Postgres transaction helper slice by slice; payment intent creation and checkout consent, payment submission settlement, refund/dispute request creation, Event Access inventory reservation/issuance, admin payment commercial-policy overrides, admin content-moderation/report-review state transitions, and creator publication/appeal safety transitions are already on the shared boundary.
2. Continue migrating route modules onto shared idempotency helpers, route-policy/RBAC, route-specific rate-limit presets, and test factory helpers. The first admin mutation routes are migrated; money/access/safety routes still need slice-by-slice adoption and durable generic idempotency conflict behavior where route-specific stores are insufficient.
3. Obtain Bunny Shield direct-Stream-TUS and Livepeer moderation/suspension staging evidence. Until then moderation remains fail closed and adult live remains disabled.
4. Run live sandbox proof for one launch-approved age provider and for the separate Didit creator/adult-publisher identity workflows. Code, signed webhook handling, replay protection, capability projection, and the onboarding shortcut are wired; provider credentials, workflow IDs, callbacks, retention approval, and operational evidence remain launch blockers.
5. Harden Solana subscription/allowance verification for platform plans and creator memberships; one-time creator split settlement is now the baseline for creator monetization payments.
6. Complete remote MCP staging proof with MCP Inspector, Claude Code, Claude custom connector, and OpenAI-compatible clients against a public HTTPS staging URL before claiming external connector compatibility.
7. Continue deployment hardening beyond the skeleton: artifact digest pinning, provider staging smoke, backup/snapshot verification, alert routing, and real hosting/OIDC integration.

## Production Hardening Backlog

The controlling branch evidence is recorded in `production-branch-inventory.md`. Work is executed in coherent reviewed slices; a checked item requires code, contracts, migrations where applicable, tests, docs, and operational evidence.

### P0 Baseline, Correctness, Money, And Worker Reliability

- [x] Select `origin/codex/frontend-wallet-onboarding` as the integration baseline and create `codex/production-hardening` from commit `130bac0`.
- [x] Inventory every remote branch and reject stale lockfile merges.
- [x] Implement and verify profile logout hardening, including official provider teardown, server cookie expiry, and mobile redirect proof.
- [x] Correct application sessions for multi-device use: new logins coexist, rotation and current logout revoke only one session, explicit recent-auth logout-all is audited, and account-security revoke-all is idempotent.
- [x] Reapply supported dependency upgrades individually after official release review; PRs #36–#40 are merged and the unsupported partial Rolldown native-binding PR #41 is rejected in favor of an enforced coordinated-upgrade policy.
- [x] Select Privy as the embedded-wallet launch candidate, remove Turnkey from the browser runtime and dependency graph, keep external Solana Wallet Adapter support, and document Turnkey only as an unbundled fallback ADR candidate.
- [x] Make content draft creation durably idempotent for the lifetime of its logical operation, including existing receipt promotion and real-Postgres replay/conflict proof.
- [x] Extend logical-operation-lifetime idempotency audits to every remaining protected mutation, retaining bounded expiry only where the operation itself is intentionally time-bounded.
- [x] Correct referral split mathematics so referral commission reduces platform net only and never creator share.
- [x] Use atomic integer-safe values across intent creation, transaction composition, settlement verification, ledger, and contracts.
- [x] Add product-specific SOL/USDC price floors, backend-owned platform/referral fee policy, immutable quote freshness evidence, and lifetime-idempotent audited admin overrides without browser-owned recipients or rates.
- [x] Add one-time USDC split settlement through the canonical payment intent system while retaining native SOL support.
- [x] Add an executable worker scheduler plus tokenized lease expiry/reclamation, bounded jittered backoff, attempt ceilings, dead-letter state, queue-age/admin visibility, and audited idempotent dead-letter recovery. Subscription retries reconcile provider state before any repeat collection call.
- [x] Run the complete bootstrap, doctor, docs, contract-generation drift, database, lint, typecheck, unit, build, and smoke gates for the integration baseline; rerun after each subsequent production slice.

### P1 Universal Account, Plans, Memberships, And Usage

- [x] Keep one account and profile; model app access, SFW/adult publishing, earning, identity readiness, organization roles, and managed-creator consent as independent server-owned capabilities.
- [x] Separate WeVid platform plans from `Join @handle` Profile Membership in schema, contracts, API projections, consumer copy, and tests. Profile Membership readiness is not a Studio capability.
- [x] Implement backend-configurable Free, Plus, Ultra, Studio, and Enterprise policy projection without browser-owned commercial truth; historical persisted labels remain compatibility data and paid provider plans remain fail-closed until launch-approved configuration.
- [x] Meter only free public long-form VOD and public live delivery through server-owned idempotent sessions/heartbeats; exclude Bits, previews, paid unlocks, joined-profile media, paid events, own uploads, and promotional excerpts.
- [x] Preserve purchased, membership, Event Access, preview, Bits, promotional, and owner access when public viewing allowance is exhausted.
- [x] Enforce at most one active membership offer per profile and resolve live membership access server-side; creator eligibility setup remains a separate incomplete slice.
- [x] Apply creator KYC only to individual earning readiness, adult-content assurance only to adult-rated publishing, and KYB only to legal-entity organization workflows. SFW/NSFW remains per-media metadata plus a viewer filter, never an account type.

### P2 Engagement, Feed, Bits, Media, And Live

- [x] Complete real following, like, save, comment, share, report, hide, and block persistence with authz, rate limits, reconciliation, audit, and end-to-end tests.
- [x] Wire content-detail like, save, comment, share, report, hide, and block actions to canonical authenticated APIs; make retries concurrency-safe, reject changed-input idempotency reuse, deduplicate audit events, and cover desktop/mobile interaction plus real Postgres persistence.
- [x] Implement a canonical mixed Home feed and immersive Bits feed with cursor stability, creator diversity, freshness, engagement quality, safety, and follow signals; paid ranking remains forbidden.
- [x] Remove every inert production affordance or wire it to the canonical API owner. Mutuals choices now call the canonical interest mutation with retry-stable idempotency and render the backend-persisted action; unsupported language controls are absent; completed onboarding steps render as status rows rather than `#` links; the service worker preserves the complete failed navigation URL for hydration-independent offline retry; and `pnpm frontend:affordances` rejects enabled type-button controls without an action owner plus empty/hash fallback links.
- [x] Persist normal-message idempotency keys, replay the original message for unchanged retries, reject key reuse with changed input, and make inbox rows select canonical conversation URLs.
- [x] Replace legacy timed live-pass product behavior with three clear access modes: public, profile members, and paid event.
- [x] Support one primary live access call to action, optional members-only chat on public live, inherited replay access, and quarantine replay content before any release. Safe public Bit/highlight generation remains a later slice.
- [x] Integrate SFW live monitoring jobs, creator end, staff suspend/resume, human-review state, evidence, and reasons. Real moderation-provider and suspension-latency evidence remains a pre-production staging gate; adult-live appeals stay out of scope while adult live is disabled.

### P3 Moderation, Providers, And Operations

- [x] Add upload quarantine, malware/container checks, hashes, sampled classification, known-illegal matching boundary, policy decisions, human review, appeals, and auditable release state.
- [x] Add moderation domain records and admin queues without exposing raw illegal material or provider payloads.
- [ ] Complete staging proof for age, KYC, KYB, embedded wallet, Bunny, Livepeer, Solana/USDC, moderation, email, push, and onramp providers before launch approval.
- [x] Complete provider webhook replay with idempotent side-effect recovery and dead-letter visibility.
- [x] Add redacted metrics/traces/logs, backup/restore proof tooling, artifact digest pinning, bounded load tests, incident response, and rollback proof.
- [ ] Configure real OTLP destinations, dashboards, alerts, secret rotation evidence, and shared staging database/Storage restore receipts.

### P4 Functional Frontend Before Visual Polish

- [ ] Improve the existing AppShell and shared `@veel/ui` primitives in place; retain one shell, token system, responsive model, form system, sheet system, and theme owner.
- [ ] Consolidate duplicated navigation, cards, state surfaces, and CSS while preserving route and provider boundaries.
- [ ] Complete Messages list/thread behavior, universal Profile capabilities, creator setup, SFW publishing, verified NSFW gating, and preview-first Create flows.
- [ ] Remove provider/API engineering language from consumer surfaces.
- [ ] Validate phone, tablet, foldable, small laptop, desktop, and ultrawide layouts with safe areas, dynamic viewport units, keyboard/focus, reduced motion, screen-reader, no-overflow, and visual snapshot coverage.
- [ ] Optimize media loading, feed queries, counters, caching, preloading, and Core Web Vitals before the final boutique visual pass.

### P5 GitHub Integration And Production Declaration

- [x] Use protected `main` plus one short-lived reviewed slice branch and one `wevid-active-slice` PR at a time; do not retain a permanent production-hardening branch.
- [x] Merge through reviewed GitHub flow, synchronize local `main` with `origin/main`, and verify a clean worktree after every slice.
- [x] Review fresh dependency pull requests independently from current `main`; supported patches were landed separately and incompatible mixed-major churn was rejected.
- [ ] Declare production readiness only after provider, security, compliance, deployment, observability, backup, and end-to-end evidence gates pass.

## Required Status Discipline

- Every slice summary must state controlling docs, provider docs checked, gaps closed, tests run, and security/compliance boundaries.
- Docs must say what is implemented, what remains fail-closed, required env vars, migrations/contracts/routes changed, admin visibility, tests, and production gates.
- Production UI buttons must perform a real action, navigate to a real route, or be hidden/disabled behind a documented feature flag.
- Do not mark WeVid production-ready until code, migrations, tests, provider staging, deployment, observability, and security/compliance gates support that claim.
