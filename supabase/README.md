# Supabase Project

This folder is the root Supabase CLI project for Veel v2.

- `config.toml` is committed so local CLI behavior is explicit.
- `migrations` is a symlink to `../packages/database/migrations`; `packages/database` remains the canonical migration source for this monorepo.
- `supabase/.temp`, local branches, and local env files stay ignored.

Use the repo-local CLI through pnpm scripts so commands do not accidentally use an older global binary:

```sh
pnpm supabase:version
pnpm supabase:migrations
pnpm supabase:history:check
pnpm supabase:advisors
pnpm supabase:push:dry
pnpm supabase:push
```

The root `.env` must provide `SUPABASE_PROJECT_REF` and `SUPABASE_ACCESS_TOKEN` for CLI remote workflows. Prefer `SUPABASE_MIGRATIONS_DB_URL` for a dedicated migration connection, then `SUPABASE_DIRECT_DB_URL`; when neither is available, the wrappers use the linked CLI Management API path after verifying that `supabase/.temp/project-ref` matches `SUPABASE_PROJECT_REF`. Generic application `DATABASE_URL` is never used for migration commands. Do not commit any of these values.

The linked Management API fallback is only for CLI migration, history, and advisor operations. The API and worker still require a real pooled `DATABASE_URL`; a publishable key, secret key, access token, or linked CLI session is not a Postgres runtime credential.

Migration commands must use a direct Postgres connection or Supabase session pooler connection. Supabase transaction pooler URLs on port `6543` are valid for many runtime/serverless database clients, but they do not support prepared statements and are not a safe migration connection. When the wrapper sees a Supabase transaction-pooler URL, it rewrites only the CLI invocation to session-pooler port `5432` and prints a non-secret warning. The wrapper also sets `PGCONNECT_TIMEOUT=10` and a 45 second command timeout so an unreachable database fails fast.

The wrapper runs `db` and `migration` commands from a temporary Supabase CLI workdir generated from `packages/database/migrations`. Only forward migration files are linked into that workdir; `.down.sql` rollback files remain available to repository checks without being interpreted as duplicate Supabase CLI migrations. The wrapper also copies local `supabase/.temp` link metadata into the temporary workdir at runtime so `--linked` remote commands use the same linked project and pooler configuration without committing secrets.

The current remote migration history is normalized to the committed sequence names `0001` through `0118`. `pnpm supabase:migrations` verifies local/remote version alignment, `pnpm supabase:history:check` reports missing sequential history or extra remote history rows without printing SQL or secrets, and `pnpm supabase:push:dry` must report `Remote database is up to date` before new schema work builds on the shared remote project.

For this Codex workspace, the linked repo-local CLI is the verified remote path when a direct migration URL is unavailable. Supabase MCP remains appropriate for read-only inspection and advisors. Keep the committed SQL files in `packages/database/migrations` as the source of truth and apply sequential migrations through the CLI so remote history remains normalized.

Remote verification on 2026-08-26:

- Repo-local Supabase CLI: `2.113.0`.
- `pnpm supabase:migrations` connects through the linked Management API fallback and lists remote history.
- The remote migration history is normalized to committed sequential versions `0001` through `0118`.
- `pnpm supabase:push:dry` reports `Remote database is up to date`.
- The hosted project includes the current auth, profile, media, social, monetisation, analytics, MCP, staff-RBAC, Moments, and landing analytics authorities.
