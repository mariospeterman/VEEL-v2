# Documentation authority and cleanup audit — 71ceabc

Read coverage: `docs-coverage.json`. This reviewer full-read38 docs, all42 `.agents` files, AGENTS.md,CLAUDE.md and Cursor rules; concatenated output truncations were repaired by range re-reads. Remaining docs domains are explicitly delegated to root, payments, frontend, and auth reviewers, whose own coverage must establish completion. No source edits. Earlier worker/analytics findings in `worker-analytics-audit.md` apply to claims in the analytics docs.

## D-01 — P2 — Four architecture blueprints and many source-of-truth headers disagree

Concrete evidence:

- `app-architecture.md:149`, `backend-fastify-architecture.md:168`, `infra-decisions.md:29,114`, `deployment-topology.md:33` designate pg-boss as launch queue, while current worker implements domain-owned Postgres lease tables and no pg-boss runtime. Do not install pg-boss merely to satisfy old prose; decide measured queue consolidation, document existing authority, repair its lease defects, and avoid parallel queues.
- `infra-decisions.md:31,135` makes PostHog the product analytics owner; `product/analytics-core.md` establishes deterministic typed Postgres projections and forbids parallel formulas. PostHog/Sentry are not proven operational integrations merely because a table calls them defaults.
- `backend-fastify-architecture.md:114-115` says JSON Schema/Zod is the schema source and OpenAPI is generated from routes; `contracts-and-schema.md` and runtime use canonical OpenAPI YAML consumed to produce route schemas/types. The actual generation direction must be one-way and explicit.
- `full-platform-blueprint.md:23` calls itself the single visual blueprint, while app-architecture is another enterprise blueprint and diagrams.md claims canonical full architecture. They repeat stale identity, onboarding, module and provider instructions and broadly defer to the obsolete schema blueprint.

Fix: one small system architecture page + ADRs for non-obvious decisions + narrow implemented-domain docs. Generate inventories/links from contracts and actual tree. Remove obsolete alternative framework deliberation and 'before implementation starts' text from active guidance, retaining decision rationale in archived ADR history.

## D-02 — P1/P2 — Old Supabase session authority can reintroduce a second auth system

- `deployment-topology.md:72`: Supabase Auth is identity/session issuer.
- `full-platform-blueprint.md:304-305`: Identity/session = Supabase Auth.
- `product-flows.md` Auth And Access sequence gets a Supabase JWT then calls `/me`, even though immediately following prose says signed wallet session is canonical.
- `backend-fastify-architecture.md` Security Baseline says JWT verification against Supabase project keys without distinguishing recovery from ordinary requests.
- `product/mutuals.md` Provider Dependencies says Supabase Auth for identity.

Current narrow auth/identity docs and runtime specify one opaque backend wallet session; Supabase is optional lookup-only recovery; Realtime JWT is separate transport credential. Rewrite every diagram/table to distinguish those roles. Never repair old diagrams by adding Supabase ordinary API authentication or extra sign-in steps.

## D-03 — P2 — Onboarding requirements and UI entry instructions conflict within active docs

- `auth-supabase-realtime.md:122` requires handle, but `:226` says profile optional.
- `providers/identity-provider-wiring.md:113` also says profile optional.
- `compliance/adult-content-compliance.md:50` allows stronger adult-publisher flow during onboarding; identity wiring `:41` explicitly excludes adult-publishing intent from the locked three steps and defers it to Create.
- `compliance/age-kyc-jurisdictions.md:38,93` requires ordinary provider-choice UI; provider-map/current UX selects one backend primary and at most one fallback, no provider chooser.
- `providers/identity-provider-wiring.md:73` says Wallet Adapter modal owns selection; current direct Wallet Standard provider cards plus fallback modal are deliberately implemented at71ceabc.
- Older external Connect Wallet primary/secondary-CreatesecureWallet copy conflicts with one public Continue to WeVid + configured provider grid in later lifecycle docs. Keep one public entry model and one first-party set of copy.

Fix: state current required steps once: purpose-bound Account+Wallet -> required unique handle (display name/avatar optional) -> age. Returning login never provisions; unknown identity has explicit onboarding handoff. Adult/performer/earnings/legal entity setup is contextual and independent.

## D-04 — P1/P2 — Old KYC prose collapses independent capability decisions

`auth-supabase-realtime.md:272` says creator KYC required for uploading, publishing, monetization, payouts, or creator/studio actions. `providers/identity-provider-wiring.md` later correctly states SFW upload/publication requires age, creator KYC affects proceeds only, and KYB alone never grants Enterprise. ADR0004 and sfw-publishing-and-moderation agree with the latter. 'Payouts' is itself misleading in a noncustodial system with no payout queue.

