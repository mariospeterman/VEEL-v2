# Frontend Design System

Status: proposed v2 architecture
Scope: documentation
Last updated: 2026-06-03
Source of truth: yes

This document defines the current locked web design direction.

## Stack truth

- Next.js 16, React 19, TypeScript
- Tailwind CSS v4 is active through `apps/web/app/globals.css` and `apps/web/postcss.config.mjs`
- selected shadcn-style primitives live in `apps/web/components/ui`
- TanStack Query and Zustand are active for API cache and shared shell state
- Livepeer React is available for custom live/VOD playback where the hosted provider player is not enough
- custom CSS tokens in `apps/web/app/globals.css` remain the product design source of truth
- route-owned React surfaces in `apps/web/features/*`

## Current Primitive Boundary

The frontend migration stack is active. Repeated controls should use:

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

- Login → Age → Wallet
- no extra privacy step
- no final enter step
- wallet step enters the app immediately after complete or skip

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
