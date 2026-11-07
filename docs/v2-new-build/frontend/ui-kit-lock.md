# Frontend UI Kit Lock

Status: accepted
Scope: WEVID web/PWA frontend shell, shared primitives, and screen composition
Last updated: 2026-11-04
Source of truth: yes, only for the implemented shell and shared primitive boundary

## Purpose

This file records the implemented frontend shell and shared primitive boundary. It defers route,
provider, and state ownership to `frontend-architecture.md`.

## Approved Shells

- Public landing: `/`, semantic poster-first product story, no app providers and no animation framework; see `landing-page.md`.
- Auth/onboarding: owned by `/?mode=login` and `/?mode=onboarding` as full-page query-state surfaces; login authenticates first and unknown identities explicitly transition to onboarding.
- Wallet setup handoff: `/app/wallet` after authenticated app access/remediation; landing wallet controls stay compile-light until provider config is verified.
- Authenticated app: `/app/*`, one `AppShell`, one desktop rail, one top bar, one mobile bottom nav.
- Admin/ops: `/admin`, dense operational layout using the same primitives unless a documented admin primitive is added.

## Approved Primitives

Use implemented `packages/ui` exports directly. `apps/web/app/ui.tsx` reexports only its listed
subset and adds safe error/auth states:

- `Button`, `ButtonLink`, `IconButton`
- `Card`, `MetricCard`
- `PageHeader`
- `StatusPill`
- `Avatar`
- `Field`, `Input`, `Textarea`
- `Tabs`
- `MediaTile`
- `EmptyState`; `ErrorState` is app-owned
- `Fact`

New repeated primitives belong in `packages/ui` first. Page-local components are allowed only for
domain-specific composition. Do not claim a Sheet, Select, Checkbox, segmented control, or checkout
primitive exists until it is exported and consumers have migrated to it.

## App Shell Rules

- Primary app routes are only `/app/home`, `/app/bits`, `/app/create`, `/app/messages`, `/app/profile`.
- Secondary actions are only `/app/wallet`, `/app/subscriptions`, `/app/settings`.
- Desktop uses the left rail and top action bar.
- Mobile uses the bottom nav plus labelled quick actions and profile/settings destinations; a secondary action may move but must not disappear without an accessible replacement.
- No authenticated app page may render its own primary nav.
- No top-level duplicate app routes may own UI; they must redirect to `/app/*`.
- Top-level `/enter`, `/enter/wallet`, `/activity`, `/assistant`, `/create`, `/discover`, `/messages`, `/settings`, `/studio`, `/subscriptions`, and `/wallet` must not reappear as route owners.
- Landing is dark-only brand identity. Theme toggling belongs inside authenticated app settings if retained for accessibility/user preference.

## Visual Rules

- Cards use `8px` or token radius through `.ui-card`.
- Buttons use `.primary-button`, `.secondary-button`, or `.ghost-button`.
- Icon-only shell controls use lucide icons and stable `44px` hit targets.
- Media surfaces use `MediaTile` or a documented provider player component.
- Empty/error/auth states use shared states and must not render raw backend/provider errors.
- Forms use `Field`, `Input`, `Textarea`, and provider-owned submit behavior.

## Provider Boundary Rules

- Wallet SDKs must not load in the root layout or public first paint.
- Landing may render explicit wallet/onboarding controls, but embedded-wallet runtime stays behind `NEXT_PUBLIC_EMBEDDED_WALLET_RUNTIME_ENABLED=true` until provider setup is staging-verified.
- Landing wallet runtime loads only after explicit authentication intent and verified public provider config.
- `/app/*` mounts its single wallet, Query, and Realtime provider boundary in `app/app/layout.tsx`; contextual routes outside that shell may use one scoped local runtime only when an action requires it.
- Realtime belongs to authenticated app routes, not public routes.
- Provider SDK behavior must follow official provider docs and project ADRs.

## Forbidden Patterns

- Duplicate route-owned app pages outside `/app/*`.
- Page-local button/card/status/error systems.
- Wallet, media, payment, realtime, or auth providers imported in root layout without a route-specific reason.
- Frontend payment/access/compliance business truth.
- Raw provider payloads or raw API failure messages in UI.
- Landing animation dependencies reused in app screens without a new ADR.

## Review Gate

Before polishing a screen:

1. Confirm the screen route owner.
2. Use `AppShell` or the approved public/auth shell.
3. Use existing primitives first.
4. Add missing primitive centrally if needed.
5. Run typecheck and the smoke route that covers the screen.