Fix: defer every broad document to ADR0004 and canonical eligibility resolvers. Keep earning policy configurable/strict where legally required; do not make counsel decisions from this audit. Explicitly separate age access, adult publisher, per-performer consent, recipient KYC/tax, organization KYB and paid plan/relationship capabilities.

## D-05 — P2 — Runtime configuration and key setup instructions are inconsistent

- `auth-supabase-realtime.md:248` instructs rebuilding whenever NEXT_PUBLIC values change; `deployment-topology.md:198-200` explicitly serves process-runtime public config and promotes one immutable image without rebuild. Distinguish local Next build behavior from the repository's allowlisted runtime bridge and avoid changing artifact between staging and production.
- Operator runbook `provider-setup-and-demo-data.md:65`, `.env.staging.example:36-37`, and `scripts/staging-config.mjs:37-38` require PRIVY_APP_SECRET/JWKS for alleged server verification. Full repo rg found these values only in schema/examples/staging gating/log redaction, with no runtime provider verifier. Narrow wallet docs explicitly verify the wallet signature and avoid Privy subject authority. Remove unused required secrets/gates rather than inventing a second identity proof solely to justify them; retain only if a separately approved real server use is implemented.
- MCP staging instructions hardcode `/Users/maki/.nvm/versions/node/v22.16.0/bin`; docs/ai-tooling/gstack.md claims global install paths for one machine. Use repository toolchain commands and optional local discovery, not host-specific truths.

## D-06 — P2 — Image processing readiness is confused with release eligibility

`product/universal-composer.md:129` calls stored_private explicitly non-playable; runtime `content-media-repository.ts:377-378` sets provider_state='stored_private', provider_playable=true so safety reconciliation may lease it. ADR0003 and later MCP media doc correctly say private provider readiness is not public delivery or approval. Route-map also says remains non-playable, which is semantically ambiguous.

Fix: document distinct fields/states: transfer stored, provider/read readiness, safety evidence complete, human approval, publication, viewer authorization. Do not 'fix' runtime tofalse and strand image moderation jobs; do not promote private storage readiness to viewer access.

## D-07 — P2 — Ranking documentation permits inputs explicitly forbidden elsewhere

`recommendation-discovery.md:210` lists paid/unlocked state among ranking inputs; `:292` allows paid promotion under future ADR; infra-decisions similarly permits a paid-distribution direction. AGENTS and current deterministic feed description forbid purchase/earnings/membership/balance influence. `recommendation-discovery.md:342` says Following may be primarily followed content depending fallback, despite its implemented-boundary claim Following has no fallback.

Fix: remove paid/unlocked from scoring and paid-promotion loophole from active launch guidance. Access eligibility may independently use entitlement, but entitlement/payment value never becomes rank weight. Following is exact followed-only. Preserve separately deferred proposals only in a clearly non-authoritative ideas archive.

## D-08 — P2 — Conceptual schema is incorrectly presented as current database authority

`contracts-and-schema.md:99` says build migrations from the schema blueprint even after118 applied migrations, and many docs/agent routers defer to it. `data-model.md` ER/state diagrams use obsolete content_assets/engagements/payment_splits/settlements/live_passes/etc and draft->pending->submitted->confirmed->settled payment states. Database reviewer independently measured blueprint drift (82 current tables absent,16 obsolete names, unsafe old public profile default).

Fix: immutable migration chain + generated current schema snapshot + schema diff checks. Archive or clearly relabel original blueprint as historical and remove it from active routing. Do not rewrite applied migration history or erase rollback evidence. Make conceptual diagrams use domain concepts or exact current names, not fictitious real table names.

## D-09 — P2 — Route table security columns and implemented wording drift

`route-map.md` labels public `/profile/:handle` as requiring auth/age/wallet, despite anonymous Safe-only preview behavior. It labels wallet/settings remediation as age-ready-only despite auth doc expressly allowing these remediation surfaces. It omits canonical `/content/:id` from the main frontend table while referring to it later. Phase columns mix original plan phases and implemented convergence slices, so 'Phase2' does not tell an operator whether a feature works.

Fix: derive an implemented route inventory, separate page entry requirement from protected data requirement, and explicitly distinguish implemented, disabled, provider-blocked, and deferred. Test route guards with anonymous/provisional/age-pending/ready/restricted users.

## D-10 — P2/current compatibility — MCP current-official-doc claim is false

Repo ADR0002:145+, ai-mcp-use-cases.md, mcp-profile-bridge.md and mcp-staging-proof.md say July2026 spec remains a release candidate and2025-11-25 is latest stable. Official primary sources retrieved2026-11-04 state2026-07-28 was finalized onJuly28. Current runtime `apps/api/src/modules/mcp/mcp-routes.ts:480` uses initialize; `:1066` chooses2025versions and `:1090` rejects the new version.

