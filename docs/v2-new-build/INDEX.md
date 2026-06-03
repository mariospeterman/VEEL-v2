# Veel V2 New-Build Documentation Pack

Status: proposed new-repo source pack
Scope: complete greenfield Veel v2 build instructions
Last updated: 2026-06-03
Source of truth: yes for the proposed `veel-v2` repo

This folder is the clean new-build pack. It is intentionally self-contained so a developer can build Veel v2 from it without reading stale prototype notes.

## What This Pack Is

- A complete greenfield plan for a new `veel-v2` repo.
- Provider-first architecture.
- Backend business truth with minimal custom infrastructure.
- Frontend native PWA UX plan.
- Noncustodial payments, embedded wallets, subscriptions, referrals, media, live, messages, dating, events, AI/MCP, compliance, admin, and ops.

## What This Pack Is Not

- Not a description of the previous prototype implementation.
- Not a porting checklist.
- Not an instruction to bulk-copy prototype code.
- Not a migration-in-place plan.

## Start Here

1. [Build plan](build-plan.md)
2. [Full platform blueprint](full-platform-blueprint.md)
3. [App architecture](app-architecture.md)
4. [Stack decision](stack-decision.md)
5. [ADR: Fastify and Supabase proposal](adr/0001-fastify-supabase-proposal.md)
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
31. [Provider map](providers/provider-map.md)
32. [Media and live providers](media-live-providers.md)
33. [Identity provider wiring](providers/identity-provider-wiring.md)
34. [Content protection](providers/content-protection.md)
35. [Safety, admin, and AI/MCP](safety-admin-ai.md)
36. [AI/MCP practical use cases](ai-mcp-use-cases.md)
37. [Admin and operations dashboard](admin-operations-dashboard.md)
38. [Adult content compliance](compliance/adult-content-compliance.md)
39. [Age/KYC jurisdictions and provider waterfall](compliance/age-kyc-jurisdictions.md)

## Infrastructure And Execution

40. [Infrastructure and research decisions](infra-decisions.md)
41. [Deployment topology](deployment-topology.md)
42. [Slice workflow](slice-workflow.md)

## How To Use In A New Repo

1. Create `veel-v2`.
2. Copy this entire `docs/v2-new-build/` folder into `docs/`.
3. Rename it to `docs/architecture/` or keep it as `docs/v2-new-build/`.
4. Copy `AGENTS.md` and rewrite it for the new stack.
5. Create clean `.gitignore`, `.cursorignore`, `.env.example`, and workspace files.
6. Install GStack only after this folder and repo rules are present.
7. Start with [Build plan](build-plan.md), then implement the first 10 tickets listed there.

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
