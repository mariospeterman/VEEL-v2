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

## RLS Baseline

Migration `0017_rls_policy_baseline.sql` enables RLS for public-schema tables created before the realtime/read-model slices and adds explicit authenticated read policies for all current client-visible tables.

The policies are intentionally read-only for browser roles. Fastify remains the only mutation surface for payments, access, referrals, commissions, messages, live rooms, wallet records, provider callbacks, and admin state. Direct Supabase reads are limited to owners, conversation members, live participants, creators, active pass holders, or staff depending on the table.

Do not add anon access or broad `USING (true)` policies for app data. Public teaser/marketing surfaces should go through dedicated safe projections or backend routes.
