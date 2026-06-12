# Frontend Design System

Status: accepted
Scope: documentation
Last updated: 2026-06-12
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
- selected shadcn-style primitives under `apps/web/components/ui`
- TanStack Query for server state and Zustand/local state for UI state
- Livepeer React/player primitives where they reduce custom live/VOD code
- custom CSS tokens under the v2 app styles are the product design source of truth
- route-owned React surfaces under `apps/web/features/*`

## Primitive Boundary

Repeated controls should use:

- `Button` / `buttonVariants`
- `Sheet`
- `Input`, `Textarea`, `Select`
- `Checkbox`
- `SegmentedControl` / `SegmentedButton`

Native controls are allowed when the browser behavior is the product behavior, currently file inputs and media-editor range sliders.

Product CSS should own layout, media-stage composition, route-specific density, and specialized capture/playback affordances. It should not reintroduce generic button, sheet, segmented-control, or form control systems.

Rules:

- do not migrate for fashion alone
- do not let `shadcn/ui` redefine the product look
- keep Veel tokens, spacing, motion, and chrome rules product-owned
- delete unused CSS only after `rg` confirms the selector is no longer referenced

## Product direction

- content first
- mobile native first
- desktop adaptive
- flatter, lighter, less boxed
- premium dark base with clean light-mode equivalent
- Solana-inspired accents used with restraint

## Mockup-Derived Principles

Reference mockups were inspected from `/Users/maki/Desktop/Veel.v2-Mockups`
on 2026-06-12. They are inspiration only; production UI must still follow the
Veel route map, contracts, provider boundaries, and real workflows.

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

Do not copy raw mockup assets or layout one-to-one unless a project-owned asset
is intentionally added and documented. Extract spacing, density, hierarchy, and
interaction ideas, then adapt them to implemented routes and backend-owned
capabilities.

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
- desktop left rail stays thin, hover-expandable, and quiet at rest
- mobile dock stays light and integrated
- content is always the visual center of gravity
- detail state stays layered in sheets, drawers, or overlays

## Surface rules

### Landing

- headline + subheadline + proof
- visual storytelling over text blocks
- one-screen desktop panels

### Onboarding

- public teaser or referral capture first
- identity with email/social/passkey or external wallet
- embedded wallet created/loaded or native wallet linked
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
