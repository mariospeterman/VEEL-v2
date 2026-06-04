# Veel V2 New-Build Documentation Pack

Status: accepted
Scope: complete standalone Veel v2 build instructions
Last updated: 2026-06-03
Source of truth: yes

Owns:
- canonical v2 docs navigation and source-of-truth matrix

Defers to:
- OpenAPI, schema blueprint, ADRs, provider docs where narrower

Does not own:
- implementation details, provider payload shapes, migrations

Launch scope:
- developer orientation and canonical build-source hierarchy

Non-goals:
- parallel doc families or historical lessons

This folder is the canonical new-build pack. It is intentionally self-contained so a developer can build Veel v2 from these docs without reading any older repository.

## What This Pack Is

- A complete standalone plan for a new `veel-v2` repo.
- Provider-first architecture.
- Backend business truth with minimal custom infrastructure.
- Frontend native PWA UX plan.
- Noncustodial payments, embedded wallets, subscriptions, referrals, media, live, messages, dating, events, AI/MCP, compliance, admin, and ops.

## What This Pack Is Not

- Not a description of the historical context.
- Not a copy checklist.
- Not an instruction to bulk-copy historical code.
- Not an in-place upgrade plan.
- Not a second source of truth beside OpenAPI, schema, ADRs, and this docs pack.

## Source-Of-Truth Matrix

| Decision area | Source of truth | Implementation dependency |
| --- | --- | --- |
| Product/platform behavior | `full-platform-blueprint.md`, `product-flows.md`, product docs | Tests and route screens must match these docs. |
| API shape | `packages/contracts/openapi.yaml` | Generated client and Fastify schemas must match exactly. |
| Frontend routes/screens/gestures | `route-map.md`, `native-ui-ux-screens.md`, frontend docs | Next routes encode route state only. |
| Database shape | `packages/database/schema-blueprint.sql` until migrations exist | Migrations must be derived slice-by-slice from the blueprint. |
| Money/access/referral truth | `payments-and-monetisation.md`, `business-monetisation.md`, `noncustodial-money-compliance.md`, OpenAPI | Backend owns final state; frontend is UX/cache only. |
| Provider boundaries | `providers/provider-map.md`, provider-specific docs, ADRs | Use official provider docs/SDKs first; adapters hide secrets. |
| Security/compliance | compliance docs, `safety-admin-ai.md`, ADRs | Age, moderation, audit, and privacy rules block launch if incomplete. |
| Admin/ops | `admin-operations-dashboard.md` | Every launch slice needs admin visibility where relevant. |
| AI/MCP | `ai-mcp-use-cases.md`, `safety-admin-ai.md` | Permissioned tools only; no spending/publishing/messaging without confirmation. |

The older Veel repository is reference-only. It can inform lessons and test ideas, but it must not override this matrix, contracts, schema, ADRs, or official provider docs.

## Start Here

1. [Build plan](build-plan.md)
2. [Full platform blueprint](full-platform-blueprint.md)
3. [App architecture](app-architecture.md)
4. [Stack decision](stack-decision.md)
5. [ADR: Fastify and Supabase decision](adr/0001-fastify-supabase-decision.md)
6. [ADR: 2026 provider decisions](adr/0002-provider-decisions-2026.md)
7. [Route map](route-map.md)
8. [Initial contracts and schema](contracts-and-schema.md)
9. [Infrastructure and research decisions](infra-decisions.md)
10. [Render-safe diagrams](diagrams.md)

## Product And UX

11. [Product flows](product-flows.md)
12. [Dating Mode architecture](product/dating-mode.md)
13. [Events and ticketing architecture](product/events-ticketing.md)
14. [Frontend architecture](frontend-architecture.md)
15. [Native UI, screens, gestures, and motion](native-ui-ux-screens.md)
16. [Landing page and GSAP blueprint](landing-page-gsap.md)
17. [Recommendation and discovery](recommendation-discovery.md)
18. [Profile, activity, badges, and ranking](profile-activity-ranking.md)
19. [Engagement strategy](engagement-strategy.md)
20. [Design system](frontend/design-system.md)
21. [Component map](frontend/component-map.md)
22. [Copy system](frontend/copy-system.md)
23. [Motion system](frontend/motion-system.md)

## Backend, Data, Auth, And Realtime

24. [Fastify backend architecture](backend-fastify-architecture.md)
25. [Supabase auth and realtime architecture](auth-supabase-realtime.md)
26. [Embedded wallet onboarding](embedded-wallet-onboarding.md)
27. [Data model](data-model.md)
28. [Realtime, messages, and activity](realtime-messages-activity.md)

## Money, Providers, Safety, And Admin

29. [Payments and monetisation](payments-and-monetisation.md)
30. [Business monetisation](business-monetisation.md)
31. [Noncustodial money and compliance boundary](noncustodial-money-compliance.md)
32. [Provider map](providers/provider-map.md)
33. [Media and live providers](media-live-providers.md)
34. [Identity provider wiring](providers/identity-provider-wiring.md)
35. [Content protection](providers/content-protection.md)
36. [Safety, admin, and AI/MCP](safety-admin-ai.md)
37. [AI/MCP practical use cases](ai-mcp-use-cases.md)
38. [Admin and operations dashboard](admin-operations-dashboard.md)
39. [Adult content compliance](compliance/adult-content-compliance.md)
40. [Age/KYC jurisdictions and provider waterfall](compliance/age-kyc-jurisdictions.md)

## Infrastructure And Execution

41. [Infrastructure and research decisions](infra-decisions.md)
42. [Deployment topology](deployment-topology.md)
43. [Slice workflow](slice-workflow.md)

## How To Use In A New Repo

1. Open this repository as the new build scaffold.
2. Keep `docs/v2-new-build/` as the canonical architecture pack until implementation moves docs into final folders.
3. Keep `AGENTS.md`, `CLAUDE.md`, and `.cursor/rules/veel-v2.mdc` aligned with this index.
4. Create clean workspace tooling, `.gitignore`, `.cursorignore`, `.env.example`, and CI files from these docs.
5. Install GStack only after this folder and repo rules are present.
6. Start with [Build plan](build-plan.md), then implement the first 10 tickets listed there.

## Build From These Docs

The intended build order is:

```text
Docs/ADRs
  -> contracts
  -> database
  -> Fastify API
  -> worker
  -> Next PWA shell
  -> auth + embedded/external wallet
  -> Home/media
  -> payments/access/referrals
  -> providers/media/live
  -> messages/activity
  -> admin/ops
  -> events/dating/AI
```

Every production slice must include contracts, migrations, tests, provider boundary checks, frontend smoke coverage, and admin/ops visibility where relevant.

## Diagram Rendering

Use [Render-safe diagrams](diagrams.md) when reviewing in Cursor, VS Code, terminals, or any Markdown renderer without Mermaid support. Detailed docs may include Mermaid source for Mermaid-enabled previews, but `diagrams.md` is the reliable visual map.
