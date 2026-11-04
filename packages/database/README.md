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

Rollback files are operator actions, not Supabase forward migrations. Execute one only against an
isolated or restored target, with error-stop and one transaction so a guard failure cannot be
followed by destructive statements:

```sh
psql "$DB_URL" -X --set=ON_ERROR_STOP=1 --single-transaction \
  --file=packages/database/migrations/NNNN_name.down.sql
```

CI executes the privacy-sensitive `0039` and `0117` rollback/reapply paths against a fresh migrated
Postgres instance, including the required refusal and unchanged-state proof for retained Moments.

Run remote migration checks through the repo-local CLI:

```sh
pnpm supabase:migrations
pnpm supabase:history:check
pnpm supabase:advisors
pnpm supabase:push:dry
```

### Populated databases behind migrations 0046, 0056, or 0077

Those historical migrations transform populated enum-like values before replacing their obsolete
CHECK constraints. Do not rewrite an applied migration, skip a migration, or mark it repaired in
Supabase history. Inspect the target with an explicit migration connection:

```sh
SUPABASE_MIGRATIONS_DB_URL="$DB_URL" pnpm database:legacy-bridge:check
```

If the report names a required bridge, first verify the exact migration-history prefix, take and
test a recoverable backup, and review the SQL in
`packages/database/pre-upgrade/legacy-check-constraint-bridge.sql`. Then run the bridge with the
explicit acknowledgement and immediately apply the immutable pending migrations:

```sh
WEVID_LEGACY_MIGRATION_BRIDGE_APPROVAL=DB06_REVIEWED \
SUPABASE_MIGRATIONS_DB_URL="$DB_URL" pnpm database:legacy-bridge:apply
pnpm supabase:migrations
pnpm supabase:push
```

The bridge only widens the three obsolete checks in one transaction; it recognizes the Event Access
purchase table both before and after migration 0049 renames it, so one reviewed run can carry an
older populated prefix through 0056. Migrations 0046, 0056, and 0077 still own the final constraints
and migration-history records. Stop if any target remains or if the remote history is not a clean
applied prefix. Prove the populated upgrade on an isolated restore before touching a shared environment.

Use `SUPABASE_MIGRATIONS_DB_URL` or `SUPABASE_DIRECT_DB_URL` for remote CLI checks when available.
Generic application `DATABASE_URL` is never accepted for migration commands. If neither explicit
migration URL is configured, the wrappers require a matching `SUPABASE_PROJECT_REF`, authenticated
`SUPABASE_ACCESS_TOKEN`, and linked CLI metadata, then use the Supabase Management API connection.
If an explicit migration URL points at a Supabase transaction pooler, the root wrapper uses
session-pooler port `5432` because migration commands require prepared-statement-compatible connections.

The current shared remote project migration history is normalized to this package's sequence-named SQL
files. `pnpm supabase:migrations` verifies local/remote version alignment; `pnpm
supabase:history:check` reports missing sequential history or extra remote history rows; `pnpm
supabase:push:dry` must report that the remote database is up to date before new schema work builds on
the shared remote project. If a direct migration connection is unavailable, use the authenticated,
project-ref-validated linked CLI path; use Supabase MCP for read-only inspection and advisors. Apply
sequential schema changes through the repo-local CLI so history stays aligned with this package.

## RLS Baseline

Migration `0017_rls_policy_baseline.sql` enables RLS for public-schema tables created before the realtime/read-model slices and adds explicit authenticated read policies for all current client-visible tables.

Fastify remains the only mutation surface for payments, access, referrals, commissions, messages, live rooms, wallet records, provider callbacks, and admin state. Migration `0120_data_api_server_authority.sql` also revokes every browser-role table privilege and removes historical policies from the named identity, compliance, tax, finance, organization, social-counter, comment, content, media, and access-rule tables. Those resources are API-only even for staff; staff authorization belongs to the audited backend permission boundary, not an `is_staff_member()` Data API shortcut.

Only the explicitly retained realtime/read projections may keep narrow authenticated `SELECT` grants and participant/self policies. Default table privileges revoke all browser-role access for future public-schema tables until a reviewed migration deliberately exposes a projection. The `private` security-definer helpers used by retained RLS paths are executable by `authenticated` only, never `PUBLIC` or `anon`. Real-Postgres CI checks effective grants using the actual `anon` and `authenticated` roles and proves the backend connection still reads its owned tables.

Do not add anon access or broad `USING (true)` policies for app data. Public teaser/marketing surfaces should go through dedicated safe projections or backend routes.
