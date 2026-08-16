# Frontend Release Readiness

Status: accepted
Scope: Launch 10 frontend convergence, accessibility, browser support, and installable PWA behavior
Last updated: 2026-08-16
Source of truth: yes

Owns:
- the release acceptance contract for the public landing and entry surfaces, authenticated app shell, responsive product workspaces, and installable PWA
- the browser, accessibility, offline, loading, error, and visual evidence required for Launch 10
- the boundary that keeps wallet and provider runtimes out of the public first-paint bundle

Defers to:
- `frontend-architecture.md`, `native-ui-ux-screens.md`, and `frontend/` for route, component, copy, and visual-system detail
- OpenAPI, migrations, backend services, and provider adapters for business truth
- `providers/identity-provider-wiring.md` and `embedded-wallet-onboarding.md` for identity and wallet authority

Does not own:
- payment, access, identity, compliance, ranking, or provider truth
- production deployment, observability, recovery, or legal approval, which remain Launch 11 gates

## Entry Contract

- The visible entry action is `Connect wallet`. It opens the intentionally supported Solana wallet chooser directly.
- When the embedded noncustodial wallet provider is configured, `Create secure WeVid wallet` is a quiet secondary action. Email, social, and passkey choices belong inside that provider's official surface and are not repeated as competing WeVid steps.
- Entry contains no `Powered by`, implementation-provider, blockchain-mechanics, or multi-paragraph explanatory copy.
- Login and onboarding use the same wallet runtime and the same backend challenge/session authority.
- Provider loading is progressive. A temporary loading state is concise and live-announced; failure leaves a retry action and never presents a dead primary button.
- Provider SDKs do not load in the root public layout. They load only when entry, authenticated wallet features, or an initiated checkout needs them.

## App And Responsive Contract

- One authenticated `AppShell` owns the desktop rail, top actions, page frame, and mobile dock.
- Every page has one programmatic main-content target and a keyboard-visible skip link.
- Interactive targets are at least 44 by 44 CSS pixels unless an equivalent grouped-control exception is documented and tested.
- The primary 360, 390, 768, 1024, 1280, and 1440 pixel widths have no unintended horizontal overflow.
- Loading, empty, permission, validation, conflict, rate-limit, provider-unavailable, network, and retry states use safe product language rather than raw transport or provider errors.
- Motion respects `prefers-reduced-motion`; content and controls remain usable without animation.

## Accessibility Acceptance

- Automated Axe checks cover the landing, login, onboarding, offline, and representative authenticated shells with WCAG 2.2 A/AA tags and no serious or critical violations.
- Keyboard-only proof covers entry, skip link, primary navigation, dialogs/provider triggers, forms, and error recovery.
- Focus is visible, not trapped outside an active dialog, and restored after dismissible overlays.
- Landmarks, headings, labels, names, status announcements, and current-navigation state are programmatic.
- Text and non-text contrast meet AA for their intended sizes and states.
- Informative media has an accessible name; decorative media is ignored.

Automated checks supplement, but do not replace, a manual screen-reader and zoom pass during staging convergence.

## Browser And Device Matrix

Pull requests must exercise current Playwright Chromium, Firefox, and WebKit desktop engines plus Chromium and WebKit mobile profiles. The protected smoke set covers:

- landing, login, and onboarding entry
- authenticated app-shell navigation
- Home/Bits responsive containment
- create, messaging, activity, wallet, settings, and Studio workspaces
- monetisation review and wallet handoff boundaries
- install manifest, service-worker delivery, and offline fallback

Real wallet extensions, embedded-wallet provider domains, push delivery, and iOS installed-PWA behavior require target-device staging evidence and remain `CODE_COMPLETE_PROVIDER_BLOCKED` until configured.

## PWA Cache And Privacy Contract

- The web app exposes a valid manifest with install-grade 192 and 512 pixel icons, maskable icons, standalone display, theme colors, and an explicit app identity.
- The service worker is registered from the global client runtime without requesting notification permission.
- Only versioned static assets and an explicit offline document may be cached.
- API responses, authenticated documents, media capabilities, signed URLs, wallet requests, provider responses, user-generated content, and routes carrying private query state are never persisted by the service worker.
- Navigations are network-first and use the offline document only when the network is unavailable. The offline document contains no user data.
- Service-worker responses include restrictive script and cache headers. Service-worker updates remove obsolete named caches.
- Push enrollment remains an explicit user action and reuses the existing registration.

## Performance And Bundle Boundary

- Public landing first paint must not import Privy, Solana wallet adapter, Solana Web3, Commerce Kit, payment transaction, Realtime, or authenticated query runtimes.
- Wallet and payment code is dynamically loaded at the narrow interaction boundary.
- Fonts are self-hosted by the Next font pipeline and use the locked Manrope body and Space Grotesk display families.
- Images use intentional dimensions and responsive sizing; no route may introduce avoidable layout shift.
- Staging convergence records Web Vitals and representative bundle evidence. Any budget regression requires an explicit owner and release decision.

## Evidence And Promotion Gate

Launch 10 is code-complete only when lint, typecheck, unit tests, build, desktop/mobile visual proof, Axe, keyboard, responsive overflow, PWA, and Chromium/Firefox/WebKit smoke are green. Fail-closed external provider paths may merge as `CODE_COMPLETE_PROVIDER_BLOCKED` with the missing evidence named.

Pre-production staging must then repeat the complete user journeys with real isolated Supabase, Redis, provider sandbox accounts, Solana devnet wallets, webhook domains, installed-PWA devices, and supported browsers. Production may receive only the exact immutable artifact already accepted in staging and only after explicit approval.
