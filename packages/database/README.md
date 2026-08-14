# packages/database

Supabase/Postgres migrations, seed strategy, RLS policies, and database test factories.

## Foundation Migration

The first runnable migration is `migrations/0001_foundation.sql`. It creates only the foundation tables needed before backend auth/session and provider slices:

- `users`
- `profiles`
- `staff_memberships`
- `staff_permissions`
- `provider_events`
- `provider_webhook_receipts`
- `idempotency_keys`
- `audit_events`

The matching rollback is `migrations/0001_foundation.down.sql`.

Run:

```sh
pnpm database:check
pnpm --filter @veel/database test
```

The root Supabase CLI project lives in `supabase/`. Its `migrations` entry is a symlink to
`packages/database/migrations` so local and remote Supabase workflows use the same canonical SQL
files without copying migration history. Because that canonical directory also contains explicit
`*.down.sql` rollback files, local stack startup must run through `scripts/run-supabase-cli.mjs`.
The wrapper builds a temporary migration workdir containing only forward migrations before invoking
the pinned Supabase CLI, preventing rollback files from being applied as duplicate migration versions.

Run remote migration checks through the repo-local CLI:

```sh
pnpm supabase:migrations
pnpm supabase:history:check
pnpm supabase:advisors
pnpm supabase:push:dry
```

Use `SUPABASE_MIGRATIONS_DB_URL` or `SUPABASE_DIRECT_DB_URL` for remote CLI checks when available.
Generic application `DATABASE_URL` is never accepted for migration commands. If an explicit migration
URL points at a Supabase transaction pooler, the root wrapper uses session-pooler port `5432` because
migration commands require prepared-statement-compatible connections.

The current shared remote project migration history is normalized to this package's sequence-named SQL
files. `pnpm supabase:migrations` verifies local/remote version alignment; `pnpm
supabase:history:check` reports missing sequential history or extra remote history rows; `pnpm
supabase:push:dry` must report that the remote database is up to date before new schema work builds on
the shared remote project. If direct database access is unavailable from the current network, use the
authenticated Supabase MCP project connection to list/apply migrations and run advisors. Keep applied
MCP migrations byte-for-byte aligned with committed files in this package.

## RLS Baseline

Migration `0017_rls_policy_baseline.sql` enables RLS for public-schema tables created before the realtime/read-model slices and adds explicit authenticated read policies for all current client-visible tables.

The policies are intentionally read-only for browser roles. Fastify remains the only mutation surface for payments, access, referrals, commissions, messages, live rooms, wallet records, provider callbacks, and admin state. Direct Supabase reads are limited to owners, conversation members, live participants, creators, active pass holders, or staff depending on the table.

Do not add anon access or broad `USING (true)` policies for app data. Public teaser/marketing surfaces should go through dedicated safe projections or backend routes.
