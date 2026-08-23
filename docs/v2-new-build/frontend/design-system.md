# Frontend Design System

Status: accepted
Scope: documentation
Last updated: 2026-08-15
Source of truth: yes

Owns:
- design system decisions for its named domain

Defers to:
- INDEX.md, route-map.md, OpenAPI, schema blueprint, and ADRs where narrower

Does not own:
- unrelated domains, implementation shortcuts, provider secrets, or hidden source-of-truth rules

Launch scope:
- accepted v2 launch or phased behavior stated in this document

Non-goals:
- historical-context inference, duplicate systems, and unapproved provider/product expansion

This document defines the locked v2 web design direction.

## Stack truth

- Next.js 16, React 19, TypeScript
- Tailwind CSS v4 with product-owned tokens
- shared project primitives exported from `packages/ui`
- TanStack Query for server state and Zustand/local state for UI state
- Livepeer React/player primitives where they reduce custom live/VOD code
- custom CSS tokens under the v2 app styles are the product design source of truth
- route-owned React surfaces under `apps/web/app/*`, with tightly scoped panels colocated with their routes

## Primitive Boundary

Repeated controls should use:

- `Button`, `ButtonLink`, and `buttonClassName`
- `Card`, `PageHeader`, `EmptyState`, `StatusPill`, `Fact`, and `MetricCard`
- `Sheet`
- `Input`, `Textarea`, `Select`
- `Checkbox`
- `SegmentedControl` / `SegmentedButton`

Native controls are allowed when the browser behavior is the product behavior, currently file inputs and media-editor range sliders.

Product CSS should own layout, media-stage composition, route-specific density, and specialized capture/playback affordances. It should not reintroduce generic button, sheet, segmented-control, or form control systems.

`CheckoutSheet` is the single reusable one-time purchase presentation over the shared `Sheet`, button, form, status, and error primitives. Product-specific wrappers may supply safe display context for Support, unlock, creator media offers, accepted structured requests, Event Access, paid live, or a future physical Product Offer, but must not fork the wallet handoff or payment-state UI. The sheet keeps content context visible, presents one primary CTA, exact total/asset and plain-language terms, uses the already-mounted Privy/external-wallet boundary, and offers an accessible high-contrast QR plus ordinary `Open wallet` fallback. It never renders raw HTML from QR/provider output or exposes split internals, atomic units, references, capability tokens, provider endpoints, or shipping/private identity data.

Rules:

- do not migrate for fashion alone
- do not let `shadcn/ui` redefine the product look
- keep WEVID tokens, spacing, motion, and chrome rules product-owned
- delete unused CSS only after `rg` confirms the selector is no longer referenced

## Product direction

- content first
- mobile native first
- desktop adaptive
- flatter, lighter, less boxed
- premium dark base with clean light-mode equivalent
- Solana-inspired accents used with restraint

## Mockup-Derived Principles

Reference mockups now live in the repo under
`apps/web/public/mockup/`, with the local UI/UX contract at
`apps/web/public/mockup/design.md`. The WEVID logo assets live at
`apps/web/public/Logo-Dark.png` and
`apps/web/public/Logo-Light.png`.

These checked-in assets are the visual reference for frontend refinement:
screen composition, density, navigation hierarchy, dark/light tone,
media-first layout, and premium native-app feel should match the mockups as
closely as the implemented routes and backend-owned workflows allow.
Production UI must still follow the WEVID route map, OpenAPI contracts,
provider boundaries, and real workflow states.

Useful principles to carry forward:

- fixed quiet shell with desktop left rail, compact top status/actions, and a
  mobile bottom dock
- media-first center of gravity with creator identity, access state, and next
  action attached to the active content
- guided onboarding/workspace patterns for identity, profile, wallet, age, and
  creator setup
- create flow as a studio workspace: preview first, steps around it, explicit
  save/upload/publish controls, and no fake editor tools
- profile as identity plus readiness/activity dashboard, not a marketing page
- restrained glass, borders, and depth; premium, calm, studio-grade surfaces
  instead of crypto-casino color, game-like dashboards, or generic AI chrome
- secondary tools, including Assistant, live in menus, Studio/Profile context,
  or admin surfaces; they are not primary mobile navigation items

