# WeVid Production Documentation

Status: accepted
Scope: canonical architecture, current implementation truth, and production completion plan
Last updated: 2026-11-05
Source of truth: yes

Owns:
- canonical v2 docs navigation and source-of-truth matrix

Defers to:
- OpenAPI, immutable database migrations, ADRs, and official provider docs where narrower

Does not own:
- implementation details, provider payload shapes, migrations

Launch scope:
- developer orientation and canonical build-source hierarchy

Non-goals:
- parallel doc families or historical lessons

This folder is the canonical WeVid engineering pack. Technical `veel` identifiers remain where compatibility requires them; public product language is WeVid.

Next planned production slice: **Convergence 09E — Cloud and provider acceptance**. Stable merged status
is in `current-implementation-status.md` and `production-status.json`; transient branch and
pull-request truth comes from GitHub's single `wevid-active-slice` label.

## What This Pack Is

- A complete standalone plan for a new `veel-v2` repo.
- Provider-first architecture.
- Backend business truth with minimal custom infrastructure.
- Frontend native PWA UX plan.
- Noncustodial payments, embedded wallets, memberships, referrals, media, live, messages, Mutuals, Event Access, AI/MCP, compliance, admin, and ops.

## What This Pack Is Not

- Not a description of the historical context.
- Not a copy checklist.
- Not an instruction to bulk-copy historical code.
- Not an in-place upgrade plan.
- Not a second source of truth beside OpenAPI, the immutable migration chain, ADRs, and this docs pack.

## Source-Of-Truth Matrix

| Decision area | Source of truth | Implementation dependency |
| --- | --- | --- |
| Current system architecture | `app-architecture.md`, ADRs, and narrow implemented-domain docs | Runtime/module inventories and tests must match this map. `full-platform-blueprint.md` and `diagrams.md` are orientation aids, not competing authorities. |
| Product/platform behavior | `product-flows.md` and narrow product docs | Tests and route screens must match the applicable narrow domain document. |
| API shape | `packages/contracts/openapi.yaml` | Generated client and Fastify schemas must match exactly. |
| Frontend routes/components/providers/state | `frontend-architecture.md` and `route-map.md`; narrow landing/design/copy/motion/release docs only for their named domains | Source paths and tests establish implementation. `apps/web/public/mockup/*` is visual/historical reference only and cannot define routes, workflows, provider rules, or business truth. |
| Database shape | Ordered immutable files in `packages/database/migrations/` | Migration checks and real-Postgres repository/API tests prove the resulting schema. `schema-blueprint.sql` is retained historical planning material only. |
| Money/access/referral/tax truth | `liability-compliance-audit.md`, `payments-and-monetisation.md`, `business-monetisation.md`, `noncustodial-money-compliance.md`, `compliance/dac7-dac8-vat-system.md`, OpenAPI | Backend owns final state; frontend is UX/cache only. |
| Payment/access/reporting/bookkeeping truth | `business-monetisation.md`, `liability-compliance-audit.md`, `compliance/dac7-dac8-vat-system.md`, OpenAPI, immutable migrations | Blockchain = payment truth; entitlements = access truth; compliance ledger = reporting truth; accounting integration = bookkeeping truth. No duplicate authority. |
| Native creator commerce | `business-monetisation.md`, `payments-and-monetisation.md`, `providers/provider-map.md`, ADR 0002 | WeVid owns Product Offers and lightweight Orders/Fulfillment. The isolated exact-pinned `@solana/pay` codec provides transaction-request/QR interoperability only; Commerce Kit is retired and no full commerce engine is canonical. |
| Provider boundaries | `providers/provider-map.md`, provider-specific docs, ADRs | Use official provider docs/SDKs first; adapters hide secrets. |
| Universal identity and onboarding | `embedded-wallet-onboarding.md`, `auth-supabase-realtime.md`, `providers/identity-provider-wiring.md` | One WeVid user/profile; three visible steps; Privy or external wallet converge on one backend session; Supabase recovery is optional. |
| Security/compliance | compliance docs, `safety-admin-ai.md`, ADRs | Age, moderation, audit, and privacy rules block launch if incomplete. |
| Admin/ops | `admin-operations-dashboard.md` | Every launch slice needs admin visibility where relevant. |
| AI/MCP | `ai-mcp-use-cases.md`, `product/mcp-profile-bridge.md`, `safety-admin-ai.md` | Permissioned tools only; no spending/publishing/messaging without confirmation. |

The older Veel repository is reference-only. It can inform lessons and test ideas, but it must not override this matrix, contracts, schema, ADRs, or official provider docs.

## Start Here

1. [Current implementation status](current-implementation-status.md)
2. [Build plan](build-plan.md)
3. [App architecture](app-architecture.md)
4. [Full platform orientation blueprint](full-platform-blueprint.md)
5. [Stack decision](stack-decision.md)
6. [ADR: Fastify and Supabase decision](adr/0001-fastify-supabase-decision.md)
7. [ADR: 2026 provider decisions](adr/0002-provider-decisions-2026.md)
8. [ADR: provider-native media safety and consent](adr/0003-provider-native-media-safety.md)
9. [ADR: independent eligibility authorities](adr/0004-independent-eligibility-authorities.md)
8. [Route map](route-map.md)
9. [Contracts and database authority guide](contracts-and-schema.md)
10. [Infrastructure and research decisions](infra-decisions.md)
11. [Render-safe diagrams](diagrams.md)
12. [Add keys and test the core app](add-keys-and-test-core-app.md)

