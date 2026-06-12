# Frontend Component Map

Status: accepted
Scope: documentation
Last updated: 2026-06-12
Source of truth: yes

Owns:
- component map decisions for its named domain

Defers to:
- INDEX.md, route-map.md, OpenAPI, schema blueprint, and ADRs where narrower

Does not own:
- unrelated domains, implementation shortcuts, provider secrets, or hidden source-of-truth rules

Launch scope:
- accepted v2 launch or phased behavior stated in this document

Non-goals:
- historical-context inference, duplicate systems, and unapproved provider/product expansion

This document describes current v2 route and component ownership.

## Routes

### `app/page.tsx`

- authenticated mixed feed
- backend feed/search projections through the typed web API helper
- fail-closed API-unavailable state when local/staging API is absent

### `app/enter/page.tsx`

- onboarding entry
- Supabase magic-link UI
- profile-completion mutation UI
- external wallet challenge handoff UI
- backend session/readiness projection

### `app/layout.tsx`

- root app shell, styles, metadata, and provider boundaries

### `app/age/page.tsx`

- provider-backed age status
- provider session start panel

### `app/create/page.tsx`

- creator draft workspace
- backend content draft and metadata mutation handoff
- Bunny upload session creation and TUS upload state
- publish submission handoff without client-side moderation truth

### `app/content/[contentId]/page.tsx`

- media detail projection
- backend-issued playback resource rendering
- unlock-intent and wallet transaction request panel

### `app/live/[liveRoomId]/page.tsx`

- live room projection
- Livepeer playback resource rendering
- live pass payment handoff panel

### `app/messages/page.tsx`

- conversation, inbox, and activity shell
- paid-message handoff where backend projects it

### `app/profile/page.tsx`

- managed profile
- own badges, verification status, activity, wallet/payment stats

### `app/profile/[handle]/page.tsx`

- contextual creator route
- public creator badges, creator media, follow/support/subscribe actions

### `app/discover/page.tsx`

- search and discovery surface
- creator, hashtag, event, live, and safe category discovery
- never a redirect alias to Bits

### Protected operations routes

- `app/wallet/page.tsx`: wallet projections, funding receipts, transaction state
- `app/activity/page.tsx`: activity projection
- `app/subscriptions/page.tsx`: backend-owned subscription authorization and cancellation controls
- `app/event-access/[eventId]/page.tsx`: Event Access pass projection and purchase handoff
- `app/passes/page.tsx`: pass inventory projection
- `app/mutuals/page.tsx` and `app/mutuals/feed/page.tsx`: backend-owned Mutuals mode/projection
- `app/studio/page.tsx`: Studio/org workspace projection
- `app/admin/page.tsx`: admin/ops projections and safe mutation panels
- `app/settings/page.tsx`: preference projections and explicit mutations
- `app/assistant/page.tsx`: capability-gated AI/MCP surface only; not primary mobile navigation

## Feature slices

### Shared route helpers

- `src/api-client.ts` owns typed server/read API calls and attaches the current
  Supabase access token when available.
- `src/api-mutations.ts` owns typed browser mutations, Idempotency-Key creation,
  and browser token attachment.
- `src/supabase/*` owns SSR/browser Supabase setup, auth state, cookie refresh,
  and guarded E2E auth helpers.

### Route-local panels

- Use route-local panels when the component is tightly coupled to one workflow:
  `enter/*panel.tsx`, `create/create-workspace.tsx`,
  `content/[contentId]/content-unlock-panel.tsx`,
  `live/[liveRoomId]/live-pass-panel.tsx`,
  `subscriptions/*panel.tsx`, and admin row/panel files.
- Promote shared components only after more than one route needs the same
  behavior and contract.

### UI primitives

- Shared controls live under `components/ui`.
- Use project primitives for buttons, sheets, inputs, textareas, selects,
  checkboxes, and segmented controls.
- Native file/range inputs remain only where required by browser upload/media
  behavior.

### Smoke and E2E harness

- `tests/smoke` owns browser coverage for shell/projection behavior.
- `tests/smoke/auth-happy-path.spec.ts` owns the local authenticated happy path:
  enter -> profile -> wallet -> age -> home -> create -> unlock.
- The auth smoke harness uses a local mock API on `127.0.0.1:4000`, a guarded
  non-production `veel_e2e_access_token` cookie, and serialized Playwright
  workers so other smoke specs do not observe the mock backend by accident.
- `NEXT_PUBLIC_ENABLE_E2E_AUTH` is test-only and must remain ineffective in
  production.
