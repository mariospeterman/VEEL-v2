# Veel V2 Route Map

Status: accepted
Scope: API routes, frontend routes, permissions, tests
Last updated: 2026-08-16
Source of truth: yes

Owns:
- frontend route names and API route families

Defers to:
- OpenAPI for operation schemas and response bodies

Does not own:
- database tables, provider internals, screen styling

Launch scope:
- launch and phased route coverage

Non-goals:
- uncontracted route examples

This document freezes the v2 route family before implementation. It must match `packages/contracts/openapi.yaml`.

## API Version Decision

Use `/v1` for the first public greenfield API.

Rules:

- No `/v2` routes in docs, code, tests, or generated clients.
- No legacy `/api/v1` internal examples except external provider URLs that truly include `/api/v1`.
- OpenAPI in `packages/contracts/openapi.yaml` is the API source of truth.
- Route examples in docs must match OpenAPI.
- Every route that changes money, access, Event Access Passes, Mutuals, messages, age, wallet, tax/compliance, moderation, or admin state requires auth, authorization, idempotency where relevant, rate limits, and audit records.

## Frontend Routes

| Route | Phase | Auth | Age | Wallet | Owner | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `/` | MVP | no | no | no | web/landing | Public landing, attribution capture, teaser-safe marketing, login, and onboarding story surface. |
| `/runtime-config.js` | operations | no | no | no | web/runtime | No-store JavaScript containing only schema-allowlisted public environment values. It lets one immutable web image run in preview, staging, and production; secrets are never accepted. |
| `/` onboarding state | Slice 02 target | step 1 | pending | created/connected in step | onboarding | Three visible steps only: Wallet, Minimal Profile, Age Verification. Mainstream Privy entry and external wallet entry converge on one backend wallet challenge/session; Supabase recovery is not a step. |
| `/age` | MVP | yes | pending | yes | onboarding | Third-party age verification session/status. |
| `/app/home` | MVP | yes | yes | yes | home | Recommended/Following/NSFW/SFW feed. |
| `/app/bits` | MVP | yes | yes | yes | media/discover | Reels-style Bit and discovery surface for content, creators, live rooms, and Event Access. |
| `/app/create` | MVP | yes | yes | yes | create | Upload/capture, labels, event attach, monetisation, publish. |
| `/app/messages` | Phase 2 | yes | yes | yes | messages | Inbox, paid messages, Mutual/Event Access contexts. |
| `/app/notifications` | Phase 2 | yes | yes | yes | notifications | Account-owned notification inbox with idempotent read state. |
| `/app/profile` | MVP | yes | yes | yes | profile | Own profile, wallet/activity/settings links. |
| `/profile/:handle` | MVP | yes | yes | yes | profile | Public creator/user profile. Legacy `/app/profile/:handle` redirection was removed because it captured protected routes such as `/app/profile/earnings`; callers must use this canonical public URL. |
| `/live/:id` | Phase 2 | yes | yes | yes | live | Live room/replay viewer, pass/chat state. |
| `/app/activity` | Phase 2 | yes | yes | yes | activity | Purchases, unlocks, support, passes, wallet, referrals, receipts. |
| `/app/wallet` | MVP | yes | yes | yes | wallet | Wallet address, top-up, external link, receipts. |
| `/app/studio` | Phase 2 | yes | yes | yes | organizations | Studio and Enterprise organization dashboards for current members. |
| `/app/settings` | MVP | yes | yes | yes | settings | Profile, security, sessions, feed, privacy, notifications. |
| `/app/settings` recovery | Slice 02 target | yes | yes | yes | auth/settings | Optional “Add account recovery,” primarily for external-wallet-only users; audited link to existing user only, fail closed on collision. |
| `/passes` | Phase 3 | yes | yes | yes | events | Canonical My Passes and QR/access receipt list. |
| `/passes/:id` | Phase 3 | yes | yes | yes | events | Pass QR/details/check-in status. |
| `/event-access/:id` | Phase 3 | yes | yes | yes | events | Canonical Event detail/Event Access sheet. |
| `/mutuals/activate` | Phase 4 | yes | yes | yes | mutuals | Consent, safety, active-Mutual limits. |
| `/mutuals/feed` | Phase 4 | yes | yes | yes | mutuals | Explicit Mutuals feed only. |
| `/mutuals` | Phase 4 | yes | yes | yes | mutuals | Canonical Mutual list and stale/archived state. |
| `/app/assistant` | Phase 5 | yes | yes | yes | ai | Capability-gated AI/MCP surface; not primary mobile nav. Permission-scoped tools require confirmation states and audit visibility. |
| `/admin` | MVP internal | admin | yes | yes | admin | Ops dashboard, role-gated. |
| `/admin/*` | phased | admin | yes | yes | admin | Users, content, reports, payments, Event Access, Mutuals, providers, compliance. |
| `/admin/compliance/ledger` | Phase 2 | admin | yes | yes | compliance | Immutable compliance ledger search/export. |
| `/admin/compliance/dac7/reports` | Phase 2 | admin | yes | yes | compliance | DAC7 annual report preparation and exports. |
| `/admin/compliance/carf/reports` | Phase 2 | admin | yes | yes | compliance | DAC8/CARF readiness reports, feature-flagged off by default. |
| `/admin/compliance/vat/determinations` | Phase 2 | admin | yes | yes | compliance | VAT/MWST determinations and review queue. |
| `/admin/compliance/receipts` | Phase 2 | admin | yes | yes | compliance | Access/payment receipt search. |
| `/admin/compliance/invoices` | Phase 2 | admin | yes | yes | compliance | VAT invoice search and export. |
| `/admin/referrals/programs` | Phase 2 | admin | yes | yes | admin | Referral program governance. |
| `/admin/referrals/partner-campaigns` | Phase 2 | admin | yes | yes | admin | Partner campaign governance. |
| `/admin/tier-waivers` | Phase 2 | admin | yes | yes | admin | Partner/free tier waiver policy. |
| `/admin/organizations` | Phase 2 | admin | yes | yes | admin | Enterprise organization/KYB/RBAC administration. |

