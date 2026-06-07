# Veel Observability Skeleton

Status: staging skeleton. Wire to the selected hosting and telemetry vendors before production launch.

## Required Signals

- API request latency, status codes, and rate-limit events.
- Worker tick duration, queue lag, retry counts, and dead-letter counts.
- Provider-call latency and failure rate for Solana RPC/indexer, Bunny, Livepeer, age/KYC, onramp, email, and push.
- Webhook accepted, rejected, replayed, and processed counts.
- Payment confirmation time from wallet approval to backend entitlement grant.
- Media upload-to-ready latency.
- Subscription collection due count, success count, failure count, and revocation count.
- Admin audit write success and failure count.
- Frontend web vitals and client-side error rate.

## Redaction Rules

Never log provider secrets, private keys, service-role keys, webhook secrets, raw PII, age/KYC documents, raw provider payloads, signed media URLs, stream keys, wallet private material, or message bodies.

## Dashboards

- Release health: deploy version, commit, `/healthz`, `/readyz`, API p95, worker status.
- Money/access: payment evidence lag, settlement failures, entitlement grants, subscription collection lag.
- Provider health: Solana, Helius/indexer, Bunny, Livepeer, age/KYC, onramp, email, push.
- Safety/admin: moderation queue age, report resolution SLA, admin audit write health.
- Compliance: ledger write health, DAC7/DAC8/CARF/VAT report generation state, receipt/invoice export state.

## Alert Defaults

- Page immediately on readiness failure, payment settlement failure spike, webhook verification anomaly, audit write failure, or database connectivity failure.
- Notify ops on provider degradation, queue lag crossing SLA, notification delivery failure spike, or media processing backlog.
- File an incident before manual remediation for money, access, compliance, or admin state.