## Product And UX

- [SFW publishing and moderation](sfw-publishing-and-moderation.md)
- [Universal composer](product/universal-composer.md)
- [Lifecycle auth and analytics surfaces](product/lifecycle-auth-and-analytics-surfaces.md)
- [Consumer social experience](product/consumer-social-experience.md)
- [Remote MCP profile bridge](product/mcp-profile-bridge.md)
- [MCP media and provenance bridge](product/mcp-media-provenance-bridge.md)
- [Enterprise managed creators](enterprise-managed-creators.md)

12. [Product flows](product-flows.md)
13. [Mutuals architecture](product/mutuals.md)
14. [Event Access architecture](product/event-access.md)
15. [Frontend architecture](frontend-architecture.md)
16. [Native UI, screens, gestures, and motion](native-ui-ux-screens.md)
17. [Public landing](landing-page.md)
18. [Recommendation and discovery](recommendation-discovery.md)
19. [Profile, activity, badges, and ranking](profile-activity-ranking.md)
20. [Engagement strategy](engagement-strategy.md)
21. [Design system](frontend/design-system.md)
22. [Component map](frontend/component-map.md)
23. [UI kit lock](frontend/ui-kit-lock.md)
24. [Copy system](frontend/copy-system.md)
25. [Motion system](frontend/motion-system.md)
- [Frontend release readiness](frontend-release-readiness.md)

## Backend, Data, Auth, And Realtime

25. [Fastify backend architecture](backend-fastify-architecture.md)
26. [Supabase auth and realtime architecture](auth-supabase-realtime.md)
27. [Embedded wallet onboarding](embedded-wallet-onboarding.md)
28. [Data model](data-model.md)
29. [Realtime, messages, and activity](realtime-messages-activity.md)

## Money, Providers, Safety, And Admin

30. [Payments and monetisation](payments-and-monetisation.md)
31. [Business monetisation](business-monetisation.md)
32. [Noncustodial money and compliance boundary](noncustodial-money-compliance.md)
33. [Liability, compliance, and monetisation audit](liability-compliance-audit.md)
34. [Provider map](providers/provider-map.md)
35. [Media and live providers](media-live-providers.md)
36. [Identity provider wiring](providers/identity-provider-wiring.md)
37. [Content protection](providers/content-protection.md)
38. [Safety, admin, and AI/MCP](safety-admin-ai.md)
39. [AI/MCP practical use cases](ai-mcp-use-cases.md)
40. [MCP staging proof](mcp-staging-proof.md)
41. [Admin and operations dashboard](admin-operations-dashboard.md)
42. [Adult content compliance](compliance/adult-content-compliance.md)
43. [Age/KYC jurisdictions and provider waterfall](compliance/age-kyc-jurisdictions.md)
44. [DAC7, DAC8/CARF, VAT/MWST system](compliance/dac7-dac8-vat-system.md)

## Infrastructure And Execution

45. [Infrastructure and research decisions](infra-decisions.md)
46. [Deployment topology](deployment-topology.md)
47. [Slice workflow](slice-workflow.md)
48. [Production branch inventory](production-branch-inventory.md)
49. [Production dependency security status](dependency-security-status.md)
50. [Provider setup and demo-data runbook](operator/provider-setup-and-demo-data.md)
51. `staging-evidence/` for redacted provider proof tied to a commit and environment

## How To Use In A New Repo

1. Open this repository as the current implementation workspace.
2. Use this index to route to the narrow authority; do not treat every accepted document as an equal source of truth.
3. Keep `AGENTS.md`, `CLAUDE.md`, and `.cursor/rules/veel-v2.mdc` aligned with this index.
4. Create clean workspace tooling, `.gitignore`, `.cursorignore`, `.env.example`, and CI files from these docs.
5. Install GStack only after this folder and repo rules are present.
6. Start with [Current implementation status](current-implementation-status.md) and [Build plan](build-plan.md), then follow the next approved slice.

## Build From These Docs

The intended core build order is:

```text
Docs/ADRs
  -> contracts
  -> database
  -> Fastify API
  -> worker
  -> Next PWA shell
  -> contracts/security boundary
  -> three-step Privy/external-wallet onboarding + optional recovery
  -> Home/media
  -> payments/access/referrals
  -> providers/media/live
  -> messages/activity
  -> admin/ops
  -> Event Access
  -> conditional/post-core Mutuals, physical commerce, adult live, and AI/MCP
```

Every production slice must include contracts, migrations, tests, provider boundary checks, frontend smoke coverage, and admin/ops visibility where relevant.

## Diagram Rendering

Use [Render-safe diagrams](diagrams.md) when reviewing in Cursor, VS Code, terminals, or any Markdown renderer without Mermaid support. Detailed docs may include Mermaid source for Mermaid-enabled previews, but `diagrams.md` is the reliable visual map.
