# Veel V2 Landing Page GSAP Scope

Status: accepted
Scope: public landing first-viewport scroll animation
Last updated: 2026-06-19
Source of truth: yes, for GSAP scope only

Owns:
- GSAP is allowed for the public landing page first viewport scroll choreography.
- GSAP must stay out of authenticated app screens unless a later ADR expands scope.

Defers to:
- `frontend/design-system.md`
- `frontend/component-map.md`
- `route-map.md`
- current `apps/web/app/landing-experience.tsx`

Does not own:
- provider behavior, route ownership, backend contracts, wallet behavior, or app-screen motion rules

Launch scope:
- first public landing viewport scroll animation only

Non-goals:
- a second design system
- animated route shells
- app feed, messaging, wallet, admin, or creator workflow animation frameworks

The landing page can use GSAP for the first-screen scroll experience because that is a
specific brand/design decision, not general frontend infrastructure. Keep the dependency
landing-scoped, lazy where practical, and covered by a no-JS or reduced-motion fallback.
All landing UI still uses the shared Veel UI primitives and provider-safe onboarding
boundaries. Any broader GSAP usage needs a new ADR that accepts bundle impact,
accessibility behavior, and ownership.
