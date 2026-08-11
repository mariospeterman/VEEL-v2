# Current Implementation Status

Status: accepted
Scope: implementation status, known gaps, and next hardening priorities
Last updated: 2026-08-10
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
- Veel remains noncustodial: no internal credits, balances, escrow, withdrawals, payout queues, or server-held user private keys.

## Implemented And Real

- Monorepo, pnpm workspace, CI/security workflow, docs checks, lint/typecheck/test/smoke scripts, GStack gates, and gitleaks local gate.
- Toolchain versioning is explicit through `.node-version`, `.nvmrc`, `packageManager`, and `engines`: Node.js `22.16.0`, pnpm `10.0.0`, Corepack activation, `pnpm bootstrap`, `pnpm run doctor`, and `pnpm check`. The canonical CI proof job is `pinned-toolchain-proof`.
- The production dependency graph no longer includes the unused `@solana/wallet-adapter-wallets` umbrella package, which removed unrelated hardware-wallet and WalletConnect adapters. Next.js is pinned to `16.3.0`, Playwright is pinned to the latest macOS 12-compatible release (`1.60.0`), and patched same-major `axios`/`ws` resolutions are enforced. `pnpm audit --prod` reports zero critical advisories; the remaining `image-size` and legacy `uuid` findings are transitive provider/mobile-tooling dependencies and do not occur in the built `.next` artifact. Provider selection must still remove the unselected embedded-wallet SDK and re-audit before launch.
- OpenAPI, route map, and Fastify route registration are checked for route drift. Previous contract-only current-viewer and follow endpoints were removed from the active contract because the session endpoint is the implemented current-viewer boundary and the follow graph does not yet have a real migration/repository/API slice.
- Fastify API bootstrap with route registration, dependency construction, shared app-level Postgres client construction, close-hook lifecycle, env validation, raw-body support for signed webhooks, global rate limit, OpenAPI plugin, and Supabase boundary plugin.
- Shared backend helpers now cover the app-level Postgres client, explicit transaction boundary, common Idempotency-Key parsing/validation, stable idempotency request hashing, route-specific mutation rate-limit presets, and the first admin mutation route-policy guard for migrated route utilities.
- Root Supabase CLI project is initialized with committed `supabase/config.toml`, repo-local Supabase CLI `2.106.0`, and `supabase/migrations` linked to the canonical `packages/database/migrations` SQL files. The connected Supabase project is synchronized through migration `0075`; the repo wrapper runs remote migration commands from a filtered temporary workdir so `.down.sql` rollback files are not interpreted as duplicate Supabase migrations. `pnpm supabase:migrations` aligns local/remote history and `pnpm supabase:push:dry` reports the remote database is up to date.
- Supabase/Auth session verification boundary, web SSR cookie refresh/confirmation route, landing-owned magic-link/OAuth session UX, profile-completion mutation UI, external wallet challenge handoff UI, configured-session redirects, backend app-access redirects for protected app-shell pages, and backend session/profile readiness projections. Browser Supabase auth uses the public Supabase URL plus publishable or anon key only; service-role and secret keys stay server-side.
- Age provider waterfall boundary, `/age` provider-session start UI, and normalized webhook/test paths, with unavailable providers failing closed when not configured. Local/test-only mock age and creator verification adapters exist behind explicit mock guards for end-to-end development; production provider paths still require real provider credentials, webhook secrets, callback allowlists, and provider dashboard configuration.
- External wallet challenge/link/revoke/status flow with backend signature verification and replay/expiry checks; landing onboarding and `/app/wallet` can now coordinate Solana wallet-adapter challenge signing while keeping wallet truth server-side. The landing wallet chooser filters to intentionally supported Solana wallet surfaces and embedded wallet buttons remain disabled unless Privy/Turnkey runtime env is configured; onramp provider boundary fails closed unless configured.
- Home feed, content read model, media access projection, `/create` backend draft/upload-session handoff with persisted media asset id, TUS upload progress/pause/resume, creator-triggered provider status sync, Bunny/Livepeer provider status boundaries, and provider webhook normalization tests.
- Provider media readiness only updates playback/readiness projection; moderation approval and public access remain separate backend/admin-owned truth.
- Native SOL and one-time USDC payment intents, noncustodial creator split settlement facts, short-lived capability-token Solana Pay checkout, server-composed unsigned split transaction, submitted-signature capture, exact backend settlement verification at configured finality, shared transaction boundary for payment submission settlement, content unlock entitlement grant after confirmed settlement, and browser support, content-unlock, paid-live-event, Event Access Pass, and paid-message handoffs to backend-created intents/transaction requests.
- Payment intents now store and expose instant-digital-access withdrawal-waiver/terms evidence defaults so refund review can protect creators/platform against ordinary change-of-mind refunds where legally valid while preserving mandatory-rights exceptions.
- Confirmed payment settlement now writes durable receipt, receipt line, compliance-ledger, in-app confirmation delivery, pending email-provider delivery, notification, and audit evidence in the same backend transaction used for entitlement/product settlement.
- Activity payment projections and `/app/activity` now expose backend-derived receipt/confirmation/withdrawal-review state and a real refund/access-issue review request form for exceptions. This is review-state only: no automatic refund, custody, balance, payout queue, or access revocation is executed from the user surface.
- Admin refund/dispute resolution now supports idempotent evidence-only remediation records for creator refund attestations, replacement access, access revocation, technical remediation, and no-refund denials. The evidence table is RLS-protected, audited through the admin mutation, tied to the payment intent, and constrained to `evidence_only_no_platform_custody_no_payout_queue`.
- Canonical Support with historical `tip` read/settlement compatibility, referral attribution/commission projection, correctly formatted asset amounts, activity/payment/wallet transaction projections, and creator dashboard/onboarding projections that avoid balance/withdrawal language.
- Live room/chat projections with public, profile-member, and paid-event modes, DB-first Livepeer room reservation before provider creation, Event Access Pass projections, Mutuals projections, messages/paid-message projections, notifications/push/service-worker boundaries, organization/KYB/admin support policy surfaces, and admin provider/payment/compliance projections.
- Auto-renewing subscription architecture is modeled through backend-owned delegated authorization, renewal worker tick, collection/grace/revocation states, and fail-closed provider boundaries; `/subscriptions` exposes backend intent creation, setup-reference display, authorization evidence submission, and cancellation controls without making the browser a subscription/access source of truth. Production recurring subscriptions remain disabled unless `official_solana_subscription_program` is configured with program/RPC/SPL mint/collector/merchant values and on-chain verification enabled.
- Remote MCP exposes OAuth protected-resource metadata, authorization-server metadata, authorization-code plus PKCE endpoints, revocation, consent approval, resource-bound bearer tokens, scoped tool allowlists, redacted audit rows, and staging proof scripts: `pnpm mcp:seed`, `pnpm mcp:oauth:pkce`, and `pnpm mcp:smoke`. The canonical runbook is `mcp-staging-proof.md`.
- Frontend smoke coverage covers desktop/mobile app shell, onboarding, age, content, create, discover, messages, activity, wallet, creator dashboard, subscriptions, Studio/org, settings, admin, live, Event Access, Mutuals, and assistant projections. Authenticated happy-path smoke now covers `landing onboarding -> profile -> wallet -> age -> home -> create -> unlock` against a local mock API, including bearer-token propagation and idempotency headers for money/access mutations.
- Frontend app-shell parity now uses the checked-in mockups and logo assets as the visual source for the primary web shell. The public `/` route is an onboarding-aware landing surface, while canonical protected app routes live under `/app/*` (`/app/home`, `/app/bits`, `/app/create`, `/app/messages`, `/app/profile`, and secondary workspaces). The app shell is fixed to one viewport with internal scroll panes, desktop rail, mobile dock, persisted light/dark mode, and subtle accent/noise treatment on primary actions. Shared web state components map API failures to safe auth/forbidden/not-found/validation/conflict/rate-limit/service/network states, so signed-out and protected data surfaces do not expose raw bearer-token or `HTTP <status>` backend messages to users. Content playback now uses provider-owned rendering boundaries: Bunny Stream via backend-issued embed iframe URLs and Livepeer via official `@livepeer/react/player` primitives.
- Real authenticated API integration coverage exercises the wallet -> age -> profile readiness -> content create -> content unlock -> confirmed settlement -> entitlement-backed unlock -> idempotent refund/dispute request -> paid Event Access Pass -> confirmed settlement -> access-pass activity -> paid message -> confirmed settlement -> visible message -> paid live event -> confirmed settlement -> signed playback/chat -> subscription authorization -> worker collection -> provider replay path against a configured Postgres/Supabase test database through Fastify routes, worker repositories, and Postgres repositories. The test uses real external-wallet Ed25519 signatures, a signed Sumsub-style age webhook, backend-created mutations, a confirmed settlement verifier boundary, entitlement/access-pass/message/live room/subscription read-projection assertions, worker collection/replay outcome assertions, deterministic cleanup, and an explicit remote-DB guard. Run it with `VEEL_ALLOW_REMOTE_API_INTEGRATION_TESTS=1 pnpm test:integration:api` when the root `.env` points at the intended non-production test database.

