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
4. Run `pnpm db:restore:prove` and record the CI/run ID as `BACKUP_RESTORE_PROOF_ID` inside the release-bound staging evidence bundle.
5. Run the checked-in migration integrity check separately, then validate auth/session boundaries, source-versus-target row counts, critical audit/payment/access ledgers, and application readiness. Supabase logical dumps intentionally exclude the CLI's migration-history schema, so the restore proof validates the resulting WeVid schema instead of inventing migration history on the target.
6. Destroy the disposable database using the hosting provider's approved procedure.

The restore script rejects remote and ambiguously named targets, and verifies the exact managed schemas represented in the logical data dump before applying the backup. Production restores require an incident, provider snapshot/PITR selection, two-person approval, a declared recovery point, and the rollback checklist; this local proof command must never be repurposed for production.

## Supabase Storage object restore proof

Supabase's managed database backups contain Storage metadata but not the object bytes. Use the current official [Storage download guidance](https://supabase.com/docs/guides/storage/management/download-objects) and the pinned CLI's `supabase storage ls --help` / `supabase storage cp --help` output to export every bucket into a versioned backup target. Use a separate disposable project/workdir or separate S3-compatible profiles for the restore target; never relink the main workspace ambiguously.

1. Include at least one non-sensitive canary object and export every staging bucket into one source directory while preserving bucket and object-key layout.
2. Restore that export into a disposable non-production Supabase Storage project.
3. Download every restored bucket into a second directory with the same layout.
4. Set `STORAGE_BACKUP_SOURCE_DIR`, `STORAGE_RESTORE_TARGET_DIR`, and `STORAGE_RESTORE_PROOF_ACK=COMPARE_DISPOSABLE_NONPRODUCTION_STORAGE`.
5. Run `pnpm storage:restore:prove` and retain its object count, byte count, and aggregate inventory SHA-256 as the redacted evidence artifact referenced by `STAGING_STORAGE_BACKUP_PROOF_ID` inside the release-bound staging evidence bundle.
6. Delete the disposable project and locally downloaded object copies through the approved provider/local procedure after evidence retention.

The proof hashes object bytes as streams and compares exact relative key, size, and content parity. It rejects empty backups, symbolic links, non-file entries, identical source/target directories, missing objects, changed bytes, and unexpected restored objects. It reports only aggregate hashes and mismatch classes; object keys are not printed because they may contain user data.
