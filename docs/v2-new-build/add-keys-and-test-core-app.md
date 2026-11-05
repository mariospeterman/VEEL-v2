# Add Keys And Test The Core App

Status: accepted
Scope: local and staging setup for the simple photo, video, and live core
Last updated: 2026-11-05
Source of truth: operational checklist; `.env.example`, `.env.staging.example`, config parsers, and provider runbooks remain authoritative for variable semantics

Owns:
- the shortest ordered path to configure and test the core app without inventing environment names

Defers to:
- `operator/provider-setup-and-demo-data.md` for provider dashboards and staging acceptance
- `.env.example` and `.env.staging.example` for the complete supported variable inventory
- provider ADRs and official documentation for production approval

Does not own:
- secrets, remote migration approval, launch approval, mainnet enablement, or provider account terms

## 1. Pin The Toolchain

Use Node `22.23.4` and pnpm `10.0.0` from the committed version files.

```sh
nvm install
nvm use
corepack enable
corepack prepare pnpm@10.0.0 --activate
pnpm install --frozen-lockfile
pnpm doctor
```

## 2. Create Local Configuration

```sh
cp .env.example .env
```

Never commit `.env`, paste secrets into issues/chat, or put server keys in `NEXT_PUBLIC_*`. The core
runtime reads `.env`; staging commands read `.env.staging`. Keep provider paths disabled until their
exact keys, webhooks, account approval, and safety evidence are available.

Core web/API and database names:

```text
NEXT_PUBLIC_APP_URL
NEXT_PUBLIC_API_BASE_URL
API_URL
WEB_URL
PORT
HOST
DATABASE_URL
SUPABASE_URL
SUPABASE_PROJECT_REF
SUPABASE_PUBLISHABLE_KEY
SUPABASE_SECRET_KEY
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
```

Devnet wallet/payment names:

```text
NEXT_PUBLIC_SOLANA_CHAIN=solana:devnet
NEXT_PUBLIC_SOLANA_RPC_URL
SOLANA_CLUSTER=devnet
SOLANA_NETWORK=solana:devnet
SOLANA_RPC_URL
PAYMENT_PLATFORM_FEE_WALLET
NEXT_PUBLIC_PRIVY_APP_ID
NEXT_PUBLIC_EMBEDDED_WALLET_RUNTIME_ENABLED
```

Leave the two Privy values empty/`false` until that app and origin are approved. External wallets
still use the canonical backend challenge. `SUBSCRIPTIONS_ENABLED=false` and
`SUBSCRIPTIONS_PROVIDER=disabled` are the safe core defaults.

Photo/video provider names:

```text
BUNNY_STREAM_API_KEY
BUNNY_STREAM_LIBRARY_ID
BUNNY_STREAM_EMBED_TOKEN_KEY
BUNNY_STREAM_PLAYBACK_TOKEN_TTL_SECONDS
BUNNY_STREAM_WEBHOOK_READONLY_KEY
BUNNY_PROOF_VIDEO_PATH
BUNNY_STORAGE_IMAGE_UPLOAD_ENABLED
BUNNY_STORAGE_ACCESS_KEY
BUNNY_STORAGE_ZONE_NAME
BUNNY_STORAGE_API_ENDPOINT
BUNNY_STORAGE_PULL_ZONE_URL
BUNNY_STORAGE_PULL_ZONE_TOKEN_KEY
BUNNY_STORAGE_DELIVERY_TOKEN_TTL_SECONDS
BUNNY_SHIELD_API_KEY
BUNNY_SHIELD_ZONE_ID
BUNNY_SHIELD_UPLOAD_COVERAGE
MEDIA_MODERATION_MODE
```

Keep `BUNNY_STORAGE_IMAGE_UPLOAD_ENABLED=false` and `MEDIA_MODERATION_MODE=disabled_fail_closed`
until the exact private upload, sanitization, scan, review, signed delivery, deletion, and recovery
path is proven.

