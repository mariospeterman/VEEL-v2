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

RLS is intentionally not enabled yet because no table is exposed directly to frontend Supabase clients in this slice. Backend Fastify remains the only mutation surface until a later realtime/read-model slice adds explicit RLS policies and policy tests.