Do not introduce a second design system. Use `packages/ui` primitives for repeated controls and `apps/web/public/mockup/design.md`
as the implementation contract, reuse the project-owned WEVID logo assets, and
adapt each mockup to functional routes with real data, auth gates, loading
states, error states, and server-owned access/payment/compliance truth.

Every frontend route should be checked against the nearest mockup before UI
changes are accepted:

- app shell/navigation: `app shell - navigation.png`
- Home: `home - mixed feed.png`
- Bits/Discover: `bits - imersive viwer.png` and `discovery - search overlay.png`
- Create: `create - upload workspace.png`
- Messages: `message - share flow.png`
- Profile: `profile - activity.png`
- Wallet/activity: `wallet - receipts.png`
- Subscriptions: `subscriptions - plans - membershps (tires).png`
- Live/Event Access: `live - event access.png`
- Mutuals: `mutuals - connection flow.png`
- Studio/enterprise/admin: `studio dashboard.png`,
  `enterprise dashboard.png`, and `admin dashboard.png`
- Settings/privacy: `settings privacy.png`
- Assistant/MCP: `ai assistant - MCP.png`

## Color system

Base:

- deep graphite / midnight background
- elevated navy support layers
- light mode keeps the same structure with softer contrast

Accent palette:

- primary violet
- action mint
- supporting cyan
- warning amber
- danger rose-red

Rules:

- green and violet carry the brand
- amber and red are reserved for warnings and errors
- gradients are for hero moments and primary CTAs only
- avoid crypto-neon overload

## Typography

- body: `Manrope`
- display: `Space Grotesk`

Rules:

- the shell avoids large explanatory text blocks
- display type is for headlines, content titles, and key numbers
- body copy stays short and direct

## Control rules

Primary controls:

- one primary action per area
- secondary actions quieter
- ghost actions for navigation or low emphasis

Use:

- segmented controls
- compact icon rails
- on-demand sheets / drawers / overlays
- inline status where it directly supports the next action

Do not use:

- passive chips repeated across the shell
- large status stacks
- equal-weight buttons competing for attention

## Shell rules

- the shell stays pinned
- content swaps inside the shell
- desktop left rail uses the canonical primary nav: Home, Bits, Create,
  Messages, Profile
- mobile dock uses exactly the same five primary items
- secondary actions live in the top action area or menus: Wallet,
  Subscriptions, Studio, Settings, Assistant, and future admin/enterprise
  affordances where role-gated
- content is always the visual center of gravity
- detail state stays layered in sheets, drawers, or overlays
- top search must navigate to a real discovery/search route until a full search
  overlay is wired

## Surface rules

### Landing

- headline + subheadline + proof
- visual storytelling over text blocks
- one-screen desktop panels

### Onboarding

- public teaser or referral capture first
- direct external `Connect wallet` action first
- quiet `Create secure WeVid wallet` action only when the embedded provider is configured
- email/social/passkey choices remain inside that provider's official surface after the user selects it
- minimal profile
- age verification
- protected app entry only after wallet path and age verification are complete
- no skip-wallet path into the protected app shell

### Home and Bits

- content app first
- action overlays instead of permanent side panels
- minimal shell text
- creator identity and creator actions stay attached to the active content

### Messages

- inbox first
- no fake thread model
- list remains compact and detail opens on demand

### Profile

- managed tabs read real creator payloads where available
- public and managed profiles share creator truth instead of duplicating concepts

### Profile logic

- one managed profile for the current user
- other creators open contextually as viewer routes

## State And Error Rules

- frontend pages must not surface raw backend/provider error strings such as
  bearer-token failures, SQL/provider messages, stack text, or opaque `HTTP
  <status>` labels to users
- route failures map through the shared web error-state mapper into safe states:
  unauthenticated, forbidden, not found, validation, conflict, rate limited,
  service unavailable, network, and unknown
- developer-only details may be visible in local development for diagnosis, but
  production copy stays user-safe and action-oriented
- authenticated pages that require a session should redirect or render the
  shared auth-required state instead of calling protected feed/search APIs from a
  signed-out Home shell
- empty states must explain what real backend-owned data is missing; they must
  not invent placeholder production data