Official evidence:
- https://blog.modelcontextprotocol.io/posts/2026-07-28/ (turn38view0): final release and official Tier1SDK availability.
- https://modelcontextprotocol.io/specification/2026-07-28/changelog (turn38view1): stateless version/capability metadata, no initialize handshake/session IDs, mandatory server/discover implementation, request routing headers, cache metadata, MRTR and auth hardening.

Keeping an older supported compatibility target is not automatically a vulnerability. The stale factual rationale and latest/comprehensive compatibility claims are wrong. For the user's latest/provider-first objective, evaluate the official maintained SDK and add a controlled current-version migration with exact-client proof and an explicit compatibility matrix. Reuse existing scopes, policy, repositories and audit; no second MCP endpoint/business authority. If retaining an older version temporarily, name it as a bounded compatibility decision and document the tested clients/upgrade blocker honestly.

## D-11 — P2 — Provenance reference constraints are not proof of ownership or C2PA validation

ADR0002 and mcp-media-provenance-bridge correctly describe C2PA references as unverified claims, but permit only c2pa.org HTTPS paths or opaqueURNs. A standards project's documentation domain is not a general creator manifest repository. This does not establish real-world content credential portability, validate signatures, prove copyright/consent, or give creators independent media custody. Preserve strict privacy/security; do not broaden arbitrary fetches. Decide whether reference-only metadata is useful, or adopt maintained bounded C2PA SDK verification for supported assets with offline/controlled retrieval and clear validation states.

The stated2.2doc baseline is old: official site currently publishes2.4and2.5indexes. Primary refs retrieved2026-11-04:
- https://spec.c2pa.org/specifications/specifications/2.5/index.html (turn38view2)
- https://spec.c2pa.org/specifications/specifications/2.4/specs/C2PA_Specification.html (turn37search5)

Do not claim this app implements a full current C2PA validator; it does not.

## D-12 — P2 — Broad AI feature wish lists obscure the actual safe tool set

ai-mcp-use-cases has desired publish-review/profile/event/message tools, a matrix missing later media tools, and conditional statements such as do not publish without confirmation. Current narrow bridge only reads profile/analytics/drafts and prepares private drafts/media, with first-party review. The auth reviewer found old admin tool/RBAC claims beyond actual routes.

Fix: generate current MCP tool/scope/annotation matrix from registry; move future ideas to deferred scope and say explicitly that first-party confirmation cannot make an unimplemented unsafe tool exist. Current publish/spend/send/moderate remain outside MCP scope.

## Provider acceptance and ownership recommendation to preserve

All key provider rows remain candidate/CODE_COMPLETE_PROVIDER_BLOCKED. This is not an obsolete label to delete to make a gate green. Retain exact use-case approval, real device/domain, signed webhook, key rotation, private/quarantined upload, failure/recovery/deletion and immutable release evidence. Keys alone are insufficient for launch.

Provider terms checked separately in ownership research: Bunny permits conditional lawful adultVOD, short live events require written consent; Livepeer Studio broad objectionable/obscene-content wording needs exact adult-use approval; correct Privy legal domain is privy.io (privy.com is a different marketing vendor). Current Bunny security docs modifiedNov2 distinguish embed and CDN protection. Refresh official anchors using provider current doc indexes; legacy Livepeer URLs have moved. Do not mechanically remove 'candidate' or 'blocked'.

Creator ownership target: creator rights + narrow operational license + one-click async original/metadata export + immediate unpublish and auditable provider deletion, optimized provider delivery. Keep original files only with a retention/export/deletion decision; currentBunnyoriginalsrequirekeep-originalsetting. Managed platform hosting remains platform-operated; neither an NFT/hash nor noncustodial Solana payments removes hosting/consent/age/reporting obligations. No raw sensitive media on permanent public networks as default. Full ownership research was sent to root with primaryURLs/refs.

## Concrete keep/update/archive map

