# Provider setup and demo-data runbook

Status: accepted
Scope: real Supabase database, local provider testing, isolated cloud staging, and controlled demo data
Last updated: 2026-08-27
Source of truth: operator procedure; `.env.staging.example` and `scripts/staging-config.mjs` own the exact variable contract

This runbook configures the existing provider adapters. It does not add a second auth, wallet, payment, media, verification, or fixture system. Never paste secrets into chat, commit them, expose them through `NEXT_PUBLIC_*`, or reuse a production provider project for staging.

## 1. Toolchain and secret hygiene

Use Node `22.16.x` and pnpm `10.0.0`. Copy `.env.example` to the ignored `.env` for local development and `.env.staging.example` to the ignored `.env.staging` for cloud acceptance. Any database password, API secret, service key, webhook secret, or JWT signing key previously shared outside the secret manager must be rotated before staging.

Public browser values are limited to variables already named `NEXT_PUBLIC_*`. Supabase secret keys, the Postgres password, Privy app secret, payment/webhook secrets, media keys, signing keys, and provider API keys are server-only.

## 2. Real Supabase database and Auth

Create a dedicated non-production Supabase project. In **Project Settings → Database**, set and store a database password. Then open **Connect** and copy the connection strings supplied for that exact project:

- Set `DATABASE_URL` to the **session pooler** connection on port `5432` for the persistent API and worker. This is the preferred IPv4-compatible runtime connection.
- Set `SUPABASE_DIRECT_DB_URL` to the **direct** `db.<project-ref>.supabase.co:5432` connection for migrations and advisors when the operator host has IPv6.
- Set `SUPABASE_MIGRATIONS_DB_URL` to a separately controlled migration connection when available; otherwise it may equal the direct URL.
- Require TLS with `sslmode=require`. Percent-encode special characters in the database password. A publishable key, secret API key, JWT secret, or project reference is not a database password.

Use the exact strings from the dashboard rather than constructing a hostname. A representative shape is:

```dotenv
DATABASE_URL=postgresql://postgres.<project-ref>:<encoded-db-password>@<region>.pooler.supabase.com:5432/postgres?sslmode=require
SUPABASE_DIRECT_DB_URL=postgresql://postgres:<encoded-db-password>@db.<project-ref>.supabase.co:5432/postgres?sslmode=require
SUPABASE_MIGRATIONS_DB_URL=postgresql://postgres:<encoded-db-password>@db.<project-ref>.supabase.co:5432/postgres?sslmode=require
```

Also set the existing Supabase variables from **Project Settings → API** and the CLI access token from the Supabase account settings. The browser receives only the project URL and publishable key; privileged server jobs use `SUPABASE_SECRET_KEY`.

Before applying anything, verify the exact project and migration plan:

```text
pnpm supabase:link
pnpm supabase:migrations
pnpm supabase:history:check
pnpm supabase:advisors
pnpm supabase:push:dry
```

Apply with `pnpm supabase:push` only after the dry run names the intended non-production project. For isolated staging, use the stricter `pnpm staging:cloud:link`, `pnpm staging:migrations:plan`, and acknowledged `pnpm staging:migrations:apply` path from `infra/deploy/staging-convergence.md`.

In **Authentication → URL Configuration**, set the local Site URL to `http://localhost:3000` and allow both local confirmation callbacks:

```text
http://localhost:3000/auth/confirm
http://127.0.0.1:3000/auth/confirm
```

Add the exact HTTPS staging and production `/auth/confirm` URLs in their respective projects. Enable email or OAuth in Supabase only if it is intentionally offered as account recovery/linking. It is not the primary WeVid entry and `shouldCreateUser` remains false for recovery.

