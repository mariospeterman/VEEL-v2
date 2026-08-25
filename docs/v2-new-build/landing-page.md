# WeVid Public Landing

Status: accepted
Scope: canonical public `/` product story, claims, conversion, and progressive media
Last updated: 2026-08-25
Source of truth: yes, for landing behavior and public claims presentation

Owns:
- one canonical semantic public landing page
- the `Continue to WeVid` conversion entry
- landing copy, approved-claims presentation, SEO metadata, and progressive hero media

Defers to:
- `embedded-wallet-onboarding.md` for login/onboarding lifecycle truth
- `business-monetisation.md` and `payments-and-monetisation.md` for money and tier truth
- `product/mutuals.md` and `product/event-access.md` for those feature boundaries
- `frontend/design-system.md` for tokens and shared UI direction
- provider ADRs and launch evidence for availability claims

Does not own:
- account, wallet, payment, entitlement, ranking, moderation, tier, or provider truth
- a second auth entry, payment presentation, design system, or analytics authority

Launch scope:
- one responsive, server-readable public product story with an original, clearly adult cinematic hero image
- one `Continue to WeVid` entry that authenticates first and explicitly asks before onboarding creates a provisional account or embedded wallet

Non-goals:
- scroll-jacking, video seek-by-scroll, GSAP, hidden story frames, landing variants, fake social proof, or named competitor attacks
- promoting text, polls, or carousels as headline landing features
- claiming deferred Product Offers are already available

## Product Story

The antagonist is the rented creator economy: unstable reach, indirect money movement, separated conversation and commerce, and fragmented creator tools. The page does not say that every incumbent behaves identically.

The public sequence is:

1. Why: stop building on rented ground.
2. Verified product facts: one wallet-approved transaction, the current 10% default platform fee, no WeVid creator balances/withdrawal queues, and no pay-to-rank.
3. Product: media first, opt-in Mutuals, Event Access Pass/QR state, and honestly qualified planned Product Offers.
4. Money: illustrative 1.00 USDC default split with confirmation and backend-verification disclosure.
5. Plans: Plus, Ultra, Studio, and Enterprise extend software capabilities, never social rank.
6. Trust: independent age, earnings, publishing, performer, moderation, and staff authorities.
7. FAQ and the same Continue entry.

Studio is the individual creator capability tier and `/app/studio` workspace. It extends the existing account/profile with professional analytics, scheduling, pricing, live-conversion, and approved assistant capabilities. Enterprise is the separate organization workspace with contract/KYB gates, creator consent, and permission-based RBAC. Neither tier buys discovery, Mutuals treatment, message priority, or moderation priority.

Product Offers remain the approved post-core direction. Landing copy must say they are planned and approval-gated until seller identity, product safety, shipping/privacy, tax, refunds, fulfillment, and operations are implemented and approved.

## Claims Authority

`apps/web/app/landing-claims.ts` is the small typed registry for objective public claims. Every entry records exact wording, class, evidence owner, verification date, approval state, qualification, and permitted placements. `landing-content.ts` can render a claim only through `approvedLandingClaim`; pending external statistics cannot render.

Current creator-economy research was reviewed to inform the problem framing. No external statistic is public until legal claims review approves its exact wording, scope, source, and placement. Product-owned facts remain preferred.

## Media And Performance

- Server HTML contains the complete narrative and structured data.
- The original, clearly adult creator image is the meaningful baseline; it contains no third-party logo, text, QR code, or provider claim.
- A restrained CSS drift adds atmosphere when motion preferences allow it.
- Disabled JavaScript, reduced motion, or data saving must not reduce meaning or block conversion.
- No animation library is part of the landing bundle.
- Core Web Vitals, Lighthouse mobile, no-overflow, and device/browser evidence belong to the slice acceptance report and staging convergence.

## Analytics

Landing interactions extend the existing privacy-minimized onboarding journey authority. The browser records no PII, query strings, wallet addresses, raw referrers, or provider payloads. Events cover landing views, CTA and navigation actions, section views, the money example, comparison, FAQ opens, authentication, account-not-found, onboarding, and returning login.

## Accessibility And SEO

- semantic sections and headings
- skip link and visible focus
- keyboard-operable navigation, FAQ, modal, wallet, profile, and age flows
- Escape/backdrop close only when the route is not resuming a required callback state
- reduced-motion and forced-colors behavior
- directly addressable legal pages
- canonical metadata, Open Graph/Twitter basics, robots, sitemap, and visible-fact JSON-LD only

## Acceptance

- no duplicate landing route, story frame, copy authority, analytics transport, auth system, or payment system
- no GSAP or scroll-scrub code/dependency
- no stale `/` copy promoting censorship guarantees, instant settlement, zero fees, or unavailable Product Offers
- desktop, tablet, and mobile visual proof
- login/onboarding continuation and legal links remain real
- claims registry tests prevent unapproved publication
- contract, migration, API validation, generated types, browser smoke, docs checks, typecheck, lint, build, and relevant unit/database tests pass
