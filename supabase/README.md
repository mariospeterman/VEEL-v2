# Supabase Project

This folder is the root Supabase CLI project for Veel v2.

- `config.toml` is committed so local CLI behavior is explicit.
- `migrations` is a symlink to `../packages/database/migrations`; `packages/database` remains the canonical migration source for this monorepo.
- `supabase/.temp`, local branches, and local env files stay ignored.

Use the repo-local CLI through pnpm scripts so commands do not accidentally use an older global binary:

```sh
pnpm supabase:version
pnpm supabase:migrations
pnpm supabase:push:dry
pnpm supabase:push
```

The root `.env` must provide `SUPABASE_PROJECT_REF`, `SUPABASE_ACCESS_TOKEN`, and a Postgres URL for CLI remote workflows. Prefer `SUPABASE_MIGRATIONS_DB_URL` for the migration connection, then `SUPABASE_DIRECT_DB_URL`; `DATABASE_URL` remains the fallback for local developer convenience. Do not commit those values.

Migration commands must use a direct Postgres connection or Supabase session pooler connection. Supabase transaction pooler URLs on port `6543` are valid for many runtime/serverless database clients, but they do not support prepared statements and are not a safe migration connection. When the wrapper sees a Supabase transaction-pooler URL, it rewrites only the CLI invocation to session-pooler port `5432` and prints a non-secret warning. The wrapper also sets `PGCONNECT_TIMEOUT=10` and a 45 second command timeout so an unreachable database fails fast.

The wrapper runs `db` and `migration` commands from a temporary Supabase CLI workdir generated from `packages/database/migrations`. Only forward migration files are linked into that workdir; `.down.sql` rollback files remain available to repository checks without being interpreted as duplicate Supabase CLI migrations.

The current remote migration history was applied through Supabase MCP and stores timestamped versions in `supabase_migrations.schema_migrations`, while local files use the monorepo sequence names `0001` through `0056`. As a result, `pnpm supabase:migrations` is useful for remote visibility, but `pnpm supabase:push:dry` correctly refuses to plan a push until the migration history is normalized. Do not run `pnpm supabase:push` against the shared remote project until that repair is explicitly planned, reviewed, and backed up.

For this Codex workspace, Supabase MCP is the verified remote path when direct `DATABASE_URL` access is unavailable. Use MCP to list/apply migrations and run advisors, then keep the committed SQL files in `packages/database/migrations` as the source of truth.