Removed route owners:

- `/enter` and `/enter/wallet`: folded into the landing onboarding story and `/app/wallet` remediation surface.
- `/activity`, `/assistant`, `/create`, `/discover`, `/messages`, `/settings`, `/studio`, `/subscriptions`, `/wallet`: removed as route owners. Canonical authenticated pages live under `/app/*`.
- `/app/media/:id`, `/app/stream/:id`, `/app/events/:id`, `/events/:id`: removed as route owners until implemented. Current canonical detail routes are `/content/:id`, `/live/:id`, and `/event-access/:id`.
- `/mutuals/mutuals`: removed historical alias. Canonical Mutuals routes are `/mutuals` and `/mutuals/feed`.
- `/profile`: removed as an own-profile route owner. `/app/profile` is the authenticated own-profile route; `/profile/:handle` remains public profile.

## API Route Groups

All routes use `/v1`.

| Group | Routes | Phase | Notes |
| --- | --- | --- | --- |
| Auth/session | `POST /v1/auth/wallet/challenges`, `POST /v1/auth/wallet/sessions`, `POST /v1/auth/wallet/logout`, `POST /v1/auth/sessions/logout-all`, `POST /v1/auth/recovery/link-intents`, `POST /v1/auth/recovery/exchange`, `POST /v1/auth/recovery/unlink`, `GET /v1/session` | MVP | Embedded and external wallets converge on opaque multi-device application sessions in HttpOnly cookies. Current logout revokes only its session; logout-all is a separate recent-authenticated, audited mutation. Supabase credentials are accepted only at the explicit recovery exchange; link/unlink rotate only the current application session. |
| Telemetry | `POST /v1/telemetry/web-vitals` | operations | Public, schema-allowlisted, rate-limited Core Web Vitals ingestion. It accepts no URL, user, wallet, content, or arbitrary attribute fields; the unique browser metric id is not used as a metric label. |
| Analytics | `POST /v1/analytics/query`, `POST /v1/analytics/onboarding-events`, `GET /v1/admin/analytics/health`, `POST /v1/admin/analytics/jobs` | Convergence 03-04 | One authenticated structured query boundary over versioned typed projections. The public onboarding intake accepts only the closed, privacy-minimized journey vocabulary with UUID/idempotency deduplication and no identity/provider payload. Scope, dimensions, native currency, privacy suppression, freshness, and current Enterprise consent are backend enforced; staff operations expose sanitized health and audited bounded backfill/reconciliation without audience identity or raw facts. |
| Age | `POST /v1/age/sessions`, `GET /v1/age/status`, `POST /v1/webhooks/age/:provider` | MVP | Provider sessions/webhooks; minimal stored result. |
| Verification | `GET /v1/verification/status`, `POST /v1/verification/sessions`, `POST /v1/webhooks/verification/:provider` | MVP | Backend-owned capability resolver plus provider session/webhook flow across age access, creator KYC, and organization KYB. Frontend reads next action and launches hosted provider URLs; it never computes verification truth. |
| Wallets | `GET /v1/wallets`, `POST /v1/wallets/link-challenges`, `POST /v1/wallets/link`, `PATCH /v1/wallets/:id/primary`, `POST /v1/wallets/onramp-sessions` | MVP | Embedded/native wallet path, primary wallet selection, and user-owned wallet funding session. Onramp is not payment proof. |
| Profiles | `GET /v1/profiles/:handle`, `GET /v1/profiles/handles/:handle/availability`, `GET /v1/profiles/me/creator-dashboard`, `GET /v1/profiles/me/creator-onboarding`, `PATCH /v1/profiles/me/creator-onboarding`, `PATCH /v1/profiles/me`, `POST /v1/profiles/me/avatar` | MVP | Handle is the only required account-onboarding field; display name and avatar are optional. Creator earnings configuration is a separate idempotent mutation that selects one user-owned wallet, accepts the exact earnings-terms version, and enables backend-owned products. Lowercase/reserved-name validation and database uniqueness are authoritative. Profiles remain private until age succeeds. No starter-profile route exists. |
| Content | `GET /v1/content/feed`, `GET /v1/content/mine`, `GET /v1/content/{contentId}`, `POST /v1/content`, `PATCH /v1/content/{contentId}`, `POST /v1/content/{contentId}/image-assets`, `POST /v1/content/{contentId}/publish`, `POST /v1/content/{contentId}/poll-votes`, `POST /v1/content/{contentId}/moderation-appeals`, `POST /v1/media/uploads`, `PATCH/DELETE /v1/media/assets/{mediaAssetId}`, `POST /v1/media/assets/{mediaAssetId}/sync` | MVP | One canonical draft lifecycle accepts video, image, carousel, text, and poll formats; initial text/poll state is normalized and transactionally subordinate to `content_items`. Poll voting is backend-authoritative, eligibility-gated, rate-limited, transactionally counted, and lifetime-idempotent. The private image path detects and sanitizes raw JPEG/PNG/WebP, durably reserves one opaque Bunny Storage object, and remains non-playable pending safety evidence; draft asset accessibility/provenance edits and audited retire-before-provider-delete removal use the authoritative composition revision. Bunny-backed upload/status, owner publication/review projection, and replay-safe appeals remain the same authority. Content create keeps an actor/action/request-hash receipt for the logical operation lifetime: exact replay returns the original draft and changed-input reuse fails. Age-ready universal accounts may create SFW drafts; NSFW publishing requires the enhanced adult-content verification and performer-consent policy. KYC/tax/wallet readiness gates earning, not ordinary SFW publishing. |
| Performers | `GET /v1/content/{contentId}/performers`, `POST /v1/content/{contentId}/performers`, `POST /v1/performer-consents/{requestId}/responses`, `GET /v1/performer-invitations/{token}`, `POST /v1/performer-invitations/{token}/verification-sessions`, `POST /v1/performer-invitations/{token}/responses` | MVP | Content-revision-bound performer verification and explicit allowed-use consent. Existing users receive notifications and reusable-evidence checks; external performers use expiring hashed invitation capabilities without being forced to create an account. |
| Managed creators | `GET /v1/managed-creator-relationships`, `GET /v1/managed-creator-relationships/{relationshipId}/reporting`, `POST /v1/organizations/{organizationId}/managed-creators`, `POST /v1/managed-creator-relationships/{relationshipId}/responses`, `POST /v1/managed-creator-relationships/{relationshipId}/agreements`, `POST /v1/managed-creator-relationships/{relationshipId}/agreements/{agreementId}/responses`, `POST /v1/managed-creator-relationships/{relationshipId}/termination` | Phase 2 | Universal-user Enterprise invitations with versioned permissions and creator-side allocation terms. Changed terms require creator reacceptance; termination is prospective. Reporting exposes confirmed historical allocation buckets only to an authorized relationship party and never creates balances or payout state. Creator acceptance, normalized KYB, Enterprise entitlement, and ownership-proven settlement wallet remain independent requirements. |
| Discover | `GET /v1/discover/search`, `GET /v1/discover/hashtags`, `GET /v1/discover/hashtags/{slug}`, `GET /v1/discover/creators`, `GET /v1/discover/events`, `GET /v1/discover/live` | MVP | Search/discovery read models for content, creators, hashtags, events, and live. |
| Feed Controls | `GET /v1/feed/preferences`, `PATCH /v1/feed/preferences`, `POST /v1/feed/reset`, `POST /v1/feed/hide-creator`, `POST /v1/feed/hide-topic`, `POST /v1/feed/impressions` | MVP | Backend-owned recommendation preferences, durable impression idempotency, and safety controls. |
| Engagement | `GET /v1/follows/:userId`, `POST /v1/follows/:userId`, `DELETE /v1/follows/:userId`, `POST /v1/engagement/:contentId/like`, `POST /v1/engagement/:contentId/save`, `POST /v1/engagement/:contentId/comments`, `GET /v1/engagement/:contentId/comments`, `POST /v1/shares` | MVP/Phase 2 | Backend-owned follow graph, aggregate projections, and engagement records. Follow conveys no access, messaging, membership, or Mutuals authority. |
| Reports/Blocks | `POST /v1/reports`, `POST /v1/blocks/:userId` | MVP | Safety actions audited. |
| Notifications | `GET /v1/notifications`, `PATCH /v1/notifications/:id/read`, `GET /v1/notifications/preferences`, `PATCH /v1/notifications/preferences`, `GET /v1/notifications/push-config`, `POST /v1/notifications/devices`, `DELETE /v1/notifications/devices/:id` | Phase 2 | Backend-derived notification projections and browser push enrollment. Notifications never create payment/access truth. |
| Realtime | `POST /v1/realtime/token` | Phase 2 | Canonical application session mints a short-lived ES256 Supabase Realtime JWT; missing imported signing-key configuration fails closed. |
| Payments | `POST /v1/payments/intents`, `GET /v1/payments/intents/:id`, `POST /v1/payments/intents/:id/consent`, `GET /v1/payments/intents/:id/transaction-request`, `GET /v1/payments/checkout/:checkoutToken`, `POST /v1/payments/checkout/:checkoutToken`, `POST /v1/payments/intents/:id/submissions`, `POST /v1/content/:id/unlock-intents`, `POST /v1/webhooks/solana-indexer` | MVP | The buyer must persist exact checkout terms and any required immediate-access acknowledgement before an authenticated owner can mint the short-lived opaque checkout capability or submit a signature. Wallet-facing checkout metadata/transaction composition uses that scoped capability without browser auth. Backend verifies exact SOL/USDC split, memo, reference, payer, expiry block time, and configured finality before settlement or entitlement. |
| Refunds/Disputes | `GET /v1/refunds/requests`, `POST /v1/refunds/requests` | Phase 2 | User-visible refund, dispute, and access-issue request workflow. Requests create review/audit state only; they never execute refunds, custody funds, create balances, or become payment truth. |
| Referrals | `POST /v1/referrals/tokens`, `GET /v1/referrals/activity` | Phase 2 | External links only create commission eligibility from Veel platform commission, never creator share or tax. |
| Live | `POST /v1/live/rooms`, `GET /v1/live/rooms/mine`, `GET /v1/live/rooms/:id`, `GET /v1/live/rooms/:id/host-connection`, `POST /v1/live/rooms/:id/host-connection/reveal`, `POST /v1/live/rooms/:id/end`, `POST /v1/live/rooms/:id/sync`, `POST /v1/live/rooms/:id/event-access-intents`, `GET /v1/live/rooms/:id/messages`, `POST /v1/live/rooms/:id/messages` | Phase 2 | SFW-only Livepeer rooms with creator-owned OBS setup, one-response recent-auth stream-key reveal, public/profile-member/paid-event access, optional members-only chat, backend-settled Event Access, creator end, safety suspension, and quarantined replay projection. |
| Messages | `GET /v1/messages/conversations`, `POST /v1/messages/conversations`, `PATCH /v1/messages/conversations/:id/request`, `PATCH /v1/messages/conversations/:id/read`, `GET /v1/messages/conversations/:id/messages`, `POST /v1/messages/conversations/:id/messages`, `POST /v1/messages/conversations/:id/paid-message-intents` | Phase 2 | Direct-message requests, two-message ceilings, recipient accept/decline, read cursors, server-priced paid-message drafts, and delivery only after backend settlement and block recheck. |
| Memberships and platform usage | `GET /v1/platform-access`, `POST /v1/platform-usage/playback-sessions`, `POST /v1/platform-usage/playback-sessions/:playbackSessionId/heartbeats`, `GET /v1/subscriptions/plans`, `GET /v1/subscriptions`, `GET /v1/subscriptions/creator-offer`, `PUT /v1/subscriptions/creator-offer`, `DELETE /v1/subscriptions/creator-offer`, `POST /v1/subscriptions/intents`, `GET /v1/subscriptions/authorizations/:id/transaction`, `POST /v1/subscriptions/authorizations/:id/submissions`, `PATCH /v1/subscriptions/:id/cancel` | Phase 2 | Backend-owned five-tier platform catalog/current capability and allowance projection plus one profile-native Membership offer per eligible creator, using the official Solana recurring-delegation primitive. Offer writes recompute exact creator/platform atomic splits and reset sales to staging-required. The transaction endpoint derives all authority, token-account, bounded amount, period, collector, nonce, and expiry facts server-side; the browser submits only the wallet signature. Authorization queues the first collection but never grants access. Playback sessions meter only qualifying free public VOD/live through ordered idempotent heartbeats; purchased, membership, Event Access, preview, Bits, owner, and promotional playback remain excluded. Profile Membership eligibility is independent of Studio. KYB alone never grants Enterprise. Intent creation and renewal collection fail closed unless provider/program/RPC/mint/collector/merchant/on-chain verification are configured; native SOL recurring subscriptions are unsupported. |
| Event Access | `POST /v1/events`, `PATCH /v1/events/:id`, `GET /v1/events/:id`, `POST /v1/events/:id/access-passes/intents`, `POST /v1/events/:id/access-passes/requests`, `POST /v1/access-passes/:id/check-in` | Phase 3 | Canonical Event Access Pass route family. Pass price creator-owned, backend-validated; ticket-named API aliases are removed from launch-facing contracts and code. |
| Mutuals | `POST /v1/mutuals/activate`, `PATCH /v1/mutuals/preferences`, `GET /v1/mutuals/feed`, `POST /v1/mutuals/interests`, `GET /v1/mutuals`, `PATCH /v1/mutuals/:id/archive` | Phase 4 | Canonical Mutuals route family. Explicit opt-in, safety, active-Mutual cap; dating-named API aliases are removed from launch-facing contracts and code. |
| Activity | `GET /v1/activity`, `GET /v1/activity/payments`, `GET /v1/activity/wallet-transactions`, `GET /v1/activity/access-passes`, `GET /v1/activity/referrals` | Phase 2 | Trust/accountability surface with backend-observed wallet transactions, receipts, passes, not wallet UI proof. |
| Organizations | `GET /v1/organizations`, `GET /v1/organizations/{organizationId}/members`, `POST /v1/organizations/{organizationId}/members`, `POST /v1/organization-memberships/{membershipId}/responses`, `PATCH /v1/organizations/{organizationId}/members/{membershipId}` | Phase 2 | Studio/Enterprise member dashboard, bilateral team invitations, owner-controlled non-owner role/state changes, and backend-derived RBAC projection. Team publishing, consolidated reporting, compliance exports, allocation/business controls, and Enterprise capabilities require their exact entitlement and normalized organization KYB gates. |
| Admin | `GET /v1/admin/ops/summary`, `GET /v1/admin/notifications/health`, `POST /v1/admin/worker-queues/{queueName}/jobs/{jobId}/retry`, `GET /v1/admin/audit`, `GET /v1/admin/users`, `GET /v1/admin/users/{userId}`, `GET /v1/admin/content`, `PATCH /v1/admin/content/{contentId}/moderation`, `GET /v1/admin/reports`, `PATCH /v1/admin/reports/{reportId}`, `GET /v1/admin/payments/intents`, `GET /v1/admin/payments/commercial-policies`, `PATCH /v1/admin/payments/commercial-policies/{productType}/{currency}`, `GET /v1/admin/unlocks`, `GET /v1/admin/provider-events`, `POST /v1/admin/provider-events/{providerEventId}/replay`, `GET /v1/admin/live/rooms`, `POST /v1/admin/live/rooms/:roomId/suspension`, `GET /v1/admin/media/assets`, `GET /v1/admin/age-kyc/age-checks`, `GET /v1/admin/age-kyc/identity-checks`, `GET /v1/admin/ai/sessions`, `GET /v1/admin/ai/tool-calls`, `GET /v1/admin/support/cases`, `PATCH /v1/admin/support/cases/{supportCaseId}`, `GET /v1/admin/support/policies`, `PATCH /v1/admin/support/policies/{supportPolicyId}`, `GET /v1/admin/refunds/disputes`, `PATCH /v1/admin/refunds/disputes/{refundDisputeId}`, `GET /v1/admin/data-requests`, `PATCH /v1/admin/data-requests/{dataRequestId}`, `GET /v1/admin/events`, `GET /v1/admin/event-access-passes`, `GET /v1/admin/mutuals/safety`, `GET /v1/admin/compliance/ledger`, `GET /v1/admin/compliance/dac7/reports`, `GET /v1/admin/compliance/carf/reports`, `GET /v1/admin/compliance/vat/determinations`, `GET /v1/admin/compliance/receipts`, `GET /v1/admin/compliance/invoices`, `GET /v1/admin/referrals/programs`, `GET /v1/admin/referrals/partner-campaigns`, `GET /v1/admin/tier-waivers`, `GET /v1/admin/organizations`, `POST /v1/admin/organizations`, `PATCH /v1/admin/organizations/{organizationId}/kyb`, `GET /v1/admin/organizations/{organizationId}/members`, `PATCH /v1/admin/organizations/{organizationId}/members/{membershipId}`, `GET /v1/admin/feature-flags`, `PATCH /v1/admin/feature-flags/{featureFlagKey}` | MVP/phased | Role-gated, audited, no provider secrets; commercial-policy overrides are a dedicated money authority rather than feature flags and exact retries are durable. Organization provisioning invites an existing WeVid account as owner and never creates a shadow identity. Every admin mutation writes admin action/audit. Live suspend/resume is restricted to action-specific safety roles and keeps provider secrets redacted. Dating- and ticket-named admin aliases are removed. |
| AI | `GET /v1/ai/capabilities`, `POST /v1/ai/sessions`, `POST /v1/ai/sessions/:id/tool-calls` | Phase 5 | Internal permission-scoped, confirmation-gated assistant tools. |
| MCP | `GET /.well-known/oauth-protected-resource`, `GET /.well-known/oauth-authorization-server`, `GET /oauth/authorize`, `POST /oauth/token`, `POST /oauth/revoke`, `GET /oauth/consent/:requestId`, `POST /oauth/consent/:requestId/approve`, `POST /oauth/consent/:requestId/deny`, `GET /v1/mcp/tools`, `GET /v1/mcp/connections`, `POST /v1/mcp/connections`, `GET /v1/mcp/connections/:id`, `POST /v1/mcp/connections/:id/revoke` | Phase 5 | External MCP connector management. Production private-data connectors use OAuth authorization-code plus PKCE with resource-bound bearer tokens. Scoped-token creation is dev/staging only. |
| Provider Webhooks | `POST /v1/webhooks/media/:provider`, `POST /v1/webhooks/age/:provider`, `POST /v1/webhooks/verification/:provider`, `POST /v1/webhooks/solana-indexer` | phased | Helius Solana evidence uses configured `authHeader`/`Authorization` verification; identity callbacks are signed, idempotent, audited, normalized, and never expose raw provider payloads to frontend resources. |

## Required Response States

Every screen route and API route must define:

- auth requirement
- age requirement
- wallet requirement
- loading state
- empty state
- error/retry state
- rate-limit behavior
- audit behavior where applicable
- admin visibility where applicable
- tests

## Acceptance

- No `/v2` API route examples remain.
- OpenAPI and this route map agree before implementation.
- Every OpenAPI operation has an `operationId`.
- Every mutation that changes money, access, Event Access Passes, wallet, age, Mutuals, messages, tax/compliance, moderation, admin, or provider state has idempotency coverage.
- Generated frontend client uses OpenAPI only.