Official references: [Supabase database connections](https://supabase.com/docs/guides/database/connecting-to-postgres), [server-side auth for Next.js](https://supabase.com/docs/guides/auth/server-side/nextjs).

## 3. Privy embedded auth and wallet

Create separate Privy apps for local/staging and production. In the Privy dashboard:

1. Add web app clients for `http://localhost:3000` and `http://127.0.0.1:3000`; include the port. Add only the exact HTTPS staging origin to the staging app.
2. Enable email, Google, X/Twitter, Discord, and passkey login methods that should appear in Privy's official login UI. Configure each social client and callback in its provider dashboard.
3. Enable Solana and embedded wallets. Embedded wallet creation must remain `off` for login and `users-without-wallets` for explicit onboarding; the repository enforces that policy.
4. Put the public app ID in `NEXT_PUBLIC_PRIVY_APP_ID`. Put `PRIVY_APP_SECRET` and the official app JWKS endpoint in server-only configuration. Set `NEXT_PUBLIC_EMBEDDED_WALLET_RUNTIME_ENABLED=true` only for an approved app/origin pair.
5. Test both identities: an existing Privy wallet must sign the backend ownership challenge and enter the app; a new Privy identity must show the onboarding transition before the wallet is created.

The external wallet buttons need no provider keys. They use Wallet Standard discovery, show the installed wallet's supplied icon when it is a safe embedded image, and request a message signature—not a payment. Test Phantom plus at least one other Solana-compatible wallet on devnet.

Official references: [Privy React setup](https://docs.privy.io/basics/react/setup), [login methods](https://docs.privy.io/basics/get-started/dashboard/configure-login-methods), [allowed domains](https://docs.privy.io/recipes/react/allowed-domains), [embedded wallet creation](https://docs.privy.io/wallets/wallets/create/create-a-wallet).

## 4. Local development age bypass

The only supported bypass is the built-in non-production mock adapter:

```dotenv
NODE_ENV=development
AGE_VERIFICATION_DRIVER=didit
AGE_VERIFICATION_ALLOW_MOCK_PROVIDER=true
```

It creates the canonical pending record and auto-approves that record through the same repository boundary. It does not bypass wallet, profile, session, or app-access policy. Production and real staging reject the mock flag; set `AGE_VERIFICATION_ALLOW_MOCK_PROVIDER=false` there and configure one approved real provider workflow.

For real age acceptance, create the selected Didit workflow, configure `DIDIT_API_KEY`, `DIDIT_WEBHOOK_SECRET`, and `DIDIT_AGE_WORKFLOW_ID`, then point the signed provider webhook at the API age webhook base. KYC/KYB workflow IDs are separate and are not universal onboarding. Verify signature failure, replay denial, approval, rejection, and delayed callback recovery.

Official references: [Didit quick start](https://docs.didit.me/getting-started/quick-start), [age estimation](https://docs.didit.me/core-technology/age-estimation/overview), [webhooks](https://docs.didit.me/integration/webhooks).

## 5. Solana Pay and settlement evidence

Keep all local/staging payment values on devnet:

1. Create a dedicated devnet platform-fee recipient wallet and set `PAYMENT_PLATFORM_FEE_WALLET`; never provide its private key to the web app.
2. Set browser and server RPC URLs to an approved devnet RPC. Set `SOLANA_CLUSTER=devnet`, `SOLANA_NETWORK=solana:devnet`, `NEXT_PUBLIC_SOLANA_CHAIN=solana:devnet`, and `HELIUS_CLUSTER=devnet`.
3. Create a Helius devnet project and signed/authorized webhook for the relevant recipient/reference addresses. Store its secret only as `HELIUS_WEBHOOK_SECRET` and point it to the payment webhook route exposed by the API.
4. Fund test wallets from the official devnet faucet. Configure the official devnet USDC mint only when testing USDC; never substitute a similarly named token.
5. Exercise both external and embedded wallet paths: backend quote, wallet approval, confirmed transaction, exact amount/mint/recipient/reference verification, idempotent webhook reconciliation, receipt, and entitlement. A wallet approval or client callback alone is never settlement proof.

Official references: [Solana payment integration](https://solana.com/docs/payments/accept-payments), [Helius webhooks](https://www.helius.dev/docs/webhooks).

## 6. Bunny VOD, private images, and moderation

Create a staging Bunny Stream library and a separate private Storage zone/pull zone:

1. Configure the Stream API key, library ID, embed token key, and read-only webhook key.
2. Configure the private image Storage access key, zone name, pull-zone URL, and pull-zone token key. Keep originals private and expose only released, signed derivatives.
3. Register the Stream status callback at the API media webhook. The API verifies the v1 HMAC signature over the exact raw body.
4. Keep `MEDIA_MODERATION_MODE=shadow` while measuring a real moderation path. Do not use `launch_approved` until upload scanning, quarantine, human fallback, approve/reject/appeal, retry, and dead-letter behavior have evidence.
5. Run `pnpm proof:bunny-sfw` with the known-safe SFW fixture and verify create, TUS upload, processing, signed playback, deletion, and key-rotation recovery.

Official references: [Bunny TUS uploads](https://docs.bunny.net/stream/tus-resumable-uploads), [Bunny upload scanning](https://docs.bunny.net/shield/upload-scanning).

## 7. Livepeer live and replay

Create a staging Livepeer Studio project and configure the API key, webhook secret, webhook ID, playback JWT keypair, and the approved SFW moderation multistream target. Register the API live webhook endpoint, keep `LIVEPEER_ADULT_LIVE_ENABLED=false`, and test stream creation, ingest, signed viewer playback, webhook replay denial, suspend/recover, end, and replay quarantine. Stream keys and playback signing private keys are server-only.

Official references: [create a Livepeer stream](https://docs.livepeer.org/api-reference/stream/create), [JWT playback access control](https://docs.livepeer.org/developers/guides/access-control-jwt).

## 8. Remaining staging dependencies

These are required by the full staging gate even though they are not needed for the first local wallet/media/payment walkthrough:

- Redis: provision one private TLS Redis instance and set `API_RATE_LIMIT_STORE_DRIVER=redis` plus `API_RATE_LIMIT_REDIS_URL` so all API replicas share rate-limit state.
- Realtime and push: create the scoped Realtime JWT signing JWK/key ID/issuer, a device-endpoint encryption key, and a VAPID keypair/subject. Prove private-channel denial and real browser delivery/revocation.
- Transactional email: create a Resend staging sender/domain, set `TRANSACTIONAL_EMAIL_PROVIDER=resend`, and configure the API key, verified From address, and controlled smoke recipient.
- Observability: send OTLP traces, metrics, and redacted logs to the selected collector; set `OTEL_REQUIRED=true` and prove alerts.
- Enterprise: onboard controlled users first, then configure the staging organization/relationship proof values. Organization KYB and managed-creator agreement remain server-authorized.
- Legal/release: leave `LEGAL_DOCUMENTS_APPROVED=false` until the named versions and contact are approved. This intentionally blocks promotion, not local product testing.

## 9. Demo users and populated content

Yes, the platform supports controlled staging fixtures, but it intentionally does not manufacture provider identities or write directly into Supabase Auth:

1. Start the real stack with the real staging database and configured Privy/external wallets.
2. Create each demo user through the real entry and three-step onboarding. Use the local mock age adapter only for local development; use the real staging age provider for acceptance.
3. Read the resulting canonical WeVid user UUIDs from the operator/admin surface or a read-only database query.
4. Set a unique `STAGING_FIXTURE_NAMESPACE` and map those existing UUIDs in `STAGING_FIXTURE_USERS_JSON` to the required roles (`platform_owner`, `trust_safety`, `finance`, `support`, `operations`, `compliance`, `readonly_auditor`).
5. Run `pnpm staging:seed`. This grants controlled staff memberships and records every created resource in the namespace ledger. It does not create demo media or provider state.
6. Populate demo profiles and SFW content through the normal authenticated app/API using those test users. Use the Create workspace for uploads and the ordinary payment/live journeys for provider state so the same authorization, moderation, settlement, and audit rules are exercised. The repository does not currently provide an automated demo-content seeder; do not claim that `staging:acceptance` creates content.
7. Run `pnpm staging:acceptance` to verify the populated environment. Never insert demo auth users, entitlements, payments, or media state directly.
8. Clean only ledger-owned resources in that namespace with the exact `STAGING_CLEANUP_ACK=DELETE_FIXTURES:<namespace>` and `pnpm staging:cleanup`. Manually created demo content follows the normal authenticated deletion/moderation lifecycle and is not deleted by this command.

## 10. Ordered verification

For local development, run `pnpm dev:full`, then verify wallet login/onboarding, profile upload, mock age completion, app access, payment quotes/settlement, Bunny upload/playback, and Livepeer stream state. For isolated cloud staging, use:

```text
pnpm staging:init
pnpm staging:doctor
pnpm staging:cloud:link
pnpm staging:migrations:plan
pnpm staging:migrations:apply
pnpm staging:bootstrap
pnpm staging:run
pnpm staging:seed
pnpm staging:acceptance
pnpm staging:prove
pnpm staging:report
```

Only exit `0` from the doctor and proof gates is green. Missing provider accounts, keys, dashboard callbacks, legal approval, or real-device evidence remain explicit blockers; they are never replaced by browser mocks in staging.
