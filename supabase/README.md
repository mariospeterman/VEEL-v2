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

The root `.env` must provide `SUPABASE_PROJECT_REF`, `SUPABASE_ACCESS_TOKEN`, and `DATABASE_URL` for CLI remote workflows. Do not commit those values. The wrapper sets `PGCONNECT_TIMEOUT=10` and a 45 second command timeout so an unreachable pooler fails fast.

For this Codex workspace, Supabase MCP is the verified remote path when direct `DATABASE_URL` access is unavailable. Use MCP to list/apply migrations and run advisors, then keep the committed SQL files in `packages/database/migrations` as the source of truth.
