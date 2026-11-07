# Frontend Component Map

Status: accepted
Scope: frontend component ownership pointer
Last updated: 2026-11-04
Source of truth: no; `frontend-architecture.md` owns the current route/component/provider/state map

## Purpose

This file remains as a stable link for older reviews. It does not maintain a second route or
component inventory.

Use:

- `frontend-architecture.md` for current route, component, provider, API-client, and state ownership
- `route-map.md` for canonical URLs and access semantics
- `frontend/design-system.md` for implemented shared primitives and visual tokens
- `landing-page.md` for the public entry surface
- `frontend-release-readiness.md` for browser and launch evidence

The checked-in source under `apps/web/app`, `apps/web/src`, and `packages/ui`, together with its
tests, determines implementation status. Old component names, proposed `features/*` paths, and
mockup route names are not implementation instructions.
