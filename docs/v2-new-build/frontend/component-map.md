# Frontend Component Map

Status: current
Scope: documentation
Last updated: 2026-05-29
Source of truth: yes

This document describes the current route ownership.

## Routes

### `app/page.tsx`

- landing
- panel scroll behavior
- CTA handoff

### `app/enter/page.tsx`

- onboarding entry
- server-passed mode param

### `app/app/layout.tsx`

- persistent protected shell

### `app/app/home/page.tsx`

- relationship feed

### `app/app/bits/page.tsx`

- dedicated video feed
- initial mode from search params

### `app/app/create/page.tsx`

- creator workflow

### `app/app/messages/page.tsx`

- conversation, inbox, and activity shell

### `app/app/profile/page.tsx`

- managed profile
- own badges, verification status, activity, wallet/payment stats

### `app/app/profile/[handle]/page.tsx`

- contextual creator route
- public creator badges, creator media, follow/support/subscribe actions

### `app/app/discover/page.tsx`

- redirect alias to `Bits`

## Feature slices

### `features/landing`

- landing page
- visual storytelling panels
- captures inbound `?ref=` attribution before onboarding/login

### `features/onboarding`

- locked 3-step onboarding UI
- uses shared button and age-provider selection primitives

### `features/app-shell`

- app chrome
- icons
- shared primitive-backed stage overlay
- creator module
- creator profile cache
- home surface
- bits surface
- create surface
- messages surface
- profile surface
- creator route surface
- stream surface
- no raw lowercase `<button>` elements in app-shell route surfaces; use `Button` or link variants
- native file/range inputs remain only where required by browser media/upload behavior

### `features/home`

- API client
- auth state
- age state
- wallet-link state
- shell data hydration
- referral link creation and local `?ref=` attribution capture