## Fail-Closed Or Not Production-Ready

- Real provider credentials, webhook endpoints, staging accounts, sandbox smoke tests, and production keys are intentionally placeholders until manually configured.
- Landing now owns login/onboarding story flows, starts real Supabase magic-link/OAuth session flows when the public browser Supabase env is present, exposes profile-completion UX, and coordinates external Solana wallet challenge signing through backend-owned wallet endpoints. Protected web pages redirect to `/?mode=login&next=<path>` when Supabase SSR is configured and no validated claims are present. Protected app-shell pages redirect incomplete backend `appAccessState` to `/?mode=onboarding`, `/app/wallet`, or `/age`; remediation surfaces remain reachable.
- The wallet runtime is loaded on demand on landing and mounted once for the authenticated app. Configured embedded wallet buttons use the official Privy or Turnkey SDK path; external wallets remain owned by Solana Wallet Adapter. Profile logout uses official Privy logout, Turnkey all-session clearing, Solana disconnect, Supabase local sign-out, app wallet-session cleanup, and server cookie expiry before replacing the location with `/`.
- Landing login and onboarding stay locked to their GSAP story frame while provider runtimes initialize or wallet UI takes focus, with desktop and mobile smoke coverage preventing outer-story scroll drift.
- Age session creation now has real backend HTTP adapters for Yoti, Persona, Veriff, and Sumsub behind the provider waterfall, with unconfigured providers failing closed. Launch readiness still needs one selected provider configured with live sandbox credentials, verified webhook signing, provider-contract/legal retention approval, and admin review evidence. Creator KYC/KYB remains separate from ordinary landing age assurance and belongs to Studio/enterprise/creator monetisation workflows.
- Embedded wallet provider remains a boundary until a launch-approved noncustodial provider is configured and tested.
- Payment settlement is native SOL devnet first with server-composed creator split transactions for one-time creator monetization. Recurring subscriptions are token-based only and fail closed without official Solana subscription/delegation verification; native SOL recurring subscriptions, SPL/USDC one-time split settlement, real transactional email domain/API-key configuration and staging deliverability smoke for withdrawal-waiver confirmations, and provider replay side-effect handlers still need launch-scope completion.
- Follow/unfollow is planned but intentionally absent from the active contract until the follow graph migration, repository, idempotent route, feed impact, abuse controls, and tests ship together. Current feed controls cover preferences, hides, reports, blocks, comments, likes, saves, and shares.
- Subscription renewals are architected as auto-renewing backend/worker collections, but production collection requires official provider/program configuration, authority/subscription/delegation verification, launch-approved token plans, collector signing support, and staging evidence.
- Remote MCP production connector compatibility still requires public HTTPS staging deployment, exact redirect URI allowlists for each real client, MCP Inspector proof, Claude Code proof, Claude custom connector proof, OpenAI-compatible proof, revocation proof, and audit-row confirmation against the deployed database.
- Media creation has backend draft, admin-tunable draft/upload abuse policy enforcement with safe defaults, metadata/preview update, Event Access draft linking, persisted upload-session handoff, TUS browser upload/resume wiring, provider-status sync UI, entitlement-aware content playback rendering, explicit publish submission, and a separate `publish_state`.
- Frontend visual polish remains iterative: main app-shell routes now follow the mockup-derived shell and safe state model, but contextual detail/admin routes still need a final responsive visual QA pass against the mockup screenshots before the frontend should be called design-complete.
- Admin dashboard is substantial; organization KYB/member, support policy/case, moderation/report, refund/dispute, data-request, and feature-flag mutations now share the admin mutation route-policy/idempotency/rate-limit guard, but final role matrix coverage and removal of any remaining compatibility aliases after migrations and clients are updated still remain.
- Deployment has an executable skeleton with health/readiness probes, build/migration workflow gates, rollback runbook, deploy preflight, and observability runbook. It remains not production-ready until real hosting targets, artifact digest pinning, database backup confirmation, provider staging smoke, alert routing, environment-scoped deploy variables, and the final Supabase remote migration-history linking strategy are configured.
- Local macOS Vitest/Vite execution is covered by optional `rolldown` Darwin native bindings and `pnpm run doctor`, which resolves the pinned Node.js/Corepack toolchain even when the interactive shell points at an older Node. Tests must still run locally and in the pinned Linux CI proof before provider or frontend slices are considered validated.

