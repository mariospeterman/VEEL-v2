# Backup and restore runbook

Status: code complete; staging evidence is required before release promotion.

## Recovery sources

- Supabase managed database backups and point-in-time recovery are the primary production recovery mechanism.
- `pnpm db:backup` creates separate roles, schema, and data SQL files with the pinned Supabase CLI for portability checks.
- Database backups do **not** contain Supabase Storage objects. Configure and test a separate versioned object backup/export for every storage bucket.
- Provider dashboards and signing/key material remain provider-owned and must be inventoried separately; secrets never enter a backup artifact.

## Non-production restore proof

1. Create a disposable, Supabase-provisioned local project and a database with `restore` in its name. A plain PostgreSQL database is not a valid target because Supabase owns prerequisite roles, extensions, and the managed `auth`, `storage`, `supabase_functions`, and other platform schemas.
2. Set `BACKUP_INPUT_DIR`, `RESTORE_TARGET_DB_URL`, and `RESTORE_PROOF_ACK=RESTORE_DISPOSABLE_NONPRODUCTION_DATABASE`.
3. Use a PostgreSQL client compatible with the server major version, optionally through `PSQL_BINARY`.
   For a disposable database inside the same local cluster, `RESTORE_SKIP_ROLES=true` avoids replaying cluster-wide roles that already exist; cross-cluster staging drills must restore roles.
4. Run `pnpm db:restore:prove` and record the CI/run ID as `BACKUP_RESTORE_PROOF_ID`.
5. Run the checked-in migration integrity check separately, then validate auth/session boundaries, source-versus-target row counts, critical audit/payment/access ledgers, and application readiness. Supabase logical dumps intentionally exclude the CLI's migration-history schema, so the restore proof validates the resulting WeVid schema instead of inventing migration history on the target.
6. Destroy the disposable database using the hosting provider's approved procedure.

The restore script rejects remote and ambiguously named targets, and verifies the exact managed schemas represented in the logical data dump before applying the backup. Production restores require an incident, provider snapshot/PITR selection, two-person approval, a declared recovery point, and the rollback checklist; this local proof command must never be repurposed for production.
