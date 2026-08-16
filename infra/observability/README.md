# WeVid observability contract

Status: OpenTelemetry runtime wiring is code complete; collector, dashboards, alert routes, and staging SLO evidence are provider-blocked.

API and worker processes preload the shared OpenTelemetry Node SDK before application modules. It exports traces and metrics over OTLP/HTTP only when an endpoint is configured. Local/test runs are disabled by default. Staging and production set `OTEL_REQUIRED=true`, unique `OTEL_SERVICE_NAME` values, a secret-store `OTEL_EXPORTER_OTLP_HEADERS`, and the environment resource attributes supported by the chosen collector.

Application logs remain structured JSON/Pino because the OpenTelemetry JavaScript logs signal is not the launch authority. API automatic instrumentation covers inbound HTTP, Fastify, supported provider HTTP, and Postgres spans. Business metrics and dashboard queries must use bounded attributes; never use user IDs, wallet addresses, content IDs, request URLs with query strings, or provider payload identifiers as metric labels.

## Required release dashboard

- deployment manifest digest and source SHA;
- API availability, p50/p95/p99 latency, 4xx/5xx and rate-limit rate;
- worker tick duration/failure, oldest queue item, retries and dead letters;
- Postgres connection saturation and query latency;
- payment submission-to-confirmation and confirmation-to-entitlement latency;
- webhook accepted/rejected/replayed/processed counts;
- provider latency/failure for Solana, Bunny, Livepeer, age/KYC, onramp, email, and push;
- media upload-to-ready and live/replay handoff latency;
- audit/compliance ledger write failures;
- privacy-minimized Core Web Vitals by release and broad device class.

## Default alerts

- Page: readiness failure, payment settlement or entitlement anomaly, webhook verification spike, audit/compliance write failure, worker dead-letter growth, or database exhaustion.
- Urgent operations: provider degradation, queue lag beyond SLA, media moderation backlog, notification failure spike, or p95/error-budget burn.
- Release rollback: a new manifest causes readiness failure, material error-rate regression, settlement/access regression, or security/data-integrity incident.

Alert destinations, escalation rotations, SLO numbers, retention, and vendor access roles require account-owner approval and must be proven in staging. Record one test page and one rollback drill against the exact release candidate.

## Redaction

Never emit authorization/cookie headers, provider or webhook secrets, private keys, service-role keys, database/Redis/OTLP credential URLs, raw PII or verification documents, message bodies, signed media URLs, stream keys, raw provider payloads, or wallet private material. The API logger maintains an explicit denylist; collector-side redaction is defense in depth, not the primary control.