## P0 Before Broad Expansion

1. Continue migrating money/access/admin/safety mutations onto the shared Postgres transaction helper slice by slice; payment submission settlement is already on the shared boundary.
2. Continue migrating route modules onto shared idempotency helpers, route-policy/RBAC, route-specific rate-limit presets, and test factory helpers. The first admin mutation routes are migrated; money/access/safety routes still need slice-by-slice adoption and durable generic idempotency conflict behavior where route-specific stores are insufficient.
3. Extend real authenticated API/test-DB integration coverage beyond the wallet -> age -> create -> content unlock/refund request/payment activity receipt/Event Access/paid message/paid-live-event/subscription/provider replay path to provider-specific webhook replay side-effect handlers and browser-authenticated refund/remediation admin evidence views. The connected Supabase project is synchronized through `0075`; the security advisor reports no findings, and `0074`-`0075` cover the foreign keys reported by the performance advisor. Continue running migration-history and advisor checks after every database slice with public-table RLS kept at 100%.
4. Run live sandbox proof for one launch-approved age provider, then wire the separate creator KYC/KYB Studio/enterprise flow with its own policy, credentials, webhooks, admin evidence, and retention approval.
5. Harden Solana subscription/allowance verification for platform plans and creator memberships; one-time creator split settlement is now the baseline for creator monetization payments.
6. Complete remote MCP staging proof with MCP Inspector, Claude Code, Claude custom connector, and OpenAI-compatible clients against a public HTTPS staging URL before claiming external connector compatibility.
7. Continue deployment hardening beyond the skeleton: artifact digest pinning, provider staging smoke, backup/snapshot verification, alert routing, and real hosting/OIDC integration.

