# Veel Rollback Checklist

Use this checklist for staging and production releases. Keep the exact release version, artifact digest, migration version, and operator in the deploy record.

## Before Deploy

- Confirm `ci`, `security`, `db-migrations`, and provider-staging smoke have passed.
- Confirm Supabase backup/PITR coverage for the target environment.
- Confirm every migration has a forward-safe rollback note or explicit no-op rollback reason.
- Confirm `DEPLOY_ENABLED=true`, `API_HEALTH_URL`, and `API_READY_URL` are environment-scoped.
- Confirm provider webhooks point at the target API and signatures are configured.

## Rollback Triggers

- `/readyz` fails after deploy.
- Payment evidence is accepted but entitlement settlement lags beyond SLA.
- Webhook signature rejection rate spikes unexpectedly.
- Provider callback processing queues stop draining.
- Admin audit writes fail.
- Security, provider, or data-integrity incident is detected.

## Rollback Steps

1. Pause new production promotion and capture the failing artifact digest.
2. Repoint traffic to the previous healthy artifact through the hosting platform.
3. Keep workers running only if they are compatible with the current database schema; otherwise pause worker queues first.
4. Do not reverse money, entitlement, compliance, or audit tables manually.
5. If a schema rollback is required, apply the documented down migration only after confirming no irreversible rows were written.
6. Re-run `/healthz`, `/readyz`, payment-provider smoke, webhook smoke, and admin ops visibility checks.
7. Record the incident, affected providers, affected users, and follow-up migration or code fix.

## Non-Negotiables

- Blockchain payment truth, entitlement access truth, compliance reporting truth, and accounting bookkeeping truth must not be edited into competing states during rollback.
- Never compensate for deploy failure by creating manual credits, balances, escrow rows, or platform-held creator payouts.
