# Staging convergence gate

Status: code-complete orchestration; externally blocked until the staging accounts, hosting adapter, evidence, and approvals below exist.

This is the operator packet for promoting one already-built WeVid release into the isolated staging environment. Staging is an environment, not a branch. Never put a secret or raw provider payload in an evidence identifier, workflow log, artifact manifest, or frontend runtime value.

## 1. Owner actions

The account owner must select the hosting target and authorize a GitHub OIDC trust for this repository and the `staging` GitHub Environment. Add the provider adapter only from that provider's current official deployment and OIDC documentation. Do not set `STAGING_DEPLOY_ENABLED=true` before the reviewed adapter exists.

Configure the `staging` GitHub Environment with separate non-production Supabase/Postgres, Redis, Solana devnet, Bunny, Livepeer, age/KYC/KYB, Privy, Realtime/Web Push, Resend, telemetry, and legal values. Secret values belong in Environment secrets; public identifiers and safe flags belong in Environment variables. The exact names consumed by the workflow are in `.github/workflows/deploy-staging.yml` and `.env.example`.

Required safety values include:

- `NEXT_PUBLIC_EMBEDDED_WALLET_RUNTIME_ENABLED=true` only for the approved Privy staging app/domain;
- `HELIUS_CLUSTER=devnet`;
- `LIVEPEER_ADULT_LIVE_ENABLED=false`;
- `MEDIA_MODERATION_MODE=launch_approved` only after the exact SFW provider path is accepted;
- `AGE_VERIFICATION_ALLOW_MOCK_PROVIDER=false`;
- `TRANSACTIONAL_EMAIL_PROVIDER=resend` with a verified staging sender and test recipient;
- `API_RATE_LIMIT_STORE_DRIVER=redis`;
- `OTEL_REQUIRED=true`;
- `LEGAL_DOCUMENTS_APPROVED=true` only after counsel/product approval and version assignment.

## 2. Pre-deploy validation

Download the successful `release-manifest-*` artifact from the selected `release-artifacts` run and set `RELEASE_MANIFEST_PATH`. Run:

```text
pnpm staging:doctor
```

Exit `2` means at least one required group is missing or unsafe. The command prints names only, never values. Do not override or reinterpret this result as green.

The staging workflow then verifies the exact source SHA, manifest fingerprint, contract digest, migration head, and all three GitHub OCI attestations. It must deploy those digests without rebuilding.

## 3. Evidence matrix

After the exact images are deployed and migrations are applied through the approved remote migration procedure, run:

```text
pnpm staging:prove
```

The command independently executes release-manifest, synthetic web/API, Bunny SFW TUS/playability, Solana subscription, Enterprise, transactional-email, database restore, and Storage object restore proofs. It also requires opaque, redacted evidence receipts for journeys that need provider dashboards, target devices, or operator observation:

- `STAGING_IDENTITY_WALLET_PROOF_ID`: external and embedded wallet login, link, session, logout, recovery, and collision denial;
- `STAGING_VERIFICATION_PROOF_ID`: age plus purpose-separated creator KYC and organization KYB callbacks/replay denial;
- `STAGING_PAYMENT_PROOF_ID`: SOL and USDC exact-split settlement, Commerce Kit deep link/QR/mobile return, Helius evidence, receipt, and entitlement;
- `STAGING_LIVEPEER_PROOF_ID`: SFW ingest, viewer, webhook, moderation target, suspend/recover, end, and replay quarantine;
- `STAGING_REALTIME_PUSH_PROOF_ID`: signed Supabase Realtime authorization and real VAPID delivery/revocation on target browsers;
- `STAGING_MODERATION_PROOF_ID`: private upload, provider signals, human fallback, approve/reject/appeal, retry, and dead-letter recovery;
- `BACKUP_RESTORE_PROOF_ID`: disposable non-production logical database restore proof;
- `STAGING_STORAGE_BACKUP_PROOF_ID`: Supabase Storage object backup and restore proof with object-count/hash parity;
- `STAGING_OBSERVABILITY_PROOF_ID`: OTLP traces/metrics/logs, dashboards, alert delivery, and redaction checks;
- `STAGING_DEVICE_QA_PROOF_ID`: real wallet/provider, installed iOS PWA, keyboard, screen reader, 200% zoom, responsive, WebKit, and performance evidence.

Each identifier is an opaque run, ticket, or artifact reference with no query string or secret. `STAGING_EVIDENCE_MANIFEST_DIGEST` must equal the exact `manifestDigest` in `RELEASE_MANIFEST_PATH`; a mismatch fails the proof. Exit `2` means evidence is absent. Exit `1` means a configured proof failed. Only exit `0` is a complete staging proof for that release.

## 4. Rollback and cleanup

Keep the previous healthy manifest digest available. If deployment, migration, synthetic, provider, or alert proof fails, stop traffic promotion, restore the previous immutable images, follow `rollback-checklist.md`, and use `backup-and-restore.md` only against the explicitly acknowledged disposable/non-production target. Clean provider proof assets such as the Bunny test upload after retaining redacted evidence.

Production promotion remains manual. It requires GitHub production-environment approval and the exact staging-proven manifest digest; production never rebuilds.