## Production Hardening Backlog

The controlling branch evidence is recorded in `production-branch-inventory.md`. Work is executed in coherent reviewed slices; a checked item requires code, contracts, migrations where applicable, tests, docs, and operational evidence.

### P0 Baseline, Correctness, Money, And Worker Reliability

- [x] Select `origin/codex/frontend-wallet-onboarding` as the integration baseline and create `codex/production-hardening` from commit `130bac0`.
- [x] Inventory every remote branch and reject stale lockfile merges.
- [x] Implement and verify profile logout hardening, including official provider teardown, server cookie expiry, and mobile redirect proof.
- [ ] Reapply supported dependency upgrades individually after official release review.
- [ ] Select one embedded-wallet provider for launch, remove the unselected SDK and its transitive EVM/mobile dependency surface, then require a clean production-artifact audit or a reviewed exception for each unreachable upstream advisory.
- [ ] Make every protected mutation durably idempotent for the lifetime of one logical operation, starting with content draft creation.
- [x] Correct referral split mathematics so referral commission reduces platform net only and never creator share.
- [ ] Use atomic integer-safe values across intent creation, transaction composition, settlement verification, ledger, and contracts.
- [ ] Add product-specific price floors, backend-owned fee policy, quote freshness, and audited overrides without browser-owned recipients or rates.
- [ ] Add one-time USDC split settlement through the canonical payment intent system while retaining native SOL support.
- [x] Add an executable worker scheduler plus tokenized lease expiry/reclamation, bounded jittered backoff, attempt ceilings, dead-letter state, queue-age/admin visibility, and audited idempotent dead-letter recovery. Subscription retries reconcile provider state before any repeat collection call.
- [x] Run the complete bootstrap, doctor, docs, contract-generation drift, database, lint, typecheck, unit, build, and smoke gates for the integration baseline; rerun after each subsequent production slice.

### P1 Universal Account, Plans, Memberships, And Usage

