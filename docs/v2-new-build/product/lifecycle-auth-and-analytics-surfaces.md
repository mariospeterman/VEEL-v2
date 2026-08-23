# Lifecycle Auth And Analytics Surfaces

Status: draft
Scope: Convergence 04 product behavior
Last updated: 2026-08-23
Source of truth: yes

## Outcome

WeVid presents one calm `Continue to WeVid` entry. The selected method is authenticated first.
An identity already owned by a WeVid account receives a new application session and resumes the
exact backend-owned access state. An unknown identity receives an explicit `account_not_found`
result and may choose `Start onboarding`; no user, profile, wallet, or session is created by the
failed login attempt.

The same slice exposes useful creator, viewer, organization, and operations analytics by consuming
the existing Analytics Core query objects. It does not add a second metric formula or a browser-side
business authority.

## One Authentication Authority

The existing wallet challenge/session flow gains one required immutable purpose:

- `login`: lookup-only for an already-linked wallet and session creation for that exact user.
- `onboarding`: reuse an existing wallet owner or create one provisional user and one linked wallet.

The purpose is stored with the challenge, included in the signed message, required again at session
submission, compared before signature verification, single-use, expiry-bounded, and audited. A
purpose mismatch and replay fail without identity writes. Login never creates or links a user,
profile, wallet, or provider identity. Onboarding is idempotent for the same wallet under a database
advisory lock.

Recovery remains a separate lookup-only exchange over an already-linked recovery identity. It never
matches by email, creates a user or wallet, or merges accounts. Existing recent-authentication rules
for linking recovery and logging out all devices remain unchanged.

## Entry And Resume UX

The public entry begins with one `Continue to WeVid` action and then offers only configured methods:

- `Continue with email, social or passkey` for the configured embedded-wallet provider.
- `Use an existing wallet` for supported external Solana wallets.
- `Use account recovery` when the configured recovery provider is available.

Login language never promises wallet creation. Privy login disables automatic wallet creation,
waits for its existing Solana wallets, and signs a login-purpose WeVid challenge only when an
existing embedded wallet is present. If the authenticated provider identity has no existing wallet
or WeVid account, the UI explains that no account was found and offers onboarding. Only after that
explicit transition may the onboarding runtime create or retrieve the user-controlled embedded
wallet and submit an onboarding-purpose challenge.

Successful authentication routes from backend state:

- ready account -> `/app/home`;
- missing profile/handle -> onboarding profile step;
- age required or pending -> age step;
- suspended or restricted -> safe account-status state;
- provider return -> the preserved safe destination.

Logout revokes the WeVid session and disconnects applicable provider state. `Log out all devices`
continues to require recent authentication.

## Analytics Surfaces

Creator analytics expose qualified views, watch time, completion, saves, shares, profile opens,
follow and unlock conversion, confirmed purchases and earnings by explicit currency, product mix,
membership state where enabled, freshness, privacy-safe comparisons, and deterministic insights.
No viewer identities or private-message analysis are exposed.

Viewer analytics remain a restrained activity summary over existing saved content, purchases,
entitlements, receipts, and memberships. There is no surveillance-style history page.

Organization analytics reuse the same metric objects and existing active-membership/agreement
authorization. Operations analytics expose projection lag, backfill state, reconciliation variance,
metric version, suppressed-query counts, failed jobs, and stale projections.

## Privacy-Safe Lifecycle Instrumentation

Typed lifecycle facts may record landing viewed, entry opened, onboarding opened, method selected,
wallet runtime ready, provider authentication completed, wallet ownership verified, profile and age
step transitions, protected app entered, abandonment, returning login completion, and
`account_not_found`. They must never store email addresses, provider tokens, wallet signatures,
identity documents, or raw age-provider payloads.

## Acceptance

The slice requires OpenAPI and migration rollback/reapply proof, repository and route tests, real
Postgres identity-count and replay/mismatch tests, provider-boundary tests, desktop/mobile browser
journeys for unknown/existing external and embedded identities, Analytics Core authorization and
surface tests, admin visibility, docs checks, full workspace checks, production build, and protected
CI/security/database gates. Provider fixtures prove application behavior only; real Privy and
recovery acceptance remains a staging gate until target-domain/device evidence exists.