Live provider names:

```text
LIVEPEER_API_KEY
LIVEPEER_WEBHOOK_SECRET
LIVEPEER_ACCESS_CONTROL_PRIVATE_KEY
LIVEPEER_ACCESS_CONTROL_PUBLIC_KEY
LIVEPEER_API_BASE_URL
LIVEPEER_HTTP_TIMEOUT_MS
LIVEPEER_BROWSER_BROADCAST_REDIRECT_BASE_URL
LIVEPEER_WEBHOOK_ID
LIVEPEER_MODERATION_MULTISTREAM_TARGET_ID
LIVEPEER_ADULT_LIVE_ENABLED=false
```

Browser camera/microphone and Advanced OBS use the same server-created Livepeer stream and
owner-authorized host reveal. No Livepeer secret belongs in a browser environment variable.

For a local-only age fixture, the supported names are:

```text
AGE_VERIFICATION_DRIVER=didit
AGE_VERIFICATION_ALLOW_MOCK_PROVIDER=true
```

That mock flag is local/test only. Real staging and production must set it to `false` and configure
one approved provider workflow and signed webhook.

## 3. Validate Before Starting Services

```sh
pnpm docs:check
pnpm db:migrations:check
pnpm deps:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm check
```

For repository/API behavior against disposable native PostgreSQL, point one of the documented test
variables at a non-production database and run:

```sh
API_INTEGRATION_DATABASE_URL=postgresql://... pnpm test:integration:api
```

`TEST_DATABASE_URL` or `DATABASE_URL` is also accepted by the integration harness, but a dedicated
`API_INTEGRATION_DATABASE_URL` is clearer and safer. The suite must never target production.

## 4. Run The Core App

Start web and API together, or include the worker when testing scheduled/provider work:

```sh
pnpm dev
pnpm dev:full
```

Then verify in order:

1. Account, wallet, and age readiness reach the authenticated app without a duplicate identity.
2. Home and Bits show Latest/Following in stable reverse publication order; text/poll rows do not
   enter primary grids.
3. Create shows only Add photos/videos and Go live.
4. A photo remains private through upload/safety readiness, then receives only signed authorized
   delivery.
5. A provider-confirmed video duration of 60 seconds or less becomes a Bit; a longer video becomes
   VOD without a technical format picker.
6. The live host workspace starts camera/microphone through the official Livepeer SDK; Advanced OBS
   uses the same owner-only, no-store, memory-only reveal; a viewer never sees host credentials.
7. Revocation, moderation, expiry, and access changes remove delivery immediately and remain visible
   to authorized operations staff.

Run browser smoke separately:

```sh
pnpm smoke
```

## 5. Know What Local Fixtures Do Not Prove

- Playwright smoke uses a local/mock harness for broad UI journeys. It does not prove Bunny upload,
  Livepeer ingest, real wallet signatures, provider webhooks, moderation, or deployment.
- Unit fixtures prove adapter contracts and fail-closed behavior, not provider account acceptance,
  latency, token enforcement, camera/device compatibility, OBS behavior, or deletion/recovery.
- `AGE_VERIFICATION_ALLOW_MOCK_PROVIDER=true` proves only the normalized local workflow.
- Database migration checks validate the chain; native PostgreSQL integration proves runtime SQL;
  neither authorizes applying migrations to a shared or remote database.
- A successful wallet approval, QR scan, or submitted signature is not payment or access proof.

## 6. Capture Real Staging Evidence

Copy and complete the staging template, then use the checked-in staging guards:

```sh
cp .env.staging.example .env.staging
pnpm staging:doctor
pnpm staging:acceptance
pnpm staging:prove
pnpm staging:report
```

For Bunny's exact SFW upload proof, after its documented keys and Shield coverage are approved:

```sh
pnpm proof:bunny-sfw
```

Do not run `pnpm staging:migrations:apply`, enable mainnet, or promote a provider from these commands
alone. Those actions require the owning review and release gate.