- [x] Keep one account and profile; model app access, SFW/adult publishing, earning, and identity readiness as server-owned capabilities. Live, buying, memberships, organization, and paid-plan capability composition still requires completion.
- [ ] Separate VEEL platform plans from `Join @handle` creator membership in schema, contracts, API, entitlements, copy, and tests.
- [x] Implement backend-configurable Free Verified, Plus, Ultra, Studio, and Enterprise policy projection without browser-owned commercial truth; paid provider plans remain fail-closed until launch-approved configuration.
- [ ] Meter only free public long-form VOD and public live delivery; exclude Bits, previews, paid unlocks, joined-profile media, paid events, own uploads, and promotional excerpts.
- [ ] Preserve purchased and membership access when public viewing allowance is exhausted.
- [x] Enforce at most one active membership offer per profile and resolve live membership access server-side; creator eligibility setup remains a separate incomplete slice.
- [x] Apply creator KYC only to individual earning readiness, adult-content assurance only to adult-rated publishing, and KYB only to legal-entity organization workflows. SFW/NSFW remains per-media metadata plus a viewer filter, never an account type.

### P2 Engagement, Feed, Bits, Media, And Live

- [ ] Complete real following, like, save, comment, share, report, hide, and block persistence with authz, rate limits, reconciliation, audit, and end-to-end tests.
- [ ] Implement a canonical mixed Home feed and immersive Bits feed with cursor stability, creator diversity, freshness, engagement quality, safety, and follow signals; paid ranking remains forbidden.
- [ ] Remove every inert production affordance or wire it to the canonical API owner.
- [x] Replace legacy timed live-pass product behavior with three clear access modes: public, profile members, and paid event.
- [ ] Support one primary live access call to action, optional members-only chat on public live, inherited replay access, and safe public Bit/highlight generation.
- [ ] Integrate live moderation signals, temporary pause/end controls, human review, evidence, reasons, and appeal paths.

### P3 Moderation, Providers, And Operations

- [ ] Add upload quarantine, malware/container checks, hashes, sampled classification, known-illegal matching boundary, policy decisions, human review, appeals, and auditable release state.
- [ ] Add moderation domain records and admin queues without exposing raw illegal material or provider payloads.
- [ ] Complete staging proof for age, KYC, KYB, embedded wallet, Bunny, Livepeer, Solana/USDC, moderation, email, push, and onramp providers before launch approval.
- [ ] Complete provider webhook replay with idempotent side-effect recovery and dead-letter visibility.
- [ ] Add redacted metrics/traces/logs, dashboards, alerts, backup/restore proof, artifact digest pinning, secret rotation, load tests, incident response, and rollback proof.

### P4 Functional Frontend Before Visual Polish

- [ ] Improve the existing AppShell and shared `@veel/ui` primitives in place; retain one shell, token system, responsive model, form system, sheet system, and theme owner.
- [ ] Consolidate duplicated navigation, cards, state surfaces, and CSS while preserving route and provider boundaries.
- [ ] Complete Messages list/thread behavior, universal Profile capabilities, creator setup, SFW publishing, verified NSFW gating, and preview-first Create flows.
- [ ] Remove provider/API engineering language from consumer surfaces.
- [ ] Validate phone, tablet, foldable, small laptop, desktop, and ultrawide layouts with safe areas, dynamic viewport units, keyboard/focus, reduced motion, screen-reader, no-overflow, and visual snapshot coverage.
- [ ] Optimize media loading, feed queries, counters, caching, preloading, and Core Web Vitals before the final boutique visual pass.

### P5 GitHub Integration And Production Declaration

- [ ] Push the production-hardening branch and keep its pull request draft until all required evidence is green.
- [ ] Merge through reviewed GitHub flow, synchronize local `main` with `origin/main`, and verify a clean worktree.
- [ ] Close superseded dependency pull requests and remove only merged/superseded remote branches.
- [ ] Declare production readiness only after provider, security, compliance, deployment, observability, backup, and end-to-end evidence gates pass.

## Required Status Discipline

- Every slice summary must state controlling docs, provider docs checked, gaps closed, tests run, and security/compliance boundaries.
- Docs must say what is implemented, what remains fail-closed, required env vars, migrations/contracts/routes changed, admin visibility, tests, and production gates.
- Production UI buttons must perform a real action, navigate to a real route, or be hidden/disabled behind a documented feature flag.
- Do not mark Veel production-ready until code, migrations, tests, provider staging, deployment, observability, and security/compliance gates support that claim.
