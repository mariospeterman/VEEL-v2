# Frontend UI Kit Lock

Status: accepted
Scope: WEVID web/PWA frontend shell, shared primitives, and screen composition
Last updated: 2026-06-19
Source of truth: yes

## Purpose

This file locks the frontend shape before page-by-page polish. A screen may change copy,
data mapping, and local composition, but it should not invent a new shell, button system,
card style, media tile, empty state, error state, navigation model, or provider boundary.

## Approved Shells

- Public landing: `/`, semantic poster-first product story, no app providers and no animation framework; see `landing-page.md`.
- Auth/onboarding: owned by `/` as one modal entry over the landing surface; login authenticates first and unknown identities explicitly transition to onboarding.
- Wallet setup handoff: `/app/wallet` after authenticated app access/remediation; landing wallet controls stay compile-light until provider config is verified.
- Authenticated app: `/app/*`, one `AppShell`, one desktop rail, one top bar, one mobile bottom nav.
- Admin/ops: `/admin`, dense operational layout using the same primitives unless a documented admin primitive is added.

## Approved Primitives

Use `packages/ui` through `apps/web/app/ui.tsx` for:

- `Button`, `ButtonLink`, `IconButton`
- `Card`, `MetricCard`
- `PageHeader`
- `StatusPill`
- `Avatar`
- `Field`, `Input`, `Textarea`
- `Tabs`
- `MediaTile`
- `EmptyState`, `ErrorState`
- `Fact`

New primitives belong in `packages/ui` first. Page-local components are allowed only for
domain-specific composition, not for restyling core controls.

## App Shell Rules

- Primary app routes are only `/app/home`, `/app/bits`, `/app/create`, `/app/messages`, `/app/profile`.
- Secondary actions are only `/app/wallet`, `/app/subscriptions`, `/app/settings`.
- Desktop uses the left rail and top action bar.
- Mobile uses the bottom nav and hides secondary top action links when space is tight.
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

- Wallet SDKs must not load in root layout or first paint.
- Landing may render explicit wallet/onboarding controls, but embedded-wallet runtime stays behind `NEXT_PUBLIC_EMBEDDED_WALLET_RUNTIME_ENABLED=true` until provider setup is staging-verified.
- Wallet provider runtime loads only after explicit wallet setup intent and verified public provider config.
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
