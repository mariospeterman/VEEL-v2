# Consumer Social Experience

Status: accepted
Scope: Convergence 06
Last updated: 2026-08-24
Source of truth: product behavior for consumer social and PWA surfaces

## Product Promise

WeVid presents one adaptive consumer app with exactly five primary destinations: Home, Bits, Create,
Messages, and Profile. Search is a genuine secondary destination. People never need to understand
provider names, database state, access enums, playback state, or moderation plumbing to use it.

The public entry remains one **Continue to WeVid** action. A known wallet or linked recovery identity
logs into its existing account. An unknown identity receives an account-not-found transition and sees
the onboarding explanation before account or embedded-wallet creation. Login never creates an account.

## Feed And Bits

- Home is a compact mixed social feed with For you and Following modes plus age-safe content controls.
- Bits is an immersive, snap-scrolling, one-active-item experience with playback, captions, progress,
  creator context, and keyboard/reduced-motion support.
- The action order is always Like, Comment, Save, Share, followed by at most one contextual Support or
  Unlock action. Payment can purchase content access but never visibility or access to a person.
- Consumer copy translates backend states into clear next actions and does not render raw enums.

## Social Actions

- Likes, saves, follows, poll votes, comments, replies, comment likes, mentions, shares, hides, reports,
  blocks, and mutes are server-authorized and rate-limited.
- Replies are one level deep and must target a visible comment on the same content.
- Mentions resolve active profile handles on the backend and exclude either-direction blocked or viewer-muted accounts.
- Internal shares use the canonical consent-safe message authority and its shared-content reference.
- External and copy shares use canonical referral-aware links. Share records never grant access.
- Optimistic UI reconciles to backend results and exposes safe retry messages.

## Search And Discovery

`/app/search` groups creators, content, hashtags, live rooms, and events from the existing deterministic
discover authority. Empty search provides age-safe suggestions; recent queries stay bounded on the
device and never become recommendation truth. Money is not a ranking input.

## Privacy And Account Control

Settings exposes current sessions, wallets, recovery, notification and feed preferences, Mutuals,
blocks, mutes, data export, and deletion request state. Export and deletion create auditable workflow
requests only, with at most one active request of each type per account. The UI does not claim immediate
provider deletion or completed retention work.

## PWA And Accessibility

- The service worker caches only versioned public static shell assets. Private API or HTML responses
  are never persisted.
- A waiting service worker presents an explicit update action and recovers through controller change.
- Logout cannot reveal stale private content.
- Primary journeys support keyboard navigation, visible focus, screen readers, reduced motion, zoom,
  responsive reflow, safe-area insets, touch targets, captions, alternative text, and error recovery.

## Evidence Required

- OpenAPI and generated types match the implementation.
- Migration `0113` applies and reverses in isolation and real Postgres proves authorization, block
  safety, idempotency, replies, comment likes, mentions, privacy state, and data requests.
- API tests cover validation, rate limits, replay conflicts, and safe failures.
- Browser tests cover desktop/mobile Home, Bits, Search, social actions, privacy controls, PWA update,
  keyboard use, and reduced motion.
- Admin retains data-request and moderation visibility; analytics remain canonical backend facts.
