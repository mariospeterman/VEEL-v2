# WeVid release operations

Status: code-complete release boundary; provider deployment blocked until a hosting target and OIDC trust are approved.

## Promotion model

```text
short-lived PR branch -> preview checks -> protected main -> signed OCI artifacts
  -> exact digest staging convergence -> explicit approval -> exact digest production promotion
```

`main` is the only permanent branch. Production never rebuilds. The `release-artifacts` workflow runs only after green `ci` on `main`, builds non-root `web`, `api`, and `worker` OCI targets, publishes each to GHCR, produces GitHub attestations, and uploads one manifest containing the source SHA, OpenAPI digest, migration head, and all three image digests.

The web image reads public configuration from the no-store `/runtime-config.js` endpoint at process runtime. Public environment values therefore are not a reason to create environment-specific images. Server secrets are injected only by the selected environment secret store.

## Current external gate

No hosting provider has been selected or authorized. The staging workflow verifies the release manifest and attestations, reports each missing provider group as `CODE_COMPLETE_PROVIDER_BLOCKED`, exits non-zero, and refuses to pretend it deployed. A missing configuration group, an unsafe launch value, or an absent hosting adapter can never produce a green staging-convergence run. When the account owner selects the provider, add one repository-owned adapter against its current official API/OIDC documentation, obtain review, and only then set `STAGING_DEPLOY_ENABLED=true`.

Production requires all of the following before a hosting adapter may promote traffic:

- exact staging-proven manifest digest;
- GitHub production environment approval;
- provider staging proof, public callback/domain proof, and redacted evidence;
- migration and non-production backup/restore proof;
- configured OTLP collector, dashboards, alerts, and on-call destinations;
- final counsel/product approval and version identifiers for Terms and Privacy;
- production credentials, databases, Redis, wallets, provider accounts, and DNS isolated from staging;
- rollback target pinned to the previous healthy manifest.

Use `pnpm staging:doctor`, `pnpm staging:prove`, `pnpm synthetic:smoke`, `pnpm load:smoke`, `pnpm db:backup`, `pnpm db:restore:prove`, `pnpm storage:restore:prove`, and the [backup/restore runbook](backup-and-restore.md). Both staging commands exit `2` while required configuration/evidence is absent and `staging:prove` continues through independent proofs so one failed provider does not hide the rest of the matrix. Commands never print secret values. Remote load requires an explicit bounded-load acknowledgement. The exact configuration, evidence receipts, validation, and rollback sequence is in [staging convergence](staging-convergence.md).

## Artifact contract

Generate locally only for testing:

```text
RELEASE_SOURCE_SHA=<40-char-sha>
RELEASE_{WEB,API,WORKER}_IMAGE=<repository>
RELEASE_{WEB,API,WORKER}_DIGEST=sha256:<64-hex>
pnpm release:manifest
pnpm release:verify
```

The checked manifest fingerprint covers every field. Any source, contract, migration, repository, or image-digest change creates a different manifest and must repeat staging convergence.

## Runtime boundaries

- Web: port 3000; no server secret; public config delivered at runtime.
- API: port 4000; `/healthz` proves process liveness and `/readyz` proves required dependency readiness.
- Worker: private process; graceful stop waits for the active bounded tick.
- Database/Auth/Realtime: separate Supabase project per environment.
- Rate limiting: Redis is mandatory in production.
- Telemetry: API and worker preload `@veel/observability/register`; `OTEL_REQUIRED=true` makes a missing OTLP endpoint fatal.

Provider keys, cookies, authorization headers, database URLs, wallet material, private signing keys, raw PII/provider payloads, stream keys, and signed media URLs must never be placed in images, manifests, logs, workflow output, or frontend config.