| Group | Action | Reason |
|---|---|---|
| AGENTS.md + local production-loop skill | Keep, shorten routing and align with final ownership map | One cross-agent router, currentstatus/buildplan/workflow links; preserve protectedmain/dirtytree rules |
| CLAUDE.md + Cursor rules | Keep as tiny mirrors that defer toAGENTS | Avoid three policy copies; provider secrets vs permitted short-lived playback credentials must be distinguished |
| app-architecture.md | Keep/rewrite as short current system map | Module/provider/auth/queue boundaries only |
| full-platform-blueprint.md + diagrams.md | Merge useful diagrams into current system page; archive redundant blueprint prose | Eliminate competing global authority and old start-from-scratch instructions |
| contracts-and-schema.md + data-model.md + schema-blueprint.sql | Replace current instructions with generated contract/schema guide; archive conceptualblueprint | Applied migrations/current generated snapshot own database truth |
| ADR0001-0004 | Keep decisions, reconcile updated facts and narrow scope | ADR is rationale, not duplicate runbook/provider state table |
| provider-map.md + ADR0002provider status tables | Choose one machine-readable provider registry with generated summaries; keep readable links | One approval/config/proof owner per use case |
| auth-supabase-realtime.md + embedded-wallet-onboarding.md + identity-provider-wiring.md | Keep one auth/session doc, one short onboarding guide, one operator verification runbook; link instead of repeating flows | Preserve wallet/recovery/transport distinction and independent purposes |
| universal-composer/media-live/sfw/ADR0003/content-protection | Keep narrow domain boundaries; de-duplicate per-provider setup | Separate processing/safety/publication/access; preserveblockedgates |
| product/analytics-core.md | Update after WAfindings and measuredfreshness/retentionproof | Current privacy/RBAC/parity claims are not fulfilled |
| product/lifecycle-auth-and-analytics-surfaces.md | Mark implemented current, link owned auth/analytics docs | Currently stillStatusdraft after merged implementation |
| product/mcp-profile + media bridge + mcp-staging-proof | Keep narrow current interface and proof; updateprotocol/compatmatrix | No LLM/key platform or dangerous tools |
| product-flows.md/recommendation/mutuals | Update to current implemented flows; remove contradictedfutureinstructions | Paidranking/profile/KYC/realtime staleness |
| production-branch-inventory.md | Archive as dated historical evidence; no active branch prescriptions | Git/GitHub own current branch/PR truth; rootstate router owns nextslice |
| dependency-security-status.md + currentstatus | Keep concise last verifiedSHA/evidence/blockers, link machine outputs/history | Avoid ever-growingstatus becoming architecture |
| operator/provider-setup-and-demo-data.md | Keep as primarysetup entry, generated exactenvlinks, removeunusedsecrets/hostpaths | Practical one-run setup and truthfulproofgates |
| .agents vendor Supabase skills | Keep vendored third-party guidance pinned with provenance/license; do not turn examples into appauthority | Inspected42files; no reason to regenerate vendor code or installglobal skills duringaudit |
| docs/ai-tooling/gstack.md | Keepoptionaltoolboundary; remove assertion aboutonehostglobalinstall | Advisoryreviewtool, no dependency/authority |

Each retained domain doc should fit: purpose/owner; what is implemented; happy path; states and recovery; contract/migrations/provider links; required configuration; security/access rules; test/proof commands; current blockers. Link generated evidence rather than pasting long commit narratives. Do not replace stale completeness claims with unsupported 'production ready'.

## D-13 — P2 — Final status and acceptance files contain conflicting current-state assertions

Full closure read of `current-implementation-status.md` (479 lines,70,413 bytes) and `operator/staging-acceptance.json` (347 lines,22,686 bytes) is recorded in `final-status-docs-coverage.json`. These findings concern documentation/evidence integrity; they do not establish additional data vulnerabilities.

- Current status `:41` names an older merged baseline; `:312` still describes architecture as implemented through migration0102 although the same document records0118; `:340` labels Enterprise deferred after its own earlier implementation account; `:435` calls creator eligibility setup incomplete after describing Enable Earnings as implemented. `:409` makes the historical production-branch inventory controlling branch evidence despite the opening section correctly deferring live Git state to the active PR. Keep one current SHA/evidence summary and dated historical entries outside active instructions.
- Current status `:383` and acceptance JSON `:9` call landing authentication a modal/sheet; frontend reviewer proved current full-page behavior and an explicit no-dialog smoke assertion. Reconcile to the actual accepted flow; do not recreate a modal solely to satisfy stale prose.
- Acceptance JSON `:32,232,292` presents conceptual names such as recovery_identities, analytics_facts, analytics_daily_projections and staff_permissions as exact database authorities. Replace these with actual canonical tables/views or explicitly label conceptual domains. This supports D-08's generated schema/authority mapping recommendation.
- Acceptance JSON `:287-304` records permission RBAC as PASS with a blanket exact-permission predicate. Treat that as scoped historical test evidence, not an assertion that the audited authorization defects are impossible. The existing matrix contains neither per-journey release SHA nor immutable proof receipt fields. Bind any retained PASS to source/artifact/environment/proof identifiers and invalidate/re-prove affected journeys after the audit repairs. Preserve genuine BLOCKED_* labels; do not relabel provider journeys PASS to simplify the file.
